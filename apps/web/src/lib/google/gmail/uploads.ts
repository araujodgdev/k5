import 'server-only';
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { database } from '@/lib/database';
import { CapabilityError } from '@/lib/capabilities/errors';
import type { WorkspaceContext } from '@/lib/application/context';
import { objectStorage, storageKey } from '@/lib/storage';

const MAX_FILE = 25 * 1024 * 1024;
type MailUpload = { id: string; name: string; mimeType: string; byteSize: number };

/** An upload is private to its owner and lives only long enough to compose an e-mail. */
export async function createMailUpload(context: WorkspaceContext, file: File): Promise<MailUpload> {
  if (context.role === 'reviewer') throw new CapabilityError('FORBIDDEN', 'Seu papel permite apenas consultas.');
  const name = basename(file.name).replace(/[\r\n\x00-\x1f\x7f<>:"/\\|?*]/g, '_').trim().slice(0, 255);
  if (!name || file.size < 1 || file.size > MAX_FILE) throw new CapabilityError('INVALID', 'Escolha um arquivo de até 25 MB.');
  const mimeType = /^[\w.+-]+\/[\w.+-]+$/.test(file.type) ? file.type : 'application/octet-stream';
  const data = Buffer.from(await file.arrayBuffer());
  if (data.length < 1 || data.length > MAX_FILE) throw new CapabilityError('INVALID', 'O anexo excede 25 MB.');
  const id = randomUUID();
  const key = storageKey(context.officeId, id);
  const storage = await objectStorage();
  await storage.put(key, data);
  try {
    await database.prepare(`INSERT INTO google_mail_upload(id,office_id,user_id,storage_key,file_name,mime_type,byte_size,expires_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(id, context.officeId, context.userId, key, name, mimeType, data.length,
      new Date(Date.now() + 24 * 60 * 60_000).toISOString());
  } catch (error) {
    await storage.delete(key).catch(() => undefined);
    throw error;
  }
  return { id, name, mimeType, byteSize: data.length };
}

export async function sweepExpiredMailUploads(limit = 50): Promise<number> {
  const rows = await database.prepare(`SELECT id,storage_key FROM google_mail_upload WHERE expires_at<CURRENT_TIMESTAMP
    ORDER BY expires_at LIMIT ?`).all<{ id: string; storage_key: string }>(limit);
  if (!rows.length) return 0;
  let removed = 0;
  const storage = await objectStorage().catch(() => null);
  if (!storage) return 0;
  for (const row of rows) {
    // Keep the row when the storage backend is unavailable so a later pass can retry deletion.
    try {
      await storage.delete(row.storage_key);
      await database.prepare('DELETE FROM google_mail_upload WHERE id=? AND expires_at<CURRENT_TIMESTAMP').run(row.id);
      removed++;
    } catch { /* Try this row again during the next pass without stopping Google jobs. */ }
  }
  return removed;
}
