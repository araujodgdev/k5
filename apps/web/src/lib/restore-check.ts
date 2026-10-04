import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Database } from './db/types';
import type { ObjectStorage } from './storage';
import { migrationChecksum } from './db/migrate';
import { decryptCredential, type CredentialKeyring } from './platform-crypto';

/**
 * Checks a restored copy of Lume (docs/restauracao-ensaiada.md): the schema matches the
 * migrations in the repository, the Vault originals the database points to exist with the same
 * bytes, the credential key opens the stored secrets, and the text index covers the ready
 * documents. It only reads. `lastWrite` is the newest write the copy holds, which measures the
 * RPO against the moment of the failure.
 */
export type RestoreReport = {
  ok: boolean;
  durationMs: number;
  lastWrite: string | null;
  migrations: { applied: number; pending: string[]; changed: string[]; unknown: string[] };
  counts: Record<string, number>;
  originals: { checked: number; total: number; missing: string[]; mismatched: string[] };
  credentials: Array<{ column: string; checked: number; failed: number }>;
  index: { readyDocuments: number; withoutChunks: string[] };
};

const COUNTED = ['office', 'user', 'vault_case', 'vault_document', 'ai_conversation', 'ai_artifact', 'honcho_memory'] as const;
const LIMIT_LIST = 50;

export async function restoreCheck(options: {
  database: Database; storage: ObjectStorage; keyring: CredentialKeyring | null; migrations: string;
  /** Originals to read; 0 reads every active version. */
  sample?: number; credentialSample?: number;
}): Promise<RestoreReport> {
  const started = performance.now();
  const { database, storage } = options;

  const files = (await readdir(options.migrations)).filter(name => name.endsWith('.sql')).sort();
  const applied = new Map((await database.prepare('SELECT name, checksum FROM postgres_migration').all<{ name: string; checksum: string }>())
    .map(row => [row.name, row.checksum]));
  const pending: string[] = [], changed: string[] = [];
  for (const name of files) {
    const checksum = applied.get(name);
    if (!checksum) pending.push(name);
    else if (checksum !== migrationChecksum(await readFile(join(options.migrations, name), 'utf8'))) changed.push(name);
  }
  const unknown = [...applied.keys()].filter(name => !files.includes(name));

  const counts: Record<string, number> = {};
  for (const table of COUNTED) {
    const exists = await database.prepare('SELECT to_regclass(?) AS name').get<{ name: string | null }>(table);
    if (exists?.name) counts[table] = Number((await database.prepare(`SELECT count(*) AS n FROM "${table}"`).get<{ n: number }>())?.n ?? 0);
  }
  const last = await database.prepare(`SELECT max(at) AS at FROM (
      SELECT max(updated_at) AS at FROM ai_conversation UNION ALL SELECT max(updated_at) FROM vault_document
      UNION ALL SELECT max(created_at) FROM office UNION ALL SELECT max(updated_at) FROM ai_artifact) latest`).get<{ at: Date | string | null }>();

  const versions = `FROM vault_document_version v JOIN vault_document d ON d.id=v.document_id AND d.office_id=v.office_id
    WHERE v.is_active=1 AND d.deleted_at IS NULL`;
  const total = Number((await database.prepare(`SELECT count(*) AS n ${versions}`).get<{ n: number }>())?.n ?? 0);
  const sample = options.sample ?? 200;
  const rows = await database.prepare(`SELECT v.stored_name AS key, v.sha256 ${versions} ORDER BY random() ${sample ? 'LIMIT ?' : ''}`)
    .all<{ key: string; sha256: string }>(...(sample ? [sample] : []));
  const missing: string[] = [], mismatched: string[] = [];
  for (const row of rows) {
    try {
      const bytes = await storage.get(row.key);
      if (createHash('sha256').update(bytes).digest('hex') !== row.sha256) mismatched.push(row.key);
    } catch { missing.push(row.key); }
  }

  const columns = await database.prepare(`SELECT table_name AS "table", column_name AS "column" FROM information_schema.columns
    WHERE table_schema=current_schema() AND column_name LIKE 'encrypted\\_%' ORDER BY table_name, column_name`).all<{ table: string; column: string }>();
  const credentials: RestoreReport['credentials'] = [];
  for (const { table, column } of columns) {
    const values = await database.prepare(`SELECT "${column}" AS value FROM "${table}" WHERE "${column}" IS NOT NULL LIMIT ?`)
      .all<{ value: string }>(options.credentialSample ?? 20);
    if (!values.length) continue;
    let failed = values.length;
    if (options.keyring) {
      failed = 0;
      for (const { value } of values) { try { decryptCredential(value, options.keyring); } catch { failed++; } }
    }
    credentials.push({ column: `${table}.${column}`, checked: values.length, failed });
  }

  const ready = Number((await database.prepare("SELECT count(*) AS n FROM vault_document WHERE status='ready' AND deleted_at IS NULL").get<{ n: number }>())?.n ?? 0);
  const withoutChunks = (await database.prepare(`SELECT d.id FROM vault_document d WHERE d.status='ready' AND d.deleted_at IS NULL AND d.extracted_characters>0
      AND NOT EXISTS (SELECT 1 FROM vault_document_chunk c WHERE c.document_id=d.id) ORDER BY d.id LIMIT ?`).all<{ id: string }>(LIMIT_LIST)).map(row => row.id);

  const ok = !pending.length && !changed.length && !unknown.length && !missing.length && !mismatched.length
    && credentials.every(item => item.failed === 0) && !withoutChunks.length;
  return {
    ok, durationMs: Math.round(performance.now() - started),
    lastWrite: last?.at ? new Date(last.at).toISOString() : null,
    migrations: { applied: applied.size, pending, changed, unknown },
    counts,
    originals: { checked: rows.length, total, missing: missing.slice(0, LIMIT_LIST), mismatched: mismatched.slice(0, LIMIT_LIST) },
    credentials,
    index: { readyDocuments: ready, withoutChunks },
  };
}
