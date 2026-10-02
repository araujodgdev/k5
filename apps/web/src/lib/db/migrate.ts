import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Pool } from 'pg';

/** Read-only preflight for the one-lawyer-per-office migration, without exposing user data. */
export async function checkAssociateMemberships(pool: Pick<Pool, 'query'>) {
  const exists = await pool.query<{ name: string | null }>("SELECT to_regclass('office_member')::text AS name");
  if (!exists.rows[0].name) return { usersWithMultipleOffices: 0, officesWithMultipleMembers: 0 };
  const result = await pool.query<{ users: number; offices: number }>(`SELECT
    (SELECT count(*)::int FROM (SELECT user_id FROM office_member GROUP BY user_id HAVING count(*)>1) u) AS users,
    (SELECT count(*)::int FROM (SELECT office_id FROM office_member GROUP BY office_id HAVING count(*)>1) o) AS offices`);
  const { users, offices } = result.rows[0];
  if (users || offices) throw new Error(`Migração de associados bloqueada: ${users} usuários em vários escritórios e ${offices} escritórios com vários membros. Resolva os vínculos e a propriedade dos dados antes de migrar. Nenhum dado foi alterado.`);
  return { usersWithMultipleOffices: users, officesWithMultipleMembers: offices };
}

/**
 * Line endings are normalized first: a Windows checkout with core.autocrlf rewrites the files with
 * CRLF, and that must not look like an edit to a migration that was already applied.
 */
export function migrationChecksum(sql: string) {
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');
}

/** No DDL or writes: a runtime role can verify a code-only deployment. */
export async function checkPostgresMigrations(pool: Pool, directory: string | URL) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const exists = (await client.query("SELECT to_regclass('postgres_migration') AS name")).rows[0].name;
    const applied = new Map(exists
      ? (await client.query<{name:string;checksum:string}>('SELECT name,checksum FROM postgres_migration')).rows.map(row => [row.name, row.checksum])
      : []);
    const pending: string[] = [];
    for (const name of (await readdir(directory)).filter(name => name.endsWith('.sql')).sort()) {
      const sql = await readFile(typeof directory === 'string' ? join(directory, name) : new URL(name, directory), 'utf8');
      if (!applied.has(name)) pending.push(name);
      else if (applied.get(name) !== migrationChecksum(sql)) throw new Error(`Applied migration changed: ${name}`);
    }
    await client.query('COMMIT');
    return pending;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

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
      const checksum = migrationChecksum(sql);
      if (applied.has(name)) {
        if (applied.get(name)!==checksum) throw new Error(`Applied migration changed: ${name}`);
        continue;
      }
      if (name === '0059_associate_access.sql') {
        await client.query('LOCK TABLE office_member IN SHARE ROW EXCLUSIVE MODE');
        await checkAssociateMemberships(client);
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
