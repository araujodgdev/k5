import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { database, withTransaction, type Transaction } from '@/lib/database';
import type { WorkspaceContext } from '@/lib/application/context';
import { CapabilityError } from '@/lib/capabilities/errors';
import { objectStorage, storageKey } from '@/lib/storage';
import { authorizeWhatsApp, requireWhatsApp } from './connection';
import type { ConnectionRow, WhatsAppAttachment } from './domain';
import { enqueueWhatsAppJob } from './jobs';
import type { ProviderAttachment } from './provider';
import { MAX_WHATSAPP_MEDIA_BYTES, readWhatsAppBytes, validateWhatsAppFile, whatsappFileName } from './media-validation';

export type AttachmentRow = {
  id: string; office_id: string; connection_id: string; generation: number; account_id: string; thread_id: string;
  user_id: string | null; message_id: string | null; send_id: string | null; attachment_index: number; media_id: string | null;
  kind: string; filename: string | null; mime_type: string | null; byte_length: number | null; sha256: string | null;
  storage_key: string | null; state: 'pending' | 'ready' | 'unavailable'; expires_at: string | null;
};
const notFound = () => new CapabilityError('NOT_FOUND', 'Arquivo não encontrado nesta conversa.');
const fileChanged = () => new CapabilityError('CONFLICT', 'Este arquivo não está mais disponível. Escolha o arquivo novamente.');

export function attachmentView(row: AttachmentRow): WhatsAppAttachment {
  return { id: row.id, kind: row.kind, filename: row.filename, mimeType: row.mime_type, byteLength: row.byte_length,
    state: row.state, contentUrl: row.state === 'ready' ? `/api/whatsapp/attachments/${row.id}/content` : null };
}

export async function uploadWhatsAppAttachment(context: WorkspaceContext, threadId: string, file: File) {
  z.string().uuid().parse(threadId);
  const connection = await requireWhatsApp(context, { write: true });
  const thread = await database.prepare(`SELECT id FROM whatsapp_thread WHERE id=? AND office_id=? AND connection_id=? AND account_id=?`)
    .get(threadId, context.officeId, connection.id, connection.account_id);
  if (!thread) throw notFound();
  const format = whatsappFileName(file.name, file.type);
  if (file.size < 1 || file.size > format.max) throw new CapabilityError('INVALID', `O limite deste formato é ${format.max / 1_000_000} MB.`);
  const bytes = await readWhatsAppBytes(file.stream(), format.max);
  const validated = validateWhatsAppFile(bytes, file.name, file.type);
  const id = randomUUID(), key = storageKey(context.officeId, id, validated.extension);
  const storage = await objectStorage();
  await storage.put(key, bytes);
  try {
    await authorizeWhatsApp(context, { write: true });
    return await withTransaction(async tx => {
      const active = await tx.prepare(`SELECT id FROM whatsapp_connection WHERE id=? AND office_id=?
        AND account_id=? AND generation=? AND status='connected' FOR UPDATE`)
        .get(connection.id, context.officeId, connection.account_id, connection.generation);
      if (!active) throw fileChanged();
      const row = await tx.prepare(`INSERT INTO whatsapp_attachment(id,office_id,connection_id,generation,account_id,thread_id,user_id,
        kind,filename,mime_type,byte_length,sha256,storage_key,state,expires_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'ready',CURRENT_TIMESTAMP+INTERVAL '30 minutes') RETURNING *`)
        .get<AttachmentRow>(id, context.officeId, connection.id, connection.generation, connection.account_id, threadId, context.userId,
          validated.kind, validated.filename, validated.mime, bytes.length, createHash('sha256').update(bytes).digest('hex'), key);
      if (!row) throw fileChanged();
      return attachmentView(row);
    });
  } catch (error) { await storage.delete(key).catch(() => undefined); throw error; }
}

export async function attachmentForSend(context: WorkspaceContext, connection: ConnectionRow, threadId: string, id: string) {
  const row = await database.prepare(`SELECT * FROM whatsapp_attachment WHERE id=? AND office_id=? AND user_id=?
    AND connection_id=? AND generation=? AND account_id=? AND thread_id=?`)
    .get<AttachmentRow>(id, context.officeId, context.userId, connection.id, connection.generation, connection.account_id, threadId);
  if (!row) throw notFound();
  if (row.state !== 'ready' || !row.storage_key || !row.sha256 || !row.filename || !row.mime_type || !row.byte_length
    || row.expires_at !== null && Date.parse(row.expires_at) <= Date.now()) throw fileChanged();
  return { ...row, storage_key: row.storage_key, sha256: row.sha256, filename: row.filename, mime_type: row.mime_type, byte_length: row.byte_length };
}

export async function readSendAttachment(row: Awaited<ReturnType<typeof attachmentForSend>>) {
  const bytes = await (await objectStorage()).get(row.storage_key);
  if (bytes.length !== row.byte_length || bytes.length > MAX_WHATSAPP_MEDIA_BYTES
    || createHash('sha256').update(bytes).digest('hex') !== row.sha256) throw fileChanged();
  validateWhatsAppFile(bytes, row.filename, row.mime_type);
  return { bytes, filename: row.filename, mimeType: row.mime_type };
}

export async function projectAttachments(tx: Transaction, connection: ConnectionRow, messageId: string, threadId: string,
  attachments: ProviderAttachment[], options: { deleted: boolean; replace: boolean; enrich?: boolean; sendId?: string }) {
  if (options.sendId) {
    const own = await tx.prepare('SELECT 1 FROM whatsapp_attachment WHERE send_id=? AND office_id=?').get(options.sendId, connection.office_id);
    if (own) {
      await tx.prepare(`UPDATE whatsapp_attachment SET message_id=NULL,state='unavailable',expires_at=CURRENT_TIMESTAMP
        WHERE message_id=? AND office_id=? AND send_id IS NULL`).run(messageId, connection.office_id);
      await tx.prepare(`UPDATE whatsapp_attachment SET message_id=?,updated_at=CURRENT_TIMESTAMP
        WHERE send_id=? AND office_id=? AND thread_id=?`).run(messageId, options.sendId, connection.office_id, threadId);
    }
  }
  if (options.deleted) {
    await tx.prepare(`UPDATE whatsapp_attachment SET state='unavailable',updated_at=CURRENT_TIMESTAMP WHERE message_id=? AND office_id=?`)
      .run(messageId, connection.office_id);
    return;
  }
  if (options.sendId) {
    const outbound = await tx.prepare('SELECT 1 FROM whatsapp_attachment WHERE send_id=? AND office_id=?').get(options.sendId, connection.office_id);
    if (outbound) return;
  }
  if (!options.replace && !options.enrich) return;
  if (options.replace) await tx.prepare(`UPDATE whatsapp_attachment SET state='unavailable',updated_at=CURRENT_TIMESTAMP
    WHERE message_id=? AND office_id=? AND attachment_index>=?`).run(messageId, connection.office_id, attachments.length);
  for (const [index, attachment] of attachments.entries()) {
    const kind = attachment.kind === 'document' ? 'file' : attachment.kind;
    const existing = await tx.prepare('SELECT * FROM whatsapp_attachment WHERE message_id=? AND office_id=? AND attachment_index=?')
      .get<AttachmentRow>(messageId, connection.office_id, index);
    const sameMetadata = existing && existing.kind === kind
      && (!existing.filename || !attachment.filename || existing.filename === attachment.filename)
      && (!existing.mime_type || !attachment.mimeType || existing.mime_type === attachment.mimeType);
    if (existing && !options.replace && !sameMetadata) continue;
    const changed = existing && options.replace && (!sameMetadata || Boolean(attachment.mediaId && existing.media_id && attachment.mediaId !== existing.media_id));
    if (changed) await tx.prepare(`UPDATE whatsapp_attachment SET message_id=NULL,state='unavailable',expires_at=CURRENT_TIMESTAMP WHERE id=?`).run(existing.id);
    else if (existing) {
      if (!existing.media_id && attachment.mediaId && sameMetadata && existing.state === 'unavailable') {
        await tx.prepare(`UPDATE whatsapp_attachment SET media_id=?,generation=?,state='pending',filename=COALESCE(filename,?),
          mime_type=COALESCE(mime_type,?),updated_at=CURRENT_TIMESTAMP WHERE id=?`)
          .run(attachment.mediaId, connection.generation, attachment.filename, attachment.mimeType, existing.id);
        await enqueueWhatsAppJob(tx, { officeId: connection.office_id, connectionId: connection.id, generation: connection.generation,
          kind: 'media', subjectId: existing.id, dedupeKey: `whatsapp:media:${existing.id}` });
      }
      continue;
    }
    const id = randomUUID();
    const state = attachment.mediaId && ['image', 'video', 'audio', 'file', 'document'].includes(attachment.kind) ? 'pending' : 'unavailable';
    const inserted = await tx.prepare(`INSERT INTO whatsapp_attachment(id,office_id,connection_id,generation,account_id,thread_id,message_id,
      attachment_index,media_id,kind,filename,mime_type,state) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(message_id,attachment_index) DO NOTHING RETURNING id`)
      .get<{ id: string }>(id, connection.office_id, connection.id, connection.generation, connection.account_id, threadId, messageId,
        index, attachment.mediaId ?? null, kind, attachment.filename, attachment.mimeType, state);
    if (inserted && state === 'pending') await enqueueWhatsAppJob(tx, { officeId: connection.office_id, connectionId: connection.id,
      generation: connection.generation, kind: 'media', subjectId: id, dedupeKey: `whatsapp:media:${id}` });
  }
}

export async function readWhatsAppAttachment(context: WorkspaceContext, id: string, request: { range?: string | null; download?: boolean } = {}) {
  if (!z.string().uuid().safeParse(id).success) throw notFound();
  const connection = await requireWhatsApp(context);
  const row = await database.prepare(`SELECT a.* FROM whatsapp_attachment a JOIN whatsapp_thread t ON t.id=a.thread_id
    LEFT JOIN whatsapp_message m ON m.id=a.message_id WHERE a.id=? AND a.office_id=? AND a.connection_id=?
      AND a.account_id=? AND t.account_id=? AND a.state='ready'
      AND ((a.message_id IS NOT NULL AND NOT m.deleted) OR (a.message_id IS NULL AND a.send_id IS NOT NULL)
        OR (a.message_id IS NULL AND EXISTS(SELECT 1 FROM whatsapp_send s WHERE s.attachment_id=a.id AND s.office_id=a.office_id))
        OR (a.message_id IS NULL AND a.send_id IS NULL AND a.user_id=? AND a.generation=? AND a.expires_at>CURRENT_TIMESTAMP))`)
    .get<AttachmentRow>(id, context.officeId, connection.id, connection.account_id, connection.account_id, context.userId, connection.generation);
  if (!row || !row.storage_key || !row.mime_type || !row.filename || !row.byte_length) throw notFound();
  const bytes = await (await objectStorage()).get(row.storage_key);
  if (bytes.length !== row.byte_length || bytes.length > MAX_WHATSAPP_MEDIA_BYTES) throw notFound();
  await authorizeWhatsApp(context);
  const active = await database.prepare(`SELECT 1 FROM whatsapp_connection c JOIN whatsapp_attachment a ON a.connection_id=c.id
    LEFT JOIN whatsapp_message m ON m.id=a.message_id WHERE a.id=? AND a.office_id=? AND a.state='ready'
      AND c.account_id=a.account_id AND c.generation=? AND c.status IN ('connected','reconnect_required')
      AND (a.message_id IS NULL OR NOT m.deleted)`).get(id, context.officeId, connection.generation);
  if (!active) throw notFound();
  const inline = ['image/jpeg', 'image/png', 'video/mp4', 'audio/mpeg', 'audio/ogg', 'audio/amr', 'audio/aac', 'application/pdf', 'text/plain'].includes(row.mime_type);
  const headers = new Headers({ 'Content-Type': row.mime_type, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox", 'Accept-Ranges': 'bytes',
    'Content-Disposition': `${inline && !request.download ? 'inline' : 'attachment'}; filename="arquivo"; filename*=UTF-8''${encodeURIComponent(row.filename)}` });
  let start = 0, end = bytes.length - 1, status = 200;
  if (request.range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(request.range);
    if (!match || !match[1] && !match[2]) return new Response(null, { status: 416, headers: { ...Object.fromEntries(headers), 'Content-Range': `bytes */${bytes.length}` } });
    start = match[1] ? Number(match[1]) : Math.max(0, bytes.length - Number(match[2]));
    end = match[1] && match[2] ? Math.min(Number(match[2]), bytes.length - 1) : bytes.length - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= bytes.length)
      return new Response(null, { status: 416, headers: { ...Object.fromEntries(headers), 'Content-Range': `bytes */${bytes.length}` } });
    status = 206; headers.set('Content-Range', `bytes ${start}-${end}/${bytes.length}`);
  }
  headers.set('Content-Length', String(end - start + 1));
  return new Response(new Uint8Array(bytes.subarray(start, end + 1)), { status, headers });
}

export async function purgeExpiredWhatsAppUploads() {
  const rows = await database.prepare(`UPDATE whatsapp_attachment SET state='unavailable' WHERE id IN (
    SELECT a.id FROM whatsapp_attachment a LEFT JOIN whatsapp_message m ON m.id=a.message_id
    WHERE (a.send_id IS NULL AND a.message_id IS NULL AND a.expires_at<CURRENT_TIMESTAMP AND (a.state<>'unavailable' OR a.storage_key IS NOT NULL))
      OR (a.state='unavailable' AND a.storage_key IS NOT NULL AND m.deleted) LIMIT 20)
    RETURNING id,storage_key`).all<{ id: string; storage_key: string | null }>();
  if (!rows.length) return;
  const storage = await objectStorage();
  for (const row of rows) {
    if (row.storage_key) await storage.delete(row.storage_key);
    await database.prepare("UPDATE whatsapp_attachment SET storage_key=NULL WHERE id=? AND state='unavailable'").run(row.id);
    await database.prepare(`DELETE FROM whatsapp_attachment WHERE id=? AND send_id IS NULL AND message_id IS NULL
      AND NOT EXISTS(SELECT 1 FROM whatsapp_send WHERE attachment_id=whatsapp_attachment.id)`).run(row.id);
  }
}
