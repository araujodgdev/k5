import type { BoundStatement, Database, PreparedStatement } from "./db/types";

/**
 * Resolves the database backend for whichever runtime is executing.
 *
 * Workers gets D1 through its binding; everything else — local development, the test suite, the
 * OCR and judicial workers — gets `node:sqlite` over a file. The choice is made once, on first
 * use, and never appears at a call site: `database.prepare(...)` reads the same in both.
 *
 * Resolution is deferred rather than done at module load because the D1 binding does not exist
 * until a request is being served, and because importing `node:sqlite` eagerly would drag it into
 * the Worker bundle, where it cannot exist.
 */

/** The pair every runtime resolves to: Lume's async seam, plus the handle Better Auth recognises. */
interface Backend {
  database: Database;
  /** A `node:sqlite` handle or a D1 binding — whatever `createAuth` can hand to Better Auth. */
  store: unknown;
}

const globalDatabase = globalThis as typeof globalThis & { k5Database?: Promise<Backend> };

async function workersBinding(): Promise<unknown | undefined> {
  // On Workers this import succeeds and carries the bindings; under Node it throws and we fall
  // through. A missing DB binding is a configuration error worth failing loudly on, so it is only
  // the absence of the module — not the absence of the binding — that selects the Node backend.
  let env: Record<string, unknown> | undefined;
  try {
    ({ env } = await import(/* webpackIgnore: true */ "cloudflare:workers"));
  } catch {
    return undefined;
  }
  if (!env) return undefined;
  if (!env.DB) throw new Error("Binding D1 'DB' ausente. Confira d1_databases em wrangler.jsonc.");
  return env.DB;
}

async function resolve(): Promise<Backend> {
  const binding = await workersBinding();
  if (binding) {
    const { d1Database } = await import("./db/d1");
    return { database: d1Database(binding as Parameters<typeof d1Database>[0]), store: binding };
  }

  const { openNodeSqlite } = await import("./db/node-sqlite");
  const opened = openNodeSqlite(process.env.DATABASE_PATH ?? ".data/k5.sqlite");
  return { database: opened.database, store: opened.handle };
}

// Cached on globalThis so a hot reload does not reopen the file, and so the Worker resolves its
// binding once per isolate rather than once per statement.
function backend(): Promise<Backend> {
  return (globalDatabase.k5Database ??= resolve());
}

/** The handle Better Auth talks to directly. Resolved from the same backend as `database`. */
export async function authStore(): Promise<unknown> {
  return (await backend()).store;
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
  async exec(sql: string) { return (await backend()).database.exec(sql); },
  async batch(statements: readonly BoundStatement[]) { return (await backend()).database.batch(statements); },
  async close() { return (await backend()).database.close(); },
};

export type { BoundStatement, Database, PreparedStatement, Row, RunResult } from "./db/types";
