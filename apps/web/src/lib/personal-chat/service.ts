import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { database, withTransaction, type Database, type Transaction } from '@/lib/database';
import { CapabilityError } from '@/lib/capabilities/errors';
import { caseAccess } from '@/lib/collaboration/access';
import { encryptCredential, parseCredentialKeyring } from '@/lib/platform-crypto';
import type { PersonContext } from './auth';
import type { MessageBody, PersonalMessage, PersonalThread, SendMessageInput, StartThreadInput } from './domain';
import { personalChatEnvironment } from './environment';
import { wakePersonalEmailWorker } from './wake';
type Participant = {
  visible_from_sequence: string | number;
  last_read_sequence: string | number;
};
type Invitation = {
  id: string;
  normalized_email: string;
  state: string;
  claimed_by: string | null;
  encrypted_token: string;
  expires_at: string;
};
type MessageRow = {
  id: string;
  thread_id: string;
  sequence: string | number;
  sender_user_id: string;
  sender_name: string;
  body_kind: MessageBody['kind'];
  body_json: MessageBody | string;
  created_at: string;
  outbox_state: string | null;
  error_code: string | null;
};
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const normalizeEmail = (value: string) => value.trim().toLowerCase();
const canonicalHash = (value: unknown) => digest(JSON.stringify(value));
const directKey = (first: string, second: string) => `direct:${digest([first, second].sort().join('\u0000'))}`;
const notFound = () => new CapabilityError('NOT_FOUND', 'Conversa não encontrada.');
function encodeCursor(value: string | number) {
  return Buffer.from(String(value)).toString('base64url');
}
function decodeCursor(value?: string) {
  if (!value)
    return undefined;
  const decoded = Buffer.from(value, 'base64url').toString('utf8');
  if (!/^\d+$/.test(decoded))
    throw new CapabilityError('INVALID', 'Cursor inválido.');
  return decoded;
}
function bodyOf(value: MessageRow['body_json']): MessageBody {
  return (typeof value === 'string' ? JSON.parse(value) : value) as MessageBody;
}
function preview(body: MessageBody) {
  if (body.kind === 'text')
    return body.text.slice(0, 240);
  if (body.kind === 'document_share')
    return `Documento: ${body.name}`.slice(0, 240);
  return `Caso: ${body.caseName}`.slice(0, 240);
}
async function assertLiveSession(tx: Transaction, context: PersonContext) {
  if (context.sessionId && !await tx.prepare('SELECT 1 FROM session WHERE id=? AND userId=? AND expiresAt>CURRENT_TIMESTAMP').get(context.sessionId, context.userId))
    throw new CapabilityError('UNAUTHENTICATED', 'Sua sessão foi encerrada.');
}
async function participant(db: Database | Transaction, threadId: string, userId: string, lock = false) {
  return db.prepare(`SELECT visible_from_sequence,last_read_sequence FROM personal_thread_participant
  WHERE thread_id=? AND user_id=? AND blocked_at IS NULL${lock ? ' FOR UPDATE' : ''}`).get<Participant>(threadId, userId);
}
async function invitation(db: Database | Transaction, threadId: string) {
  return db.prepare('SELECT id,normalized_email,state,claimed_by,encrypted_token,expires_at FROM personal_thread_invitation WHERE thread_id=?')
    .get<Invitation>(threadId);
}
async function threadDto(db: Database | Transaction, threadId: string, userId: string): Promise<PersonalThread> {
  const membership = await participant(db, threadId, userId);
  if (!membership)
    throw notFound();
  const thread = await db.prepare('SELECT id,created_by,updated_at FROM personal_thread WHERE id=?').get<{
    id: string;
    created_by: string;
    updated_at: string;
  }>(threadId);
  if (!thread)
    throw notFound();
  const invite = await invitation(db, threadId);
  const last = await db.prepare(`SELECT id,body_json,created_at FROM personal_message WHERE thread_id=? AND sequence>=?
  ORDER BY sequence DESC LIMIT 1`).get<{
    id: string;
    body_json: MessageBody | string;
    created_at: string;
  }>(threadId, membership.visible_from_sequence);
  const lastMessage = last ? { id: last.id, preview: preview(bodyOf(last.body_json)), createdAt: new Date(last.created_at).toISOString() } : null;
  if (invite && thread.created_by === userId && invite.state !== 'claimed')
    return {
      id: thread.id, channel: 'email_outbound', peer: { kind: 'external_email', email: invite.normalized_email, outboundOnly: true },
      lastMessage, unreadCount: 0, updatedAt: new Date(thread.updated_at).toISOString(),
    };
  const peer = await db.prepare(`SELECT u.id,u.name,u.email FROM personal_thread_participant p JOIN "user" u ON u.id=p.user_id
  WHERE p.thread_id=? AND p.user_id<>? AND p.blocked_at IS NULL ORDER BY p.joined_at LIMIT 1`).get<{
    id: string;
    name: string;
    email: string;
  }>(threadId, userId);
  if (!peer)
    throw notFound();
  const unread = await db.prepare(`SELECT count(*) AS count FROM personal_message WHERE thread_id=? AND sequence>? AND sequence>=? AND sender_user_id<>?`)
    .get<{
    count: string | number;
  }>(threadId, membership.last_read_sequence, membership.visible_from_sequence, userId);
  return { id: thread.id, channel: 'in_app', peer: { kind: 'user', userId: peer.id, name: peer.name, email: peer.email },
    lastMessage, unreadCount: Number(unread?.count ?? 0), updatedAt: new Date(thread.updated_at).toISOString() };
}
async function messageDto(row: MessageRow, viewerId: string): Promise<PersonalMessage> {
  const body = bodyOf(row.body_json);
  if (body.kind === 'document_share') {
    const share = await database.prepare(`SELECT s.state,s.granted_by,
    EXISTS(SELECT 1 FROM office_member m WHERE m.office_id=s.office_id AND m.user_id=s.granted_by AND m.role IN ('administrator','lawyer')) AS owner_live,
    EXISTS(SELECT 1 FROM vault_document d WHERE d.id=s.document_id AND d.office_id=s.office_id AND d.deleted_at IS NULL
    AND d.case_id IS NOT DISTINCT FROM s.source_case_id AND (s.source_case_id IS NULL OR EXISTS(SELECT 1 FROM vault_case c WHERE c.id=s.source_case_id AND c.deleted_at IS NULL))) AS source_live
    FROM vault_document_share s WHERE s.id=?`).get<{
      state: string;
      granted_by: string;
      owner_live: boolean;
      source_live: boolean;
    }>(body.shareId);
    body.state = !share || !share.source_live || (share.state === 'pending' && !share.owner_live) ? 'unavailable' : share.state === 'revoked' ? 'revoked'
      : share.state === 'pending' && share.granted_by !== viewerId ? 'pending_claim' : 'active';
    body.canRevoke = share?.granted_by === viewerId && share.state !== 'revoked' && share.owner_live && share.source_live;
  }
  else if (body.kind === 'case_invitation') {
    const invite = await database.prepare('SELECT status,expires_at,case_id FROM collaboration_invitation WHERE id=? AND kind=\'case\'')
      .get<{
      status: Extract<MessageBody, {
        kind: 'case_invitation';
      }>['state'];
      expires_at: string;
      case_id: string | null;
    }>(body.invitationId);
    body.state = !invite || (invite.status === 'pending' && Date.parse(invite.expires_at) <= Date.now()) ? 'expired'
      : invite.status;
    body.actionPath = body.state === 'pending' && row.sender_user_id !== viewerId && body.actionPath?.startsWith('/invite/') ? body.actionPath : null;
    if (invite?.case_id && (body.state === 'accepted' || (body.state === 'pending' && row.sender_user_id === viewerId))) {
      try {
        const access = await caseAccess(viewerId, invite.case_id);
        body.actionPath = `/app/vault/cases/${encodeURIComponent(access.caseId)}`;
      } catch (error) {
        if (!(error instanceof CapabilityError) || error.code !== 'NOT_FOUND')
          throw error;
      }
    }
  }
  const createdAt = new Date(row.created_at).toISOString();
  if (row.sender_user_id !== viewerId)
    return { id: row.id, direction: 'incoming', body, createdAt, sender: { userId: row.sender_user_id, name: row.sender_name } };
  if (row.outbox_state) {
    const state = row.outbox_state === 'leased' ? 'pending' : row.outbox_state as 'pending' | 'accepted' | 'retry' | 'unknown' | 'failed' | 'cancelled';
    const errorLabel = state === 'unknown' ? 'Confirmação de envio pendente.' : state === 'failed' ? 'Não foi possível entregar o e-mail.'
      : state === 'retry' ? 'Nova tentativa agendada.' : state === 'cancelled' ? 'Envio cancelado.' : null;
    return { id: row.id, direction: 'outgoing', body, createdAt, delivery: { kind: 'email', state, errorLabel } };
  }
  const read = await database.prepare(`SELECT last_read_at FROM personal_thread_participant WHERE thread_id=? AND user_id<>? AND last_read_sequence>=? AND blocked_at IS NULL LIMIT 1`)
    .get<{
    last_read_at: string;
  }>(row.thread_id, viewerId, row.sequence);
  return { id: row.id, direction: 'outgoing', body, createdAt,
    delivery: read ? { kind: 'in_app', state: 'read', readAt: new Date(read.last_read_at).toISOString() } : { kind: 'in_app', state: 'sent', readAt: null } };
}
const messageSelect = `SELECT m.id,m.thread_id,m.sequence,m.sender_user_id,u.name AS sender_name,m.body_kind,m.body_json,m.created_at,
  o.state AS outbox_state,o.error_code FROM personal_message m JOIN "user" u ON u.id=m.sender_user_id
  LEFT JOIN personal_email_outbox o ON o.message_id=m.id`;
export async function getThread(context: PersonContext, threadId: string) {
  return threadDto(database, threadId, context.userId);
}
export async function listThreads(context: PersonContext, input: {
  cursor?: string;
  limit: number;
}) {
  const offset = Number(decodeCursor(input.cursor) ?? 0);
  const rows = await database.prepare(`SELECT t.id FROM personal_thread t JOIN personal_thread_participant p ON p.thread_id=t.id
  WHERE p.user_id=? AND p.blocked_at IS NULL ORDER BY t.updated_at DESC,t.id LIMIT ? OFFSET ?`).all<{
    id: string;
  }>(context.userId, input.limit + 1, offset);
  const page = rows.slice(0, input.limit);
  return { threads: await Promise.all(page.map(row => threadDto(database, row.id, context.userId))), nextCursor: rows.length > input.limit ? encodeCursor(offset + input.limit) : null };
}
export async function listMessages(context: PersonContext, threadId: string, input: {
  before?: string;
  limit: number;
}) {
  const membership = await participant(database, threadId, context.userId);
  if (!membership)
    throw notFound();
  const before = decodeCursor(input.before);
  const rows = await database.prepare(`${messageSelect} WHERE m.thread_id=? AND m.sequence>=? ${before ? 'AND m.sequence<?' : ''}
  ORDER BY m.sequence DESC LIMIT ?`).all<MessageRow>(threadId, membership.visible_from_sequence, ...(before ? [before] : []), input.limit + 1);
  const page = rows.slice(0, input.limit);
  return { thread: await threadDto(database, threadId, context.userId), messages: await Promise.all(page.map(row => messageDto(row, context.userId))),
    olderCursor: rows.length > input.limit && page.length ? encodeCursor(page[page.length - 1]!.sequence) : null };
}
async function knownContact(db: Database | Transaction, actorId: string, targetId: string, officeId: string) {
  if (actorId === targetId)
    return false;
  const actor = await db.prepare('SELECT 1 FROM office_member WHERE office_id=? AND user_id=?').get(officeId, actorId);
  if (!actor)
    return false;
  return Boolean(await db.prepare(`SELECT 1 FROM "user" u WHERE u.id=? AND (
  EXISTS(SELECT 1 FROM office_member m WHERE m.office_id=? AND m.user_id=u.id) OR
  EXISTS(SELECT 1 FROM office_associate a WHERE a.office_id=? AND a.user_id=u.id) OR
  EXISTS(SELECT 1 FROM case_participant p JOIN vault_case c ON c.id=p.case_id WHERE c.office_id=? AND p.user_id=u.id AND p.revoked_at IS NULL)
  )`).get(targetId, officeId, officeId, officeId));
}
export async function listContacts(context: PersonContext, officeId: string, input: {
  query: string;
  cursor?: string;
  limit: number;
}) {
  const offset = Number(decodeCursor(input.cursor) ?? 0);
  const like = `%${input.query.replace(/[\\%_]/g, '\\$&')}%`;
  const rows = await database.prepare(`WITH candidates AS (
  SELECT m.user_id,'team' source FROM office_member m WHERE m.office_id=? UNION ALL
  SELECT a.user_id,'associate' FROM office_associate a WHERE a.office_id=? UNION ALL
  SELECT p.user_id,'case_participant' FROM case_participant p JOIN vault_case c ON c.id=p.case_id WHERE c.office_id=? AND p.revoked_at IS NULL)
  SELECT u.id AS "userId",u.name,u.email,array_agg(DISTINCT c.source) AS sources FROM candidates c JOIN "user" u ON u.id=c.user_id
  WHERE u.id<>? AND (u.name ILIKE ? ESCAPE '\\' OR u.email ILIKE ? ESCAPE '\\') GROUP BY u.id,u.name,u.email ORDER BY u.name,u.id LIMIT ? OFFSET ?`)
    .all<{
    userId: string;
    name: string;
    email: string;
    sources: Array<'team' | 'associate' | 'case_participant'>;
  }>(officeId, officeId, officeId, context.userId, like, like, input.limit + 1, offset);
  return { contacts: rows.slice(0, input.limit), nextCursor: rows.length > input.limit ? encodeCursor(offset + input.limit) : null };
}
async function createDirect(tx: Transaction, actorId: string, targetId: string, requestedId: string) {
  const key = directKey(actorId, targetId);
  let thread = await tx.prepare('SELECT id FROM personal_thread WHERE direct_key=?').get<{
    id: string;
  }>(key);
  if (!thread) {
    await tx.prepare('INSERT INTO personal_thread(id,created_by,direct_key) VALUES(?,?,?) ON CONFLICT(direct_key) DO NOTHING').run(requestedId, actorId, key);
    thread = await tx.prepare('SELECT id FROM personal_thread WHERE direct_key=?').get<{
      id: string;
    }>(key);
  }
  if (!thread)
    throw new Error('Could not create personal thread.');
  await tx.prepare(`INSERT INTO personal_thread_participant(thread_id,user_id) VALUES(?,?),(?,?) ON CONFLICT DO NOTHING`)
    .run(thread.id, actorId, thread.id, targetId);
  return thread.id;
}
export async function startThread(context: PersonContext, officeId: string, input: StartThreadInput) {
  const threadId = await withTransaction(async (tx) => {
    await assertLiveSession(tx, context);
    const requestHash = canonicalHash(input.recipient);
    await tx.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?,0))')
      .get(`personal-start:${context.userId}:${input.requestId}`);
    const prior = await tx.prepare(`SELECT input_hash,thread_id FROM personal_start_operation
    WHERE author_user_id=? AND request_id=?`).get<{
      input_hash: string;
      thread_id: string;
    }>(context.userId, input.requestId);
    if (prior) {
      if (prior.input_hash !== requestHash) {
        throw new CapabilityError('CONFLICT', 'Esta operação já foi usada com outro destinatário.');
      }
      return prior.thread_id;
    }
    const record = async (id: string) => {
      await tx.prepare(`INSERT INTO personal_start_operation(author_user_id,request_id,input_hash,thread_id)
    VALUES(?,?,?,?)`).run(context.userId, input.requestId, requestHash, id);
      return id;
    };
    if (input.recipient.kind === 'known_user') {
      if (!await knownContact(tx, context.userId, input.recipient.userId, officeId))
        throw new CapabilityError('FORBIDDEN', 'Escolha um contato conhecido deste escritório.');
      return record(await createDirect(tx, context.userId, input.recipient.userId, input.requestId));
    }
    const email = normalizeEmail(input.recipient.email);
    if (email === normalizeEmail(context.email))
      throw new CapabilityError('INVALID', 'Escolha outra pessoa.');
    await tx.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?,0))').get(`personal-thread:${context.userId}:${email}`);
    const resolved = await tx.prepare(`SELECT u.id FROM "user" u WHERE lower(u.email)=? AND u."emailVerified"=true
    UNION SELECT a.user_id FROM personal_verified_address a JOIN "user" verified ON verified.id=a.user_id AND lower(verified.email)=a.normalized_email
    WHERE a.normalized_email=? AND a.revoked_at IS NULL LIMIT 1`).get<{
      id: string;
    }>(email, email);
    if (resolved)
      return record(await createDirect(tx, context.userId, resolved.id, input.requestId));
    await tx.prepare(`UPDATE personal_thread_invitation SET state='expired' WHERE invited_by=? AND normalized_email=?
    AND state='pending' AND expires_at<=CURRENT_TIMESTAMP`).run(context.userId, email);
    const pending = await tx.prepare(`SELECT thread_id FROM personal_thread_invitation WHERE invited_by=? AND normalized_email=? AND state='pending' AND expires_at>CURRENT_TIMESTAMP`)
      .get<{
      thread_id: string;
    }>(context.userId, email);
    if (pending)
      return record(pending.thread_id);
    const expired = await tx.prepare(`SELECT id,thread_id FROM personal_thread_invitation WHERE invited_by=? AND normalized_email=? AND state='expired'
    ORDER BY created_at DESC LIMIT 1 FOR UPDATE`).get<{
      id: string;
      thread_id: string;
    }>(context.userId, email);
    const id = expired?.thread_id ?? input.requestId;
    const invitationId = expired?.id ?? randomUUID();
    const token = randomBytes(32).toString('base64url');
    const env = personalChatEnvironment();
    const ring = parseCredentialKeyring(env.K5_CREDENTIALS_KEY, env.K5_CREDENTIALS_PREVIOUS_KEYS, env.K5_CREDENTIALS_NEXT_KEY);
    if (expired) {
      await tx.prepare(`UPDATE personal_email_outbox SET state='cancelled',encrypted_action_token='',updated_at=CURRENT_TIMESTAMP WHERE invitation_id=?
    AND (state IN ('pending','retry') OR (state='leased' AND dispatched_at IS NULL))`).run(invitationId);
      await tx.prepare(`UPDATE personal_thread_invitation SET state='pending',token_hash=?,encrypted_token=?,expires_at=CURRENT_TIMESTAMP+INTERVAL '7 days',
    claimed_by=NULL,claimed_at=NULL,visible_from_sequence=NULL WHERE id=?`).run(digest(token), encryptCredential(token, ring), invitationId);
    }
    else {
      await tx.prepare('INSERT INTO personal_thread(id,created_by) VALUES(?,?)').run(id, context.userId);
      await tx.prepare('INSERT INTO personal_thread_participant(thread_id,user_id) VALUES(?,?)').run(id, context.userId);
      await tx.prepare(`INSERT INTO personal_thread_invitation(id,thread_id,normalized_email,token_hash,encrypted_token,invited_by,expires_at)
    VALUES(?,?,?,?,?,?,CURRENT_TIMESTAMP+INTERVAL '7 days')`).run(invitationId, id, email, digest(token), encryptCredential(token, ring), context.userId);
    }
    return record(id);
  });
  return { thread: await threadDto(database, threadId, context.userId) };
}
async function insertMessage(tx: Transaction, context: PersonContext, threadId: string, clientMessageId: string, body: MessageBody) {
  const membership = await participant(tx, threadId, context.userId, true);
  if (!membership)
    throw notFound();
  const inputHash = canonicalHash({ threadId, body });
  const duplicate = await tx.prepare(`${messageSelect} WHERE m.sender_user_id=? AND m.client_message_id=?`).get<MessageRow>(context.userId, clientMessageId);
  if (duplicate) {
    const stored = await tx.prepare('SELECT input_hash FROM personal_message WHERE id=?').get<{
      input_hash: string;
    }>(duplicate.id);
    if (stored?.input_hash !== inputHash)
      throw new CapabilityError('CONFLICT', 'Esta operação já foi usada com outro conteúdo.');
    return duplicate;
  }
  const sequence = await tx.prepare(`UPDATE personal_thread SET next_sequence=next_sequence+1,updated_at=CURRENT_TIMESTAMP WHERE id=? RETURNING next_sequence-1 AS sequence`)
    .get<{
    sequence: string | number;
  }>(threadId);
  if (!sequence)
    throw notFound();
  const id = randomUUID();
  await tx.prepare(`INSERT INTO personal_message(id,thread_id,sequence,sender_user_id,sender_session_id,client_message_id,input_hash,body_kind,body_json)
  VALUES(?,?,?,?,?,?,?,?,?::jsonb)`).run(id, threadId, sequence.sequence, context.userId, context.sessionId ?? null, clientMessageId, inputHash, body.kind, JSON.stringify(body));
  const invite = await invitation(tx, threadId);
  if (invite?.state === 'pending' && Date.parse(invite.expires_at) <= Date.now())
    throw new CapabilityError('CONFLICT', 'Renove esta conversa pelo endereço de e-mail antes de enviar.');
  if (invite?.state === 'pending')
    await tx.prepare(`INSERT INTO personal_email_outbox(id,message_id,thread_id,invitation_id,recipient_email,encrypted_action_token)
  VALUES(?,?,?,?,?,?)`).run(randomUUID(), id, threadId, invite.id, invite.normalized_email, invite.encrypted_token);
  return (await tx.prepare(`${messageSelect} WHERE m.id=?`).get<MessageRow>(id))!;
}
export async function getMessageForViewer(messageId: string, viewerId: string) {
  const row = await database.prepare(`${messageSelect} WHERE m.id=?`).get<MessageRow>(messageId);
  const membership = row ? await participant(database, row.thread_id, viewerId) : undefined;
  if (!row || !membership || Number(row.sequence) < Number(membership.visible_from_sequence))
    throw notFound();
  return messageDto(row, viewerId);
}
export async function sendMessage(context: PersonContext, threadId: string, input: SendMessageInput) {
  const row = await withTransaction(async (tx) => {
    await assertLiveSession(tx, context);
    return insertMessage(tx, context, threadId, input.clientMessageId, input.body);
  });
  if (row.outbox_state)
    await wakePersonalEmailWorker();
  return { thread: await threadDto(database, threadId, context.userId), message: await messageDto(row, context.userId) };
}
export async function markRead(context: PersonContext, threadId: string, throughMessageId: string) {
  const readAt = await withTransaction(async (tx) => {
    await assertLiveSession(tx, context);
    const membership = await participant(tx, threadId, context.userId, true);
    if (!membership)
      throw notFound();
    const message = await tx.prepare('SELECT sequence FROM personal_message WHERE id=? AND thread_id=? AND sequence>=? AND sender_user_id<>?')
      .get<{
      sequence: string | number;
    }>(throughMessageId, threadId, membership.visible_from_sequence, context.userId);
    if (!message)
      throw new CapabilityError('INVALID', 'Mensagem não disponível para leitura.');
    await tx.prepare('UPDATE personal_thread_participant SET last_read_sequence=GREATEST(last_read_sequence,?),last_read_at=CURRENT_TIMESTAMP WHERE thread_id=? AND user_id=?')
      .run(message.sequence, threadId, context.userId);
    return new Date().toISOString();
  });
  return { readAt };
}
export async function claimAddress(context: PersonContext, token: string) {
  const result = await withTransaction(async (tx) => {
    await assertLiveSession(tx, context);
    const tokenHash = digest(token);
    const documentGrant = await tx.prepare(`SELECT s.id,s.state,s.recipient_user_id,s.expires_at,i.id AS invitation_id,i.thread_id,i.normalized_email,i.state AS invitation_state,i.claimed_by,
    v.original_name,v.mime_type,v.version FROM vault_document_share s JOIN personal_thread_invitation i ON i.id=s.invitation_id
    JOIN vault_document_version v ON v.id=s.document_version_id JOIN vault_document d ON d.id=s.document_id AND d.office_id=s.office_id
    JOIN office_member owner ON owner.office_id=s.office_id AND owner.user_id=s.granted_by AND owner.role IN ('administrator','lawyer')
    WHERE s.token_hash=? AND d.deleted_at IS NULL AND d.case_id IS NOT DISTINCT FROM s.source_case_id
    AND (s.source_case_id IS NULL OR EXISTS(SELECT 1 FROM vault_case c WHERE c.id=s.source_case_id AND c.office_id=s.office_id AND c.deleted_at IS NULL))
    FOR UPDATE OF s,i`).get<{
      id: string;
      state: string;
      recipient_user_id: string | null;
      expires_at: string;
      invitation_id: string;
      thread_id: string;
      normalized_email: string;
      invitation_state: string;
      claimed_by: string | null;
      original_name: string;
      mime_type: string;
      version: string | number;
    }>(tokenHash);
    const invite = documentGrant ? {
      id: documentGrant.invitation_id, thread_id: documentGrant.thread_id, normalized_email: documentGrant.normalized_email,
      state: documentGrant.invitation_state, expires_at: documentGrant.expires_at, claimed_by: documentGrant.claimed_by,
    } : await tx.prepare(`SELECT * FROM personal_thread_invitation WHERE token_hash=? FOR UPDATE`).get<{
      id: string;
      thread_id: string;
      normalized_email: string;
      state: string;
      expires_at: string;
      claimed_by: string | null;
    }>(tokenHash);
    const repeated = invite?.state === 'claimed' && invite.claimed_by === context.userId;
    if (!invite || (!repeated && invite.state !== 'pending') || Date.parse(invite.expires_at) <= Date.now() || normalizeEmail(context.email) !== invite.normalized_email)
      throw new CapabilityError('NOT_FOUND', 'Link inválido ou destinado a outra conta.');
    if (documentGrant && documentGrant.state !== 'pending' && documentGrant.state !== 'active')
      throw new CapabilityError('NOT_FOUND', 'Este compartilhamento não está mais disponível.');
    if (documentGrant?.state === 'active' && documentGrant.recipient_user_id !== context.userId)
      throw new CapabilityError('NOT_FOUND', 'Link inválido ou destinado a outra conta.');
    const thread = await tx.prepare('SELECT next_sequence FROM personal_thread WHERE id=? FOR UPDATE').get<{
      next_sequence: string | number;
    }>(invite.thread_id);
    if (!thread)
      throw notFound();
    const existingAddress = await tx.prepare('SELECT user_id FROM personal_verified_address WHERE normalized_email=? AND revoked_at IS NULL FOR UPDATE').get<{
      user_id: string;
    }>(invite.normalized_email);
    if (existingAddress && existingAddress.user_id !== context.userId)
      throw new CapabilityError('CONFLICT', 'Este endereço já foi confirmado por outra conta.');
    await tx.prepare(`INSERT INTO personal_verified_address(normalized_email,user_id) VALUES(?,?)
    ON CONFLICT(normalized_email) DO UPDATE SET user_id=excluded.user_id,verified_at=CURRENT_TIMESTAMP,revoked_at=NULL`).run(invite.normalized_email, context.userId);
    if (!repeated) {
      await tx.prepare(`INSERT INTO personal_thread_participant(thread_id,user_id,visible_from_sequence) VALUES(?,?,?)
    ON CONFLICT(thread_id,user_id) DO UPDATE SET visible_from_sequence=GREATEST(personal_thread_participant.visible_from_sequence,excluded.visible_from_sequence),blocked_at=NULL`)
        .run(invite.thread_id, context.userId, thread.next_sequence);
      await tx.prepare(`UPDATE personal_thread_invitation SET state='claimed',claimed_by=?,claimed_at=CURRENT_TIMESTAMP,
    visible_from_sequence=?,encrypted_token='' WHERE id=?`).run(context.userId, thread.next_sequence, invite.id);
    }
    let grantId: string | null = null;
    if (documentGrant) {
      if (documentGrant.state === 'pending')
        await tx.prepare(`UPDATE vault_document_share SET recipient_user_id=?,state='active',encrypted_token=NULL
    WHERE id=?`).run(context.userId, documentGrant.id);
      grantId = documentGrant.id;
    }
    if (documentGrant)
      await tx.prepare(`UPDATE personal_email_outbox o SET state='cancelled',encrypted_action_token='',updated_at=CURRENT_TIMESTAMP
    FROM personal_message m WHERE o.message_id=m.id AND o.invitation_id=? AND o.action_kind='document_claim'
    AND m.body_json->>'shareId'=? AND (o.state IN ('pending','retry') OR (o.state='leased' AND o.dispatched_at IS NULL))`).run(invite.id, documentGrant.id);
    else
      await tx.prepare(`UPDATE personal_email_outbox SET state='cancelled',encrypted_action_token='',updated_at=CURRENT_TIMESTAMP
    WHERE invitation_id=? AND action_kind='thread_claim' AND (state IN ('pending','retry') OR (state='leased' AND dispatched_at IS NULL))`).run(invite.id);
    return { verified: true as const, email: invite.normalized_email, threadId: invite.thread_id, grantId,
      path: grantId ? `/api/messages/document-shares/${encodeURIComponent(grantId)}/content` : `/app/messages?thread=${encodeURIComponent(invite.thread_id)}`,
      document: documentGrant ? { name: documentGrant.original_name, mimeType: documentGrant.mime_type, version: Number(documentGrant.version),
        contentUrl: `/api/messages/document-shares/${encodeURIComponent(documentGrant.id)}/content` } : null };
  });
  return result;
}
export { insertMessage, messageDto, threadDto };
