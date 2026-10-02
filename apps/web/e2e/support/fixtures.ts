import { test as base } from '@e2e-dev/web';
import pg from 'pg';

export type Sql = <T = Record<string, unknown>>(query: string, params?: unknown[]) => Promise<T[]>;

/**
 * `sql` reads the app's database inside a READ ONLY transaction, to prove side effects of what
 * the test did through the UI. State is created through the UI or the app's API, never here.
 */
export const test = base.extend<{ sql: Sql }>({
  // `provide` is the fixture's `use` callback, renamed so lint does not read it as React's `use`.
  sql: async ({}, provide) => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL ausente: as conferências no banco precisam da mesma base do servidor.');
    const client = new pg.Client({ connectionString });
    await client.connect();
    try {
      await provide(async <T,>(query: string, params: unknown[] = []) => {
        await client.query('BEGIN READ ONLY');
        try { return (await client.query(query, params)).rows as T[]; } finally { await client.query('ROLLBACK'); }
      });
    } finally {
      await client.end();
    }
  },
});

/** True when the page scrolls sideways, which apps/web/DESIGN.md forbids at every width. */
export const overflowsHorizontally = () => document.documentElement.scrollWidth > innerWidth;
