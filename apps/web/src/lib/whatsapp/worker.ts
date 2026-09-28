import 'server-only';
import { database, withTransaction, type Transaction } from '@/lib/database';
import { CapabilityError } from '@/lib/capabilities/errors';
import { decryptCredential, parseCredentialKeyring } from '@/lib/platform-crypto';
import { connectedCredential, finishDisconnect, finishRevokeKey } from './connection';
import type { ConnectionRow } from './domain';
import { whatsappEnvironment } from './environment';
import { claimWhatsAppJob, completeWhatsAppJob, enqueueWhatsAppJob, failWhatsAppJob, ownsWhatsAppJob, type WhatsAppJob } from './jobs';
import { reserveWhatsAppApiCall } from './limits';
import { projectConversation, projectMessage, type ThreadRow } from './projection';
import { listProviderConversations, listProviderMessages } from './provider';
import { ZernioError } from './transport';
import { parseWhatsAppWebhook } from './webhooks';

async function connectionForJob(job: WhatsAppJob, db: Transaction = database, lock = false) {
  return db.prepare(`SELECT * FROM whatsapp_connection WHERE id=? AND office_id=? ${lock ? 'FOR UPDATE' : ''}`)
    .get<ConnectionRow>(job.connection_id, job.office_id);
}

function canSync(connection: ConnectionRow | undefined, job: WhatsAppJob): connection is ConnectionRow & { account_id: string; profile_id: string } {
  return Boolean(connection && connection.status === 'connected' && connection.generation === job.generation
    && connection.account_id && connection.profile_id);
}

async function processEvent(job: WhatsAppJob) {
  await withTransaction(async tx => {
    const connection = await connectionForJob(job, tx, true);
    if (!await ownsWhatsAppJob(tx, job)) return;
    const stored = await tx.prepare(`SELECT encrypted_payload FROM whatsapp_event
      WHERE id=? AND office_id=? AND connection_id=? AND processed_at IS NULL`)
      .get<{ encrypted_payload: string }>(job.subject_id, job.office_id, job.connection_id);
    if (stored && connection && (connection.status === 'connected' || connection.status === 'reconnect_required'
      || connection.status === 'pending' && connection.verified_at !== null)) {
      const env = whatsappEnvironment();
      const keyring = parseCredentialKeyring(env.K5_CREDENTIALS_KEY, env.K5_CREDENTIALS_PREVIOUS_KEYS, env.K5_CREDENTIALS_NEXT_KEY);
      const event = parseWhatsAppWebhook(decryptCredential(stored.encrypted_payload, keyring));
      if (event.kind !== 'ignored' && event.accountId === connection.account_id && event.profileId === connection.profile_id) {
        if (event.kind === 'message') await projectMessage(tx, connection, event.message);
        if (event.kind === 'conversations' && connection.status === 'connected') {
          await enqueueWhatsAppJob(tx, { officeId: job.office_id, connectionId: job.connection_id,
            generation: connection.generation, kind: 'conversations',
            dedupeKey: `whatsapp:conversations:${connection.id}:${connection.generation}` });
          await tx.prepare(`UPDATE whatsapp_connection SET sync_state='pending' WHERE id=?`).run(connection.id);
        }
      }
    }
    await tx.prepare(`UPDATE whatsapp_event SET processed_at=CURRENT_TIMESTAMP WHERE id=? AND office_id=? AND connection_id=?`)
      .run(job.subject_id, job.office_id, job.connection_id);
    await completeWhatsAppJob(job, tx);
  });
}

async function processConversations(job: WhatsAppJob) {
  const initial = await connectionForJob(job);
  if (!canSync(initial, job)) { await completeWhatsAppJob(job); return; }
  await reserveWhatsAppApiCall(job.office_id);
  const page = await listProviderConversations(connectedCredential(initial), initial.account_id, initial.profile_id, initial.sync_cursor ?? undefined);
  if (page.nextCursor && page.nextCursor === initial.sync_cursor)
    throw new CapabilityError('INVALID', 'O provedor repetiu a página de conversas.');
  await withTransaction(async tx => {
    const connection = await connectionForJob(job, tx, true);
    if (!await ownsWhatsAppJob(tx, job)) return;
    if (!canSync(connection, job) || connection.account_id !== initial.account_id || connection.sync_cursor !== initial.sync_cursor) {
      await completeWhatsAppJob(job, tx); return;
    }
    for (const item of page.items) {
      const previous = await tx.prepare(`SELECT id,last_message_at FROM whatsapp_thread
        WHERE office_id=? AND connection_id=? AND account_id=? AND provider_id=?`)
        .get<{ id: string; last_message_at: string }>(job.office_id, job.connection_id, connection.account_id, item.id);
      await projectConversation(tx, connection, item);
      if (previous && Date.parse(item.updatedAt) > Date.parse(previous.last_message_at))
        await enqueueWhatsAppJob(tx, { officeId: job.office_id, connectionId: job.connection_id,
          generation: job.generation, kind: 'history_refresh', subjectId: previous.id,
          dedupeKey: `whatsapp:history_refresh:${connection.id}:${job.generation}:${previous.id}` });
    }
    await tx.prepare(`UPDATE whatsapp_connection SET sync_cursor=?,sync_state=?,synced_at=CURRENT_TIMESTAMP,
      updated_at=CURRENT_TIMESTAMP WHERE id=? AND generation=?`)
      .run(page.nextCursor, page.nextCursor ? 'pending' : 'idle', connection.id, job.generation);
    await completeWhatsAppJob(job, tx);
    if (page.nextCursor) await enqueueWhatsAppJob(tx, { officeId: job.office_id, connectionId: job.connection_id,
      generation: job.generation, kind: 'conversations', dedupeKey: `whatsapp:conversations:${connection.id}:${job.generation}` });
  });
}

async function processHistory(job: WhatsAppJob) {
  const initial = await connectionForJob(job);
  if (!canSync(initial, job)) { await completeWhatsAppJob(job); return; }
  const thread = await database.prepare(`SELECT * FROM whatsapp_thread
    WHERE id=? AND office_id=? AND connection_id=? AND account_id=?`)
    .get<ThreadRow>(job.subject_id, job.office_id, job.connection_id, initial.account_id);
  if (!thread || job.kind === 'history' && thread.history_complete) { await completeWhatsAppJob(job); return; }
  const cursor = job.kind === 'history_refresh' ? undefined : thread.history_cursor ?? undefined;
  await reserveWhatsAppApiCall(job.office_id);
  const page = await listProviderMessages(connectedCredential(initial), initial.account_id, thread.provider_id, cursor);
  if (page.nextCursor && page.nextCursor === cursor) throw new CapabilityError('INVALID', 'O provedor repetiu a página de mensagens.');
  await withTransaction(async tx => {
    const connection = await connectionForJob(job, tx, true);
    if (!await ownsWhatsAppJob(tx, job)) return;
    if (!canSync(connection, job) || connection.account_id !== thread.account_id) { await completeWhatsAppJob(job, tx); return; }
    const current = await tx.prepare(`SELECT history_cursor FROM whatsapp_thread
      WHERE id=? AND office_id=? AND connection_id=? AND account_id=? FOR UPDATE`)
      .get<{ history_cursor: string | null }>(thread.id, job.office_id, job.connection_id, connection.account_id);
    if (!current || job.kind === 'history' && current.history_cursor !== thread.history_cursor) { await completeWhatsAppJob(job, tx); return; }
    const overlap = job.kind === 'history_refresh' && Boolean(await tx.prepare(`SELECT 1 FROM whatsapp_message
      WHERE office_id=? AND thread_id=? AND provider_id=ANY(?::text[]) LIMIT 1`)
      .get(job.office_id, thread.id, page.items.map(item => item.id)));
    for (const item of page.items) {
      await projectMessage(tx, connection, { kind: 'history', thread: { providerId: thread.provider_id,
        participantId: thread.participant_id, participantName: thread.participant_name },
      providerId: item.id, direction: item.direction, source: item.source, text: item.text, status: item.status,
      deleted: item.deleted, edited: item.edited, attachments: item.attachments, unread: false,
      createdAt: item.createdAt, contentUpdatedAt: item.contentUpdatedAt });
    }
    if (job.kind === 'history' || page.nextCursor === null || !overlap) await tx.prepare(`UPDATE whatsapp_thread SET history_cursor=?,history_complete=?,
      updated_at=CURRENT_TIMESTAMP WHERE id=? AND office_id=?`)
      .run(page.nextCursor, page.nextCursor === null, thread.id, job.office_id);
    await completeWhatsAppJob(job, tx);
  });
}

async function processJob(job: WhatsAppJob) {
  switch (job.kind) {
    case 'event': return processEvent(job);
    case 'conversations': return processConversations(job);
    case 'history':
    case 'history_refresh': return processHistory(job);
    case 'disconnect':
      await finishDisconnect(job.connection_id, job.generation);
      return completeWhatsAppJob(job);
    case 'revoke_key':
      if (job.subject_id) await finishRevokeKey(job.connection_id, job.subject_id);
      return completeWhatsAppJob(job);
    default: {
      const exhaustive: never = job.kind;
      throw new Error(`Tipo de job desconhecido: ${exhaustive}`);
    }
  }
}

async function recordFailure(job: WhatsAppJob, error: unknown) {
  const authorizationFailed = error instanceof ZernioError && (error.status === 401 || error.status === 403);
  const invalid = error instanceof CapabilityError && error.code === 'INVALID';
  const code = error instanceof ZernioError ? `provider_${error.code}`
    : error instanceof CapabilityError && error.code === 'RATE_LIMITED' ? 'local_rate_limit'
      : invalid ? 'invalid_page' : 'processing_failed';
  const result = await failWhatsAppJob(job, code, !authorizationFailed && !invalid);
  if (!result.changed) return;
  if (authorizationFailed && ['history', 'history_refresh', 'conversations'].includes(job.kind)) {
    await withTransaction(async tx => {
      const connection = await connectionForJob(job, tx, true);
      if (!canSync(connection, job)) return;
      await tx.prepare(`UPDATE whatsapp_connection SET status='reconnect_required',generation=generation+1,
        sync_state='error',updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(connection.id);
      await tx.prepare(`UPDATE whatsapp_send SET status=CASE WHEN status='pending' THEN 'failed' ELSE 'unknown' END,
        error='Reconecte o WhatsApp para continuar.',updated_at=CURRENT_TIMESTAMP
        WHERE connection_id=? AND office_id=? AND status IN ('pending','dispatching')`).run(connection.id, job.office_id);
    });
  } else if (job.kind === 'conversations') {
    await database.prepare(`UPDATE whatsapp_connection SET sync_state='error',updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND office_id=? AND generation=? AND status='connected'`).run(job.connection_id, job.office_id, job.generation);
  }
}

export async function runWhatsAppPass({ max = 10 }: { max?: number } = {}): Promise<number> {
  await database.prepare(`UPDATE whatsapp_send SET status='unknown',
    error='O resultado do envio ainda não foi confirmado. Confira a conversa antes de tentar novamente.',updated_at=CURRENT_TIMESTAMP
    WHERE status='dispatching' AND updated_at<CURRENT_TIMESTAMP-INTERVAL '5 minutes'`).run();
  const limit = Math.max(1, Math.min(100, Number.isFinite(max) ? Math.floor(max) : 10));
  let processed = 0;
  while (processed < limit) {
    const job = await claimWhatsAppJob();
    if (!job) break;
    try { await processJob(job); }
    catch (error) { await recordFailure(job, error); }
    processed += 1;
  }
  return processed;
}
