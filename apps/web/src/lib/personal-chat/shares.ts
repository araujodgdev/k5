import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { database, withTransaction, type Transaction } from '@/lib/database';
import { CapabilityError } from '@/lib/capabilities/errors';
import type { WorkspaceContext } from '@/lib/application/context';
import { encryptCredential, parseCredentialKeyring } from '@/lib/platform-crypto';
import { inviteCaseInTransaction } from '@/lib/collaboration/service';
import { readVaultOriginal } from '@/lib/vault';
import type { PersonContext } from './auth';
import type { CreateShareInput, MessageBody } from './domain';
import { personalChatEnvironment } from './environment';
import { getMessageForViewer, insertMessage } from './service';
import { wakePersonalEmailWorker } from './wake';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const inputHash = (value: unknown) => digest(JSON.stringify(value));
const denied = () => new CapabilityError('FORBIDDEN', 'Seu acesso atual não permite compartilhar este item.');
async function assertLiveSession(tx: Transaction, context: {
  userId: string;
  sessionId?: string;
}) {
  if (context.sessionId && !await tx.prepare('SELECT 1 FROM session WHERE id=? AND userId=? AND expiresAt>CURRENT_TIMESTAMP').get(context.sessionId, context.userId))
    throw new CapabilityError('UNAUTHENTICATED', 'Sua sessão foi encerrada.');
}
async function assertOfficeWriter(tx: Transaction, userId: string, officeId: string) {
  const member = await tx.prepare('SELECT role FROM office_member WHERE office_id=? AND user_id=?').get<{
    role: string;
  }>(officeId, userId);
  if (!member || member.role === 'reviewer')
    throw denied();
}
async function recipient(tx: Transaction, threadId: string, senderId: string) {
  const sender = await tx.prepare('SELECT 1 FROM personal_thread_participant WHERE thread_id=? AND user_id=? AND blocked_at IS NULL FOR UPDATE')
    .get(threadId, senderId);
  if (!sender)
    throw new CapabilityError('NOT_FOUND', 'Conversa não encontrada.');
  const pending = await tx.prepare(`SELECT id,normalized_email,encrypted_token FROM personal_thread_invitation
  WHERE thread_id=? AND state='pending' AND expires_at>CURRENT_TIMESTAMP`).get<{
    id: string;
    normalized_email: string;
    encrypted_token: string;
  }>(threadId);
  if (pending)
    return { kind: 'external' as const, email: pending.normalized_email, invitationId: pending.id };
  const user = await tx.prepare(`SELECT u.id,u.email FROM personal_thread_participant p JOIN "user" u ON u.id=p.user_id
  WHERE p.thread_id=? AND p.user_id<>? AND p.blocked_at IS NULL`).get<{
    id: string;
    email: string;
  }>(threadId, senderId);
  if (!user)
    throw new CapabilityError('CONFLICT', 'Esta conversa ainda não tem destinatário.');
  return { kind: 'user' as const, userId: user.id, email: user.email };
}
export async function listDocumentPicks(context: WorkspaceContext, input: {
  query: string;
  caseId?: string;
  cursor?: string;
  limit: number;
}) {
  const offset = input.cursor ? Number(Buffer.from(input.cursor, 'base64url').toString('utf8')) : 0;
  if (!Number.isSafeInteger(offset) || offset < 0)
    throw new CapabilityError('INVALID', 'Cursor inválido.');
  const like = `%${input.query.replace(/[\\%_]/g, '\\$&')}%`;
  const rows = await database.prepare(`SELECT d.id,d.original_name AS name,d.case_id AS "caseId",c.name AS "caseName",max(v.version) AS "currentVersion"
  FROM vault_document d JOIN vault_document_version v ON v.document_id=d.id AND v.office_id=d.office_id AND v.is_active=1
  LEFT JOIN vault_case c ON c.id=d.case_id AND c.office_id=d.office_id
  JOIN office_member m ON m.office_id=d.office_id AND m.user_id=? AND m.role<>'reviewer'
  WHERE d.office_id=? AND d.deleted_at IS NULL AND d.status='ready' AND d.original_name ILIKE ? ESCAPE '\\'
    AND (d.case_id IS NULL OR c.deleted_at IS NULL)
    AND (?::text IS NULL OR d.case_id=?) GROUP BY d.id,d.original_name,d.case_id,c.name ORDER BY d.original_name,d.id LIMIT ? OFFSET ?`)
    .all<{
    id: string;
    name: string;
    caseId: string | null;
    caseName: string | null;
    currentVersion: string | number;
  }>(context.userId, context.officeId, like, input.caseId ?? null, input.caseId ?? null, input.limit + 1, offset);
  return { documents: rows.slice(0, input.limit).map(row => ({ ...row, currentVersion: Number(row.currentVersion) })),
    nextCursor: rows.length > input.limit ? Buffer.from(String(offset + input.limit)).toString('base64url') : null };
}
export async function listCasePicks(context: WorkspaceContext, input: {
  query: string;
  cursor?: string;
  limit: number;
}) {
  const offset = input.cursor ? Number(Buffer.from(input.cursor, 'base64url').toString('utf8')) : 0;
  if (!Number.isSafeInteger(offset) || offset < 0)
    throw new CapabilityError('INVALID', 'Cursor inválido.');
  const rows = await database.prepare(`SELECT c.id,c.name,m.role FROM vault_case c JOIN office_member m ON m.office_id=c.office_id AND m.user_id=?
  WHERE c.office_id=? AND c.deleted_at IS NULL AND m.role<>'reviewer' AND c.name ILIKE ? ORDER BY c.name,c.id LIMIT ? OFFSET ?`)
    .all<{
    id: string;
    name: string;
    role: string;
  }>(context.userId, context.officeId, `%${input.query}%`, input.limit + 1, offset);
  return { cases: rows.slice(0, input.limit).map(row => ({ id: row.id, name: row.name, allowedPermissions: ['viewer', 'editor'] as ('viewer' | 'editor')[] })),
    nextCursor: rows.length > input.limit ? Buffer.from(String(offset + input.limit)).toString('base64url') : null };
}
export async function createShare(person: PersonContext, workspace: WorkspaceContext, threadId: string, input: CreateShareInput) {
  const hash = inputHash({ threadId, input });
  const result = await withTransaction(async (tx) => {
    await assertLiveSession(tx, person);
    await tx.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?,0))').get(`personal-share:${person.userId}:${input.idempotencyKey}`);
    const prior = await tx.prepare('SELECT input_hash,message_id FROM personal_share_operation WHERE author_user_id=? AND idempotency_key=?')
      .get<{
      input_hash: string;
      message_id: string;
    }>(person.userId, input.idempotencyKey);
    if (prior) {
      if (prior.input_hash !== hash)
        throw new CapabilityError('CONFLICT', 'Esta operação já foi usada com outro conteúdo.');
      return { messageId: prior.message_id, wake: false };
    }
    const target = await recipient(tx, threadId, person.userId);
    if (input.kind === 'document') {
      await assertOfficeWriter(tx, person.userId, workspace.officeId);
      const version = await tx.prepare(`SELECT v.id,v.version,v.original_name,v.mime_type,d.case_id FROM vault_document d
    JOIN vault_document_version v ON v.document_id=d.id AND v.office_id=d.office_id
    WHERE d.id=? AND d.office_id=? AND d.deleted_at IS NULL AND d.status='ready' AND v.version=? AND v.is_active=1
      AND (d.case_id IS NULL OR EXISTS(SELECT 1 FROM vault_case c WHERE c.id=d.case_id AND c.office_id=d.office_id AND c.deleted_at IS NULL))`)
        .get<{
        id: string;
        version: string | number;
        original_name: string;
        mime_type: string;
        case_id: string | null;
      }>(input.documentId, workspace.officeId, input.version);
      if (!version)
        throw new CapabilityError('NOT_FOUND', 'Documento ou versão não encontrado.');
      const shareId = randomUUID();
      let token: string | undefined;
      let encrypted: string | null = null;
      if (target.kind === 'external') {
        token = randomBytes(32).toString('base64url');
        const env = personalChatEnvironment();
        encrypted = encryptCredential(token, parseCredentialKeyring(env.K5_CREDENTIALS_KEY, env.K5_CREDENTIALS_PREVIOUS_KEYS, env.K5_CREDENTIALS_NEXT_KEY));
      }
      await tx.prepare(`INSERT INTO vault_document_share(id,office_id,document_id,document_version_id,version,source_case_id,recipient_user_id,invitation_id,
    token_hash,encrypted_token,expires_at,conversation_id,granted_by,state) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(shareId, workspace.officeId, input.documentId, version.id, version.version, version.case_id, target.kind === 'user' ? target.userId : null, target.kind === 'external' ? target.invitationId : null, token ? digest(token) : null, encrypted, token ? new Date(Date.now() + 7 * 86400000).toISOString() : null, threadId, person.userId, target.kind === 'user' ? 'active' : 'pending');
      const body: MessageBody = { kind: 'document_share', shareId, name: version.original_name, mimeType: version.mime_type, version: Number(version.version),
        contentUrl: `/api/messages/document-shares/${shareId}/content`, canRevoke: true, state: target.kind === 'user' ? 'active' : 'pending_claim' };
      const message = await insertMessage(tx, person, threadId, input.clientMessageId, body);
      if (encrypted)
        await tx.prepare(`UPDATE personal_email_outbox SET action_kind='document_claim',encrypted_action_token=? WHERE message_id=?`).run(encrypted, message.id);
      await tx.prepare(`INSERT INTO personal_share_operation(id,author_user_id,idempotency_key,input_hash,kind,message_id,result_id) VALUES(?,?,?,?,?,?,?)`)
        .run(randomUUID(), person.userId, input.idempotencyKey, hash, 'document', message.id, shareId);
      return { messageId: message.id, wake: Boolean(encrypted) };
    }
    const caseRow = await tx.prepare('SELECT name FROM vault_case WHERE id=? AND office_id=? AND deleted_at IS NULL').get<{
      name: string;
    }>(input.caseId, workspace.officeId);
    if (!caseRow)
      throw new CapabilityError('NOT_FOUND', 'Caso não encontrado.');
    const invitation = await inviteCaseInTransaction(tx, workspace, { caseId: input.caseId, email: target.email, role: input.permission, canInvite: input.canInvite }, target.kind === 'user' ? { kind: 'user', userId: target.userId } : { kind: 'external' });
    const body: MessageBody = { kind: 'case_invitation', invitationId: invitation.id, caseName: caseRow.name, state: 'pending',
      actionPath: target.kind === 'user' ? invitation.path : `/app/messages?thread=${encodeURIComponent(threadId)}` };
    const message = await insertMessage(tx, person, threadId, input.clientMessageId, body);
    if (target.kind === 'external') {
      const raw = invitation.path.slice('/invite/'.length);
      const env = personalChatEnvironment();
      const encrypted = encryptCredential(raw, parseCredentialKeyring(env.K5_CREDENTIALS_KEY, env.K5_CREDENTIALS_PREVIOUS_KEYS, env.K5_CREDENTIALS_NEXT_KEY));
      await tx.prepare(`UPDATE personal_email_outbox SET action_kind='case_invite',encrypted_action_token=? WHERE message_id=?`).run(encrypted, message.id);
    }
    await tx.prepare(`INSERT INTO personal_share_operation(id,author_user_id,idempotency_key,input_hash,kind,message_id,result_id) VALUES(?,?,?,?,?,?,?)`)
      .run(randomUUID(), person.userId, input.idempotencyKey, hash, 'case', message.id, invitation.id);
    return { messageId: message.id, wake: target.kind === 'external' };
  });
  if (result.wake)
    await wakePersonalEmailWorker();
  const message = await getMessageForViewer(result.messageId, person.userId);
  if (message.body.kind === 'document_share') {
    return { kind: 'document' as const, message, share: { id: message.body.shareId, state: message.body.state } };
  }
  if (message.body.kind === 'case_invitation') {
    return { kind: 'case' as const, message, invitation: { id: message.body.invitationId, state: message.body.state } };
  }
  throw new CapabilityError('CONFLICT', 'Esta operação não corresponde a um compartilhamento.');
}
export async function revokeDocumentShare(context: WorkspaceContext, shareId: string) {
  await withTransaction(async (tx) => {
    await assertLiveSession(tx, context);
    const share = await tx.prepare('SELECT office_id,state FROM vault_document_share WHERE id=? FOR UPDATE').get<{
      office_id: string;
      state: string;
    }>(shareId);
    if (!share)
      throw new CapabilityError('NOT_FOUND', 'Compartilhamento não encontrado.');
    await assertOfficeWriter(tx, context.userId, share.office_id);
    await tx.prepare(`UPDATE vault_document_share SET state='revoked',revoked_at=CURRENT_TIMESTAMP,encrypted_token=NULL WHERE id=? AND state<>'revoked'`).run(shareId);
    await tx.prepare(`UPDATE personal_email_outbox SET state='cancelled',encrypted_action_token='',updated_at=CURRENT_TIMESTAMP WHERE message_id IN
    (SELECT message_id FROM personal_share_operation WHERE kind='document' AND result_id=?)
    AND (state IN ('pending','retry') OR (state='leased' AND dispatched_at IS NULL))`).run(shareId);
  });
}
export async function readDocumentShare(context: PersonContext, shareId: string) {
  const select = `SELECT s.state,s.recipient_user_id,s.granted_by,s.office_id,s.document_id,s.document_version_id,v.original_name,v.stored_name,v.mime_type,v.version,d.deleted_at,
  EXISTS(SELECT 1 FROM office_member m WHERE m.office_id=s.office_id AND m.user_id=s.granted_by AND m.role IN ('administrator','lawyer')) AS owner_live
  FROM vault_document_share s JOIN vault_document d ON d.id=s.document_id AND d.office_id=s.office_id
  JOIN vault_document_version v ON v.id=s.document_version_id AND v.document_id=s.document_id AND v.office_id=s.office_id
  WHERE s.id=? AND d.case_id IS NOT DISTINCT FROM s.source_case_id
    AND (s.source_case_id IS NULL OR EXISTS(SELECT 1 FROM vault_case c WHERE c.id=s.source_case_id AND c.office_id=s.office_id AND c.deleted_at IS NULL))`;
  if (context.sessionId && !await database.prepare('SELECT 1 FROM session WHERE id=? AND userId=? AND expiresAt>CURRENT_TIMESTAMP').get(context.sessionId, context.userId))
    throw new CapabilityError('UNAUTHENTICATED', 'Sua sessão foi encerrada.');
  const row = await database.prepare(select).get<{
    state: string;
    recipient_user_id: string | null;
    granted_by: string;
    office_id: string;
    document_id: string;
    document_version_id: string;
    original_name: string;
    stored_name: string;
    mime_type: string;
    version: string | number;
    deleted_at: string | null;
    owner_live: boolean;
  }>(shareId);
  const recipientAllowed = row?.state === 'active' && row.recipient_user_id === context.userId;
  const ownerAllowed = row?.granted_by === context.userId && row.state !== 'revoked' && row.owner_live;
  if (!row || (!recipientAllowed && !ownerAllowed) || row.deleted_at)
    throw new CapabilityError('NOT_FOUND', 'Documento compartilhado não encontrado.');
  const buffer = await readVaultOriginal({ storedName: row.stored_name });
  if (context.sessionId && !await database.prepare('SELECT 1 FROM session WHERE id=? AND userId=? AND expiresAt>CURRENT_TIMESTAMP').get(context.sessionId, context.userId))
    throw new CapabilityError('UNAUTHENTICATED', 'Sua sessão foi encerrada.');
  const current = await database.prepare(select).get<typeof row>(shareId);
  const currentAllowed = current && (current.state === 'active' && current.recipient_user_id === context.userId || current.granted_by === context.userId && current.state !== 'revoked' && current.owner_live);
  if (!current || !currentAllowed || current.deleted_at)
    throw new CapabilityError('NOT_FOUND', 'Este acesso foi revogado.');
  return { buffer, name: row.original_name, mimeType: row.mime_type };
}
