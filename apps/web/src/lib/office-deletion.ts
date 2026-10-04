import 'server-only';
import { randomUUID } from 'node:crypto';
import { database, withTransaction } from './database';
import type { Transaction } from './db/postgres';
import { memoryResource } from './agent-memory';
import { queueHonchoWorkspaceDeletion } from './honcho-memory';

/**
 * Deleting an office and its account. The person asks from Perfil, confirming the password; the
 * request waits GRACE_DAYS, during which it can be cancelled, and is then carried out by the
 * operator with `scripts/office-purge.ts` (docs/exclusao-de-escritorio.md). The purge stays an
 * operator step until a restore has been rehearsed: a mistake here cannot be undone.
 */
export const GRACE_DAYS = 7;

export type DeletionRequest = { id: string; status: 'scheduled' | 'cancelled' | 'completed'; requestedAt: string; scheduledFor: string };

const columns = `id, status, requested_at AS "requestedAt", scheduled_for AS "scheduledFor"`;
const iso = (row: DeletionRequest | undefined) => row && { ...row, requestedAt: new Date(row.requestedAt).toISOString(), scheduledFor: new Date(row.scheduledFor).toISOString() };

export async function openDeletionRequest(officeId: string) {
  return iso(await database.prepare(`SELECT ${columns} FROM office_deletion_request WHERE office_id=? AND status='scheduled'`).get<DeletionRequest>(officeId));
}

export async function requestOfficeDeletion(owner: { officeId: string; userId: string }) {
  await database.prepare(`INSERT INTO office_deletion_request(id,office_id,user_id,status,scheduled_for)
    VALUES(?,?,?,'scheduled',CURRENT_TIMESTAMP + (?::integer * INTERVAL '1 day')) ON CONFLICT (office_id) WHERE status='scheduled' DO NOTHING`)
    .run(randomUUID(), owner.officeId, owner.userId, GRACE_DAYS);
  return (await openDeletionRequest(owner.officeId))!;
}

export async function cancelOfficeDeletion(officeId: string) {
  const result = await database.prepare(`UPDATE office_deletion_request SET status='cancelled', cancelled_at=CURRENT_TIMESTAMP
    WHERE office_id=? AND status='scheduled'`).run(officeId);
  return result.changes > 0;
}

/**
 * Kept after the purge: records the law asks us to keep (payments for tax purposes, the platform
 * audit log), the request itself, and the queues that still have to remove the originals, the
 * vectors and the remote memory. The office row stays, renamed, because those queues point to it.
 */
const KEPT = new Set(['office', 'office_deletion_request', 'vault_deletion_queue', 'honcho_deletion', 'platform_audit_log', 'office_billing']);
const kept = (table: string) => KEPT.has(table) || table.startsWith('billing_');
/** Columns that hold a key of the object storage; shared research material (`research/…`) is not the office's. */
const STORAGE_COLUMNS = ['stored_name', 'storage_key', 'signed_storage_key'];

export type PurgeReport = { officeId: string; deleted: Record<string, number>; objects: number; vectors: number; users: number; kept: string[] };

class DryRun extends Error { constructor(readonly report: PurgeReport) { super('dry run'); } }

async function purgeRows(tx: Transaction, officeId: string, tables: string[]) {
  const deleted: Record<string, number> = {};
  let pending = [...tables];
  // Delete what nothing else points to, then repeat: the order follows the foreign keys without
  // writing it down, and a table that never frees up stops the purge instead of being skipped.
  while (pending.length) {
    const blocked: string[] = [];
    for (const table of pending) {
      await tx.prepare('SAVEPOINT purge_table').run();
      try {
        const result = await tx.prepare(`DELETE FROM "${table}" WHERE office_id = ?`).run(officeId);
        await tx.prepare('RELEASE SAVEPOINT purge_table').run();
        if (result.changes) deleted[table] = (deleted[table] ?? 0) + result.changes;
      } catch (error) {
        await tx.prepare('ROLLBACK TO SAVEPOINT purge_table').run();
        // 23503: a row still points here. 23502/23514: an ON DELETE SET NULL would leave a row of
        // this office invalid (a case document without its case); it goes once that row is gone.
        if (!['23503', '23502', '23514'].includes((error as { code?: string }).code ?? '')) throw error;
        blocked.push(table);
      }
    }
    if (blocked.length === pending.length) throw new Error(`Exclusão interrompida: registros de outras tabelas ainda apontam para ${blocked.join(', ')}.`);
    pending = blocked;
  }
  return deleted;
}

/**
 * Removes everything the office owns. `dryRun` runs the same statements and rolls them back,
 * returning what would be deleted. People are anonymized rather than deleted: messages they sent
 * to other offices belong to those offices too, and keep pointing to an account with no identity.
 */
export async function purgeOffice(requestId: string, options: { dryRun: boolean }): Promise<PurgeReport> {
  const request = await database.prepare("SELECT office_id AS \"officeId\" FROM office_deletion_request WHERE id=? AND status='scheduled'")
    .get<{ officeId: string }>(requestId);
  if (!request) throw new Error('Pedido de exclusão não encontrado ou já encerrado.');
  const { officeId } = request;
  const members = (await database.prepare('SELECT user_id AS "userId" FROM office_member WHERE office_id=?').all<{ userId: string }>(officeId)).map(row => row.userId);

  const tables = (await database.prepare(`SELECT table_name AS name FROM information_schema.columns
    WHERE table_schema = current_schema() AND column_name = 'office_id' ORDER BY table_name`).all<{ name: string }>()).map(row => row.name);
  const storage = await database.prepare(`SELECT table_name AS "table", column_name AS "column" FROM information_schema.columns
    WHERE table_schema = current_schema() AND column_name = ANY(?::text[]) AND table_name = ANY(?::text[])`)
    .all<{ table: string; column: string }>(STORAGE_COLUMNS, tables);

  try {
    return await withTransaction(async tx => {
      const objects = new Set<string>();
      for (const { table, column } of storage) {
        const rows = await tx.prepare(`SELECT "${column}" AS key FROM "${table}" WHERE office_id = ? AND "${column}" IS NOT NULL`).all<{ key: string }>(officeId);
        for (const row of rows) if (row.key && !row.key.startsWith('research/')) objects.add(row.key);
      }
      const vectors = (await tx.prepare('SELECT id FROM vault_document WHERE office_id=?').all<{ id: string }>(officeId)).map(row => row.id);

      // Memory lives outside the office's tables: the working memory row and the conversation
      // threads, and the Honcho workspace, whose remote deletion is queued in honcho_deletion
      // before purgeRows removes honcho_memory. All of it rolls back with the purge.
      for (const userId of members) {
        const owner = { officeId, userId };
        await tx.prepare('DELETE FROM mastra_resources WHERE id=?').run(memoryResource(owner));
        await tx.prepare('DELETE FROM mastra_threads WHERE "resourceId"=?').run(memoryResource(owner));
        await queueHonchoWorkspaceDeletion(tx, owner);
      }
      const deleted = await purgeRows(tx, officeId, tables.filter(table => !kept(table)));
      for (const key of objects) await tx.prepare("INSERT INTO vault_deletion_queue(id,office_id,target_kind,target_ref) VALUES(?,?,'object',?)").run(randomUUID(), officeId, key);
      for (const id of vectors) await tx.prepare("INSERT INTO vault_deletion_queue(id,office_id,target_kind,target_ref) VALUES(?,?,'vector_document',?)").run(randomUUID(), officeId, id);
      await tx.prepare("UPDATE office SET name='Escritório excluído' WHERE id=?").run(officeId);
      for (const userId of members) {
        await tx.prepare('DELETE FROM session WHERE "userId"=?').run(userId);
        await tx.prepare('DELETE FROM account WHERE "userId"=?').run(userId);
        await tx.prepare('DELETE FROM user_profile WHERE user_id=?').run(userId);
        await tx.prepare(`UPDATE "user" SET name='Conta excluída', email=?, image=NULL, "emailVerified"=FALSE, "officeName"='', "updatedAt"=CURRENT_TIMESTAMP WHERE id=?`)
          .run(`excluida-${userId}@excluida.invalid`, userId);
      }
      const report: PurgeReport = { officeId, deleted, objects: objects.size, vectors: vectors.length, users: members.length, kept: tables.filter(kept) };
      if (options.dryRun) throw new DryRun(report);
      await tx.prepare("UPDATE office_deletion_request SET status='completed', completed_at=CURRENT_TIMESTAMP, report_json=? WHERE id=?")
        .run(JSON.stringify(report), requestId);
      return report;
    });
  } catch (error) {
    if (error instanceof DryRun) return error.report;
    throw error;
  }
}
