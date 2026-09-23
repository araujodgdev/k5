import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Pool } from 'pg';

/** Direct connection only. One lock and transaction prevent partial or concurrent migrations. */
export async function migratePostgres(pool: Pool, directory: string | URL) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('k5.schema.migrations'))");
    await client.query('CREATE TABLE IF NOT EXISTS postgres_migration(name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)');
    const applied = new Map((await client.query<{name:string;checksum:string}>('SELECT name,checksum FROM postgres_migration')).rows.map(row=>[row.name,row.checksum]));
    for (const name of (await readdir(directory)).filter(name=>name.endsWith('.sql')).sort()) {
      const sql = await readFile(typeof directory==='string' ? join(directory,name) : new URL(name,directory),'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      if (applied.has(name)) {
        if (applied.get(name)!==checksum) throw new Error(`Applied migration changed: ${name}`);
        continue;
      }
      await client.query(sql);
      await client.query('INSERT INTO postgres_migration(name,checksum) VALUES($1,$2)',[name,checksum]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
