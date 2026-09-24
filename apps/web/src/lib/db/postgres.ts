import { Pool, types, type PoolConfig, type QueryResultRow } from 'pg';
import { captureOperationalError } from '../observability/report';
import type { Database, PreparedStatement, Row } from './types';

/** Parameter binding and case-preserving identifiers for the application's SQL interface. */
export function postgresSql(sql: string): string {
  let parameter = 0;
  return sql.replace(/'(?:(?:'')|[^'])*'|"(?:(?:"")|[^"])*"|--[^\n]*|\/\*[\s\S]*?\*\/|\$([a-zA-Z_]\w*)?\$[\s\S]*?\$\1\$|\?|\b[A-Za-z_]\w*\b/g, token => {
    if (token === '?') return `$${++parameter}`;
    if (token.startsWith("'") || token.startsWith('"') || token.startsWith('--') || token.startsWith('/*') || token.startsWith('$')) return token;
    // PostgreSQL folds unquoted identifiers; preserve existing camelCase response aliases.
    if (token === 'user' || /[a-z][A-Z]/.test(token)) return `"${token}"`;
    return token;
  });
}

function integer(value: string): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new RangeError('Database integer exceeds JavaScript precision.');
  return result;
}

// Better Auth uses the pool directly and retains pg's Date decoding. Business DTOs use ISO text.
const businessTypes = {
  getTypeParser(oid: number, format?: 'text' | 'binary') {
    if (format !== 'binary') {
      if (oid === 20) return integer;
      if (oid === 1114 || oid === 1184) return (value: string) => new Date(oid === 1114 ? `${value}Z` : value).toISOString();
      if (oid === 1082) return (value: string) => value;
    }
    return types.getTypeParser(oid, format);
  },
};

export function createPostgresPool(connectionString: string, options: PoolConfig = {}): Pool {
  const pool = new Pool({ connectionString, max: 10, connectionTimeoutMillis: 15_000, idleTimeoutMillis: 30_000, ...options });
  // Idle socket errors must not become uncaught process errors; request errors still reject normally.
  pool.on('error', error => {
    // workerd can report socket closure after an intentionally ended request pool.
    if (pool.ending || pool.ended) return;
    captureOperationalError(error, 'database.connection');
    console.error('PostgreSQL idle connection failed.');
  });
  return pool;
}

/** Statements on one connection inside BEGIN/COMMIT, for row locks that must span several reads and writes. */
export type Transaction = Pick<Database, 'prepare'>;
export async function postgresTransaction<T>(pool: Pool, action: (tx: Transaction) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  const query = (sql: string, params: readonly unknown[]) => client.query<QueryResultRow>({ text: postgresSql(sql), values: [...params], types: businessTypes });
  const tx: Transaction = {
    prepare: (sql: string): PreparedStatement => ({
      async get<T = Row>(...params: unknown[]) { return (await query(sql, params)).rows[0] as T | undefined; },
      async all<T = Row>(...params: unknown[]) { return (await query(sql, params)).rows as T[]; },
      async run(...params: unknown[]) { return { changes: (await query(sql, params)).rowCount ?? 0, lastInsertRowid: 0 }; },
      bind(...params: unknown[]) { return { sql, params }; },
    }),
  };
  try {
    await client.query('BEGIN');
    const result = await action(tx);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

export function postgresDatabase(pool: Pool): Database {
  const query = (sql: string, params: readonly unknown[] = []) => pool.query<QueryResultRow>({ text: postgresSql(sql), values: [...params], types: businessTypes });
  const prepare = (sql: string): PreparedStatement => ({
    async get<T = Row>(...params: unknown[]) { return (await query(sql, params)).rows[0] as T | undefined; },
    async all<T = Row>(...params: unknown[]) { return (await query(sql, params)).rows as T[]; },
    async run(...params: unknown[]) { return { changes: (await query(sql, params)).rowCount ?? 0, lastInsertRowid: 0 }; },
    bind(...params: unknown[]) { return { sql, params }; },
  });
  return {
    prepare,
    async exec(sql) { await pool.query(postgresSql(sql)); },
    async batch(statements) {
      if (!statements.length) return [];
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const results = [];
        for (const statement of statements) {
          const result = await client.query(postgresSql(statement.sql), [...statement.params]);
          results.push({ changes: result.rowCount ?? 0, lastInsertRowid: 0 });
        }
        await client.query('COMMIT');
        return results;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally { client.release(); }
    },
    async close() { await pool.end(); },
  };
}
