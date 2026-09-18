import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { basename, extname } from 'node:path';
import { database } from '@/lib/database';
import { CapabilityError } from '@/lib/capabilities/errors';
import { objectStorage, storageKey } from '@/lib/storage';
import type { WorkspaceContext } from './context';

export const ALLOWED_EXTENSIONS: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.eml': 'message/rfc822',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
};

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const UPLOAD_REF_TTL_MS = 30 * 60 * 1000;

export type UploadRef = {
  id: string;
  storageKey: string;
  originalName: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
};

export function validatedFileName(fileName: string) {
  const file = basename(fileName).replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_').trim();
  const extension = extname(file).toLowerCase();
  if (extension === '.msg') throw new CapabilityError('INVALID', 'Arquivos .msg ainda não são compatíveis. Exporte o e-mail como .eml.');
  const mimeType = ALLOWED_EXTENSIONS[extension];
  if (!mimeType) throw new CapabilityError('INVALID', 'Envie PDF, DOCX, EML, XLSX, CSV ou TXT.');
  if (!file || file === extension) throw new CapabilityError('INVALID', 'O arquivo precisa ter um nome válido.');
  return { file, extension, mimeType };
}

/**
 * Stores the bytes and hands back an opaque reference. The agent never sees a path and never
 * chooses one: a human picked this file, and the reference is what travels through the tools.
 */
export async function createUploadRef(context: WorkspaceContext, file: File): Promise<UploadRef> {
  const { file: name, extension, mimeType } = validatedFileName(file.name);
  if (file.size <= 0) throw new CapabilityError('INVALID', 'O arquivo está vazio.');
  if (file.size > MAX_UPLOAD_BYTES) throw new CapabilityError('INVALID', 'O arquivo excede o limite de 50 MB.');

  const data = Buffer.from(await file.arrayBuffer());
  if (data.byteLength > MAX_UPLOAD_BYTES) throw new CapabilityError('INVALID', 'O arquivo excede o limite de 50 MB.');

  const id = randomUUID();
  const key = storageKey(context.officeId, id, extension);
  await objectStorage().put(key, data);

  const sha256 = createHash('sha256').update(data).digest('hex');
  database.prepare(`
    INSERT INTO vault_upload_ref (id, office_id, user_id, storage_key, original_name, mime_type, byte_size, sha256, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, context.officeId, context.userId, key, name, mimeType, data.byteLength, sha256, Date.now() + UPLOAD_REF_TTL_MS);

  return { id, storageKey: key, originalName: name, mimeType, byteSize: data.byteLength, sha256 };
}

/**
 * Single use, bound to the office and the person who uploaded it, and expiring. Consumption is a
 * conditional UPDATE so two concurrent tool calls cannot both claim the same file.
 */
export function consumeUploadRef(context: WorkspaceContext, refId: string): UploadRef {
  const claimed = database.prepare(`
    UPDATE vault_upload_ref SET consumed_at = CURRENT_TIMESTAMP
    WHERE id = ? AND office_id = ? AND user_id = ? AND consumed_at IS NULL AND expires_at > ?
  `).run(refId, context.officeId, context.userId, Date.now());

  if (!claimed.changes) {
    // Scoped to the same person as the claim above. An office-wide diagnostic would answer
    // "expired" for someone else's reference, which is both wrong and a disclosure that it exists.
    const own = database.prepare('SELECT consumed_at, expires_at FROM vault_upload_ref WHERE id = ? AND office_id = ? AND user_id = ?')
      .get(refId, context.officeId, context.userId) as { consumed_at: string | null; expires_at: number } | undefined;
    if (!own) throw new CapabilityError('NOT_FOUND', 'Referência de upload não encontrada. Envie o arquivo novamente.');
    if (own.consumed_at) throw new CapabilityError('CONFLICT', 'Este arquivo já foi adicionado ao Cofre.');
    throw new CapabilityError('CONFLICT', 'A referência de upload expirou. Envie o arquivo novamente.');
  }

  const row = database.prepare(`
    SELECT id, storage_key AS storageKey, original_name AS originalName, mime_type AS mimeType,
           byte_size AS byteSize, sha256
    FROM vault_upload_ref WHERE id = ?
  `).get(refId) as UploadRef;

  return {
    id: String(row.id),
    storageKey: String(row.storageKey),
    originalName: String(row.originalName),
    mimeType: String(row.mimeType),
    byteSize: Number(row.byteSize),
    sha256: String(row.sha256),
  };
}

/** Expired references leave bytes behind; the worker collects them through the deletion queue. */
export function sweepExpiredUploadRefs(limit = 50): number {
  const stale = database.prepare(
    'SELECT id, office_id AS officeId, storage_key AS storageKey FROM vault_upload_ref WHERE consumed_at IS NULL AND expires_at < ? LIMIT ?',
  ).all(Date.now(), limit) as Array<{ id: string; officeId: string; storageKey: string }>;

  for (const row of stale) {
    database.prepare('INSERT INTO vault_deletion_queue (id, office_id, target_kind, target_ref) VALUES (?, ?, ?, ?)')
      .run(randomUUID(), row.officeId, 'object', row.storageKey);
    database.prepare('DELETE FROM vault_upload_ref WHERE id = ?').run(row.id);
  }
  return stale.length;
}
