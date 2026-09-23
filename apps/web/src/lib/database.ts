import { AsyncLocalStorage } from 'node:async_hooks';
import type { Pool } from 'pg';
import { createPostgresPool, postgresDatabase, postgresTransaction, type Transaction } from './db/postgres';
import type { BoundStatement, Database, PreparedStatement } from './db/types';

interface Backend { database: Database; store: Pool }
const requestDatabase = new AsyncLocalStorage<Backend>();
const globalDatabase = globalThis as typeof globalThis & { k5Database?: Promise<Backend>; k5Postgres?: Backend };

/** Node processes share a pool; Workers receive one pool per request through their entry point. */
export function databaseBackend(): Backend {
  const request = requestDatabase.getStore();
  if (request) return request;
  if (process.env.K5_RUNTIME === 'cloudflare') throw new Error('PostgreSQL request context is missing.');
  if (globalDatabase.k5Postgres) return globalDatabase.k5Postgres;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Configure DATABASE_URL para PostgreSQL e execute pnpm db:setup.');
  const pool = createPostgresPool(url);
  return (globalDatabase.k5Postgres = { database: postgresDatabase(pool), store: pool });
}

async function backend(): Promise<Backend> {
  return globalDatabase.k5Database ? globalDatabase.k5Database : databaseBackend();
}
export async function authStore(): Promise<Pool> { return (await backend()).store; }
/** Runs `action` in one PostgreSQL transaction on the current backend's pool. */
export async function withTransaction<T>(action: (tx: Transaction) => Promise<T>): Promise<T> {
  return postgresTransaction(await authStore(), action);
}

export function withPostgres<T>(pool: Pool, action: () => T): T {
  return requestDatabase.run({ database: postgresDatabase(pool), store: pool }, action);
}

function statement(sql: string): PreparedStatement {
  return {
    async get<T>(...params: unknown[]) { return (await backend()).database.prepare(sql).get<T>(...params); },
    async all<T>(...params: unknown[]) { return (await backend()).database.prepare(sql).all<T>(...params); },
    async run(...params: unknown[]) { return (await backend()).database.prepare(sql).run(...params); },
    bind(...params: unknown[]): BoundStatement { return { sql, params }; },
  };
}
export const database: Database = {
  prepare: statement,
  async exec(sql) { return (await backend()).database.exec(sql); },
  async batch(statements) { return (await backend()).database.batch(statements); },
  async close() {
    const current = await backend();
    await current.database.close();
    if (globalDatabase.k5Postgres === current) delete globalDatabase.k5Postgres;
  },
};
export type { BoundStatement, Database, PreparedStatement, Row, RunResult } from './db/types';
export type { Transaction } from './db/postgres';
