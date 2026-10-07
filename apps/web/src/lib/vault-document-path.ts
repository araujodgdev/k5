import 'server-only';
import type { Database } from '@/lib/database';

/**
 * Where a Cofre file is seen in the canvas: its case, opened at its folder, or the office library.
 * Null when the office has no such file.
 */
export async function vaultDocumentPath(db: Database, officeId: string, documentId: string): Promise<string | null> {
  const row = await db.prepare('SELECT case_id, folder_id FROM vault_document WHERE id=? AND office_id=? AND deleted_at IS NULL')
    .get<{ case_id: string | null; folder_id: string | null }>(documentId, officeId);
  if (!row) return null;
  if (!row.case_id) return '/app/vault/library';
  const folder = row.folder_id ? `?folder=${encodeURIComponent(row.folder_id)}` : '';
  return `/app/vault/cases/${encodeURIComponent(row.case_id)}${folder}`;
}
