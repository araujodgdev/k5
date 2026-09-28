import 'server-only';
import { z } from 'zod';
import { database, withTransaction } from '@/lib/database';
import type { WorkspaceContext } from '@/lib/application/context';
import { CapabilityError } from '@/lib/capabilities/errors';
import { requireWhatsApp } from './connection';
import { historyInput, listInput, isReplyWindowOpen, replyWindow, type ConnectionRow, type HistoryPage, type ThreadPage } from './domain';
import { enqueueWhatsAppJob } from './jobs';
import { wakeWhatsAppWorker } from './wake';
import { messageView, threadView, type MessageRow, type ThreadRow } from './projection';
import { attachmentView, type AttachmentRow } from './media';

const cursorSchema = z.object({ scope: z.string().max(500), at: z.iso.datetime(), id: z.string().uuid() });
type Cursor = z.infer<typeof cursorSchema>;
function decodeCursor(value: string | undefined, scope: string): Cursor | null {
  if (!value) return null;
  let raw: unknown;
  try { raw = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')); }
  catch { raw = null; }
  const cursor = cursorSchema.safeParse(raw);
  if (cursor.success && cursor.data.scope === scope) return cursor.data;
  throw new CapabilityError('INVALID', 'A página solicitada não pertence a esta conversa.');
}
function encodeCursor(scope: string, at: string, id: string) {
  return Buffer.from(JSON.stringify({ scope, at, id })).toString('base64url');
}

export async function listThreads(context: WorkspaceContext, input: { cursor?: string; limit: number }): Promise<ThreadPage> {
  const values = listInput.parse(input);
  const connection = await requireWhatsApp(context);
  const scope = `${connection.id}:${connection.account_id}:threads`;
  const cursor = decodeCursor(values.cursor, scope);
  const rows = await database.prepare(`SELECT t.* FROM whatsapp_thread t JOIN whatsapp_connection c ON c.id=t.connection_id
    WHERE t.office_id=? AND t.connection_id=? AND t.account_id=c.account_id AND c.account_id=?
      AND (?::timestamptz IS NULL OR (t.last_message_at,t.id)<(?::timestamptz,?))
    ORDER BY t.last_message_at DESC,t.id DESC LIMIT ?`)
    .all<ThreadRow>(context.officeId, connection.id, connection.account_id, cursor?.at ?? null,
      cursor?.at ?? null, cursor?.id ?? null, values.limit + 1);
  const items = rows.slice(0, values.limit);
  const last = items.at(-1);
  return { items: items.map(row => threadView(row, replyWindow(row.last_customer_message_at))),
    nextCursor: rows.length > values.limit && last ? encodeCursor(scope, last.last_message_at, last.id) : null,
    syncState: connection.sync_state, updatedAt: connection.synced_at };
}

export async function readThread(context: WorkspaceContext, input: { threadId: string; cursor?: string; limit: number }): Promise<HistoryPage> {
  const values = historyInput.parse(input);
  const initial = await requireWhatsApp(context);
  const scope = `${initial.id}:${initial.account_id}:${values.threadId}`;
  const cursor = decodeCursor(values.cursor, scope);
  const result = await withTransaction<HistoryPage>(async tx => {
    const connection = await tx.prepare(`SELECT * FROM whatsapp_connection WHERE id=? AND office_id=?
      AND account_id=? AND generation=? AND status IN ('connected','reconnect_required') FOR UPDATE`)
      .get<ConnectionRow>(initial.id, context.officeId, initial.account_id, initial.generation);
    if (!connection) throw new CapabilityError('CONFLICT', 'A conexão do WhatsApp mudou. Atualize a página.');
    const thread = await tx.prepare(`SELECT * FROM whatsapp_thread WHERE id=? AND office_id=?
      AND connection_id=? AND account_id=? FOR UPDATE`)
      .get<ThreadRow>(values.threadId, context.officeId, connection.id, connection.account_id);
    if (!thread) throw new CapabilityError('NOT_FOUND', 'Conversa do WhatsApp não encontrada.');
    const rows = await tx.prepare(`SELECT * FROM (
      SELECT m.* FROM whatsapp_message m WHERE m.office_id=? AND m.thread_id=?
      UNION ALL
      SELECT s.id,s.office_id,s.thread_id,COALESCE(s.provider_id,s.id) AS provider_id,'outbound' AS direction,
        'tises' AS source,s.text,s.status,false AS deleted,false AS edited,'[]'::jsonb AS attachments,
        s.created_at,s.created_at AS content_updated_at
      FROM whatsapp_send s WHERE s.office_id=? AND s.thread_id=? AND s.connection_id=?
        AND NOT EXISTS(SELECT 1 FROM whatsapp_message m WHERE m.office_id=s.office_id AND m.thread_id=s.thread_id
          AND m.provider_id=s.provider_id)
    ) messages WHERE (?::timestamptz IS NULL OR (created_at,id)<(?::timestamptz,?))
    ORDER BY created_at DESC,id DESC LIMIT ?`)
      .all<MessageRow>(context.officeId, thread.id, context.officeId, thread.id, connection.id,
        cursor?.at ?? null, cursor?.at ?? null, cursor?.id ?? null, values.limit + 1);
    const items = rows.slice(0, values.limit);
    const sendAttachments = await tx.prepare('SELECT id,attachment_id FROM whatsapp_send WHERE office_id=? AND thread_id=? AND id=ANY(?::text[])')
      .all<{ id: string; attachment_id: string | null }>(context.officeId, thread.id, items.map(item => item.id));
    const attachmentBySend = new Map(sendAttachments.map(item => [item.id, item.attachment_id]));
    const attachments = await tx.prepare(`SELECT * FROM whatsapp_attachment WHERE office_id=? AND thread_id=?
      AND (message_id=ANY(?::text[]) OR send_id=ANY(?::text[]) OR id=ANY(?::text[])) ORDER BY attachment_index,id`)
      .all<AttachmentRow>(context.officeId, thread.id, items.map(item => item.id), items.map(item => item.id), [...attachmentBySend.values()]);
    const views = items.map(row => {
      const view = messageView(row);
      const files = attachments.filter(attachment => attachment.message_id === row.id || attachment.send_id === row.id || attachment.id === attachmentBySend.get(row.id));
      return files.length && !row.deleted ? { ...view, attachments: files.map(attachmentView) } : view;
    });
    const last = items.at(-1);
    const exhausted = rows.length <= values.limit;
    const needsInitial = !thread.history_complete && thread.history_cursor === null;
    const needsOlder = Boolean(cursor) && exhausted && !thread.history_complete;
    if (connection.status === 'connected' && (needsInitial || needsOlder)) {
      const recent = await tx.prepare(`SELECT status,created_at FROM whatsapp_job
        WHERE office_id=? AND connection_id=? AND generation=? AND kind='history' AND subject_id=?
        ORDER BY created_at DESC,id DESC LIMIT 1`)
        .get<{ status: string; created_at: string }>(context.officeId, connection.id, connection.generation, thread.id);
      if (!recent || ['queued', 'running', 'done'].includes(recent.status) || Date.parse(recent.created_at) < Date.now() - 60_000)
        await enqueueWhatsAppJob(tx, { officeId: context.officeId, connectionId: connection.id,
          generation: connection.generation, kind: 'history', subjectId: thread.id,
          dedupeKey: `whatsapp:history:${connection.id}:${connection.generation}:${thread.id}` });
    }
    const jobs = await tx.prepare(`SELECT status FROM whatsapp_job WHERE office_id=? AND connection_id=?
      AND generation=? AND kind IN ('history','history_refresh') AND subject_id=?
      ORDER BY CASE WHEN status IN ('queued','running') THEN 0 ELSE 1 END,updated_at DESC,id DESC LIMIT 1`)
      .get<{ status: string }>(context.officeId, connection.id, connection.generation, thread.id);
    const syncState = connection.status === 'reconnect_required' || jobs?.status === 'failed' ? 'error'
      : jobs && ['queued', 'running'].includes(jobs.status) ? 'pending' : 'idle';
    await tx.prepare(`UPDATE whatsapp_thread SET unread_count=0 WHERE id=? AND office_id=?`).run(thread.id, context.officeId);
    const member = await tx.prepare(`SELECT role FROM office_member WHERE office_id=? AND user_id=?`)
      .get<{ role: string }>(context.officeId, context.userId);
    const nextCursor = last && (!exhausted || !thread.history_complete)
      ? encodeCursor(scope, last.created_at, last.id) : !thread.history_complete && cursor ? values.cursor ?? null : null;
    return { thread: threadView({ ...thread, unread_count: 0 }, replyWindow(thread.last_customer_message_at)),
      items: views.reverse(), nextCursor,
      canSend: connection.status === 'connected' && (member?.role === 'administrator' || member?.role === 'lawyer')
        && isReplyWindowOpen(thread.last_customer_message_at), syncState };
  });
  if (result.syncState === 'pending') await wakeWhatsAppWorker();
  return result;
}

export async function refreshInbox(context: WorkspaceContext): Promise<{ queued: boolean }> {
  const initial = await requireWhatsApp(context);
  if (initial.status !== 'connected') throw new CapabilityError('NOT_READY', 'Reconecte o WhatsApp para atualizar as conversas.');
  const result = await withTransaction(async tx => {
    const connection = await tx.prepare(`SELECT * FROM whatsapp_connection WHERE id=? AND office_id=?
      AND status='connected' AND generation=? FOR UPDATE`).get<ConnectionRow>(initial.id, context.officeId, initial.generation);
    if (!connection) throw new CapabilityError('CONFLICT', 'A conexão do WhatsApp mudou. Atualize a página.');
    const active = await tx.prepare(`SELECT 1 FROM whatsapp_job WHERE connection_id=? AND office_id=?
      AND kind='conversations' AND generation=? AND status IN ('queued','running')`)
      .get(connection.id, context.officeId, connection.generation);
    if (active) return { queued: true };
    const recent = await tx.prepare(`SELECT 1 FROM whatsapp_job WHERE connection_id=? AND office_id=?
      AND kind='conversations' AND generation=? AND created_at>CURRENT_TIMESTAMP-INTERVAL '60 seconds'`)
      .get(connection.id, context.officeId, connection.generation);
    if (recent || connection.synced_at && Date.parse(connection.synced_at) > Date.now() - 60_000) return { queued: false };
    await tx.prepare(`UPDATE whatsapp_connection SET sync_cursor=NULL,sync_state='pending',updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(connection.id);
    await enqueueWhatsAppJob(tx, { officeId: context.officeId, connectionId: connection.id,
      generation: connection.generation, kind: 'conversations', dedupeKey: `whatsapp:conversations:${connection.id}:${connection.generation}` });
    return { queued: true };
  });
  if (result.queued) await wakeWhatsAppWorker();
  return result;
}
