import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { database, withTransaction, type Transaction } from '@/lib/database';
import { decryptCredential, parseCredentialKeyring } from '@/lib/platform-crypto';
import { personalChatEnvironment } from './environment';
import { personalEmailSettings, sendPersonalEmail } from './email-transport';

const bodySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text: z.string().max(20_000) }),
  z.object({ kind: z.literal('document_share'), shareId: z.string().uuid(), name: z.string().max(500) }),
  z.object({ kind: z.literal('case_invitation'), invitationId: z.string().uuid(), caseName: z.string().max(500) }),
]);
type ClaimedEmail = {
  id: string; leaseToken: string; attempts: number; recipient_email: string; sender_name: string;
  sender_user_id: string; sender_session_id: string | null; thread_id: string; invitation_id: string;
  action_kind: 'thread_claim' | 'document_claim' | 'case_invite'; encrypted_action_token: string;
  body_json: unknown;
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

function content(row: ClaimedEmail) {
  const body = bodySchema.parse(typeof row.body_json === 'string' ? JSON.parse(row.body_json) : row.body_json);
  const env = personalChatEnvironment();
  const origin = new URL(env.BETTER_AUTH_URL ?? '');
  if (origin.username || origin.password || (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname)))) throw new Error('invalid_origin');
  const token = decryptCredential(row.encrypted_action_token, parseCredentialKeyring(env.K5_CREDENTIALS_KEY, env.K5_CREDENTIALS_PREVIOUS_KEYS, env.K5_CREDENTIALS_NEXT_KEY));
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(token)) throw new Error('invalid_action');
  const link = new URL(`${row.action_kind === 'case_invite' ? '/invite/' : '/messages/claim/'}${encodeURIComponent(token)}`, origin.origin).href;
  const sender = row.sender_name.replace(/[\r\n\u0000-\u001f]/g, ' ').slice(0, 120);
  const text = body.kind === 'text' ? body.text : body.kind === 'document_share'
    ? `${sender} compartilhou o documento "${body.name}".` : `${sender} convidou você para o caso "${body.caseName}".`;
  const note = 'Esta mensagem foi enviada pelo Lume. Respostas por e-mail não entram na conversa.';
  return { subject: `Nova mensagem de ${sender}`, text: `${text}\n\nAbrir no Lume: ${link}\n\n${note}`,
    html: `<p style="white-space:pre-wrap">${escapeHtml(text)}</p><p><a href="${escapeHtml(link)}">Abrir no Lume</a></p><p>${note}</p>` };
}

async function claim(): Promise<ClaimedEmail | undefined> {
  return withTransaction(async tx => {
    await tx.prepare(`UPDATE personal_email_outbox SET state='unknown',error_code='lease_expired_after_dispatch',lease_token=NULL,lease_until=NULL,updated_at=CURRENT_TIMESTAMP
      WHERE state='leased' AND lease_until<CURRENT_TIMESTAMP AND dispatched_at IS NOT NULL`).run();
    const row = await tx.prepare(`SELECT o.*,u.name AS sender_name,m.sender_user_id,m.sender_session_id,m.body_json
      FROM personal_email_outbox o JOIN personal_message m ON m.id=o.message_id JOIN "user" u ON u.id=m.sender_user_id
      WHERE (o.state IN ('pending','retry') AND o.next_attempt_at<=CURRENT_TIMESTAMP)
        OR (o.state='leased' AND o.lease_until<CURRENT_TIMESTAMP AND o.dispatched_at IS NULL)
      ORDER BY o.next_attempt_at,o.id FOR UPDATE OF o SKIP LOCKED LIMIT 1`).get<Omit<ClaimedEmail, 'leaseToken'>>();
    if (!row) return undefined;
    const leaseToken = randomUUID();
    await tx.prepare(`UPDATE personal_email_outbox SET state='leased',lease_token=?,lease_until=CURRENT_TIMESTAMP+INTERVAL '60 seconds',
      attempts=attempts+1,dispatched_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(leaseToken, row.id);
    return { ...row, leaseToken, attempts: Number(row.attempts) + 1 };
  });
}

async function authorized(tx: Transaction, row: ClaimedEmail) {
  if (!row.sender_session_id || !await tx.prepare('SELECT 1 FROM session WHERE id=? AND userId=? AND expiresAt>CURRENT_TIMESTAMP').get(row.sender_session_id, row.sender_user_id)) return false;
  if (!await tx.prepare('SELECT 1 FROM personal_thread_participant WHERE thread_id=? AND user_id=? AND blocked_at IS NULL').get(row.thread_id, row.sender_user_id)) return false;
  if (await tx.prepare('SELECT 1 FROM personal_thread_participant WHERE thread_id=? AND blocked_at IS NOT NULL').get(row.thread_id)) return false;
  const invitation = await tx.prepare('SELECT normalized_email,state,expires_at FROM personal_thread_invitation WHERE id=? AND thread_id=?')
    .get<{ normalized_email: string; state: string; expires_at: string }>(row.invitation_id, row.thread_id);
  if (!invitation || invitation.normalized_email !== row.recipient_email || invitation.state === 'revoked') return false;
  const body = bodySchema.parse(typeof row.body_json === 'string' ? JSON.parse(row.body_json) : row.body_json);
  if (row.action_kind === 'thread_claim') return body.kind === 'text' && invitation.state === 'pending' && Date.parse(invitation.expires_at) > Date.now();
  if (row.action_kind === 'document_claim' && body.kind === 'document_share') {
    return Boolean(await tx.prepare(`SELECT 1 FROM vault_document_share s
      JOIN vault_document d ON d.id=s.document_id AND d.office_id=s.office_id AND d.deleted_at IS NULL
      JOIN vault_document_version v ON v.id=s.document_version_id AND v.document_id=d.id AND v.office_id=d.office_id
      JOIN office_member m ON m.office_id=s.office_id AND m.user_id=s.granted_by
      WHERE s.id=? AND s.invitation_id=? AND vault_folder_visible(d.folder_id, s.granted_by) AND s.conversation_id=? AND s.granted_by=? AND s.state='pending'
        AND s.expires_at>CURRENT_TIMESTAMP AND s.revoked_at IS NULL AND d.case_id IS NOT DISTINCT FROM s.source_case_id
        AND (s.source_case_id IS NULL OR EXISTS(SELECT 1 FROM vault_case c WHERE c.id=s.source_case_id AND c.deleted_at IS NULL))`)
      .get(body.shareId, row.invitation_id, row.thread_id, row.sender_user_id));
  }
  // Case invitations by e-mail no longer exist: one still queued from before is never sent.
  return false;
}

async function finish(row: ClaimedEmail, state: 'accepted' | 'retry' | 'unknown' | 'failed' | 'cancelled', providerRef: string | null, code: string | null) {
  const finalState = state === 'retry' && row.attempts >= 5 ? 'failed' : state;
  const seconds = Math.min(3600, 30 * 2 ** Math.min(row.attempts, 6));
  await database.prepare(`UPDATE personal_email_outbox SET state=?,provider_ref=?,error_code=?,lease_token=NULL,lease_until=NULL,
    encrypted_action_token=CASE WHEN ? IN ('accepted','failed','cancelled') THEN '' ELSE encrypted_action_token END,
    next_attempt_at=CASE WHEN ?='retry' THEN CURRENT_TIMESTAMP+(?*INTERVAL '1 second') ELSE next_attempt_at END,updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND state IN ('leased','unknown') AND lease_token=?`).run(finalState, providerRef, code, finalState, finalState, seconds, row.id, row.leaseToken);
}

export async function runPersonalEmailPass({ max = 10 }: { max?: number } = {}): Promise<number> {
  let processed = 0;
  while (processed < Math.max(0, Math.min(max, 100))) {
    const row = await claim();
    if (!row) break;
    processed += 1;
    if (!personalEmailSettings()) { await finish(row, 'failed', null, 'not_configured'); continue; }
    let message: ReturnType<typeof content>;
    try { message = content(row); }
    catch { await finish(row, 'failed', null, 'invalid_content_or_configuration'); continue; }
    const dispatch = await withTransaction(async tx => {
      const lease = await tx.prepare(`SELECT 1 FROM personal_email_outbox WHERE id=? AND state='leased' AND lease_token=? AND lease_until>CURRENT_TIMESTAMP FOR UPDATE`)
        .get(row.id, row.leaseToken);
      if (!lease) return false;
      if (!await authorized(tx, row)) return false;
      await tx.prepare('UPDATE personal_email_outbox SET dispatched_at=CURRENT_TIMESTAMP WHERE id=? AND lease_token=?').run(row.id, row.leaseToken);
      return true;
    });
    if (!dispatch) { await finish(row, 'cancelled', null, 'access_removed'); continue; }
    const result = await sendPersonalEmail({ to: row.recipient_email, ...message });
    await finish(row, result.state, result.state === 'accepted' ? result.providerRef : null, result.state === 'accepted' ? null : result.code);
  }
  return processed;
}
