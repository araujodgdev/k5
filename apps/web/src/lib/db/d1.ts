import type { BoundStatement, Database, PreparedStatement, Row, RunResult } from "./types";

/**
 * The D1 backend, used when the application runs on Cloudflare Workers.
 *
 * D1 speaks the same SQLite dialect and the same `?` placeholders as `node:sqlite`, so the SQL
 * carried across from the Node backend is unchanged. What differs is that every call is a network
 * round trip and that there is no interactive transaction: `batch` is the only atomic grouping,
 * and it cannot make a decision partway through.
 */

/** Structural types for the binding, so this module does not depend on generated Worker types. */
interface D1Result<T = Row> {
  results: T[];
  meta: { changes?: number; last_row_id?: number };
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Row>(): Promise<T | null>;
  all<T = Row>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}

export interface D1Binding {
  prepare(sql: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
  exec(sql: string): Promise<unknown>;
}

function statement(binding: D1Binding, sql: string): PreparedStatement {
  // D1 rejects bind() with no arguments on a statement that takes none, so the call is conditional.
  const prepared = (params: unknown[]) =>
    params.length === 0 ? binding.prepare(sql) : binding.prepare(sql).bind(...params);

  return {
    async get<T = Row>(...params: unknown[]) {
      // D1 reports "no row" as null; the rest of the codebase reads undefined.
      return (await prepared(params).first<T>()) ?? undefined;
    },
    async all<T = Row>(...params: unknown[]) {
      return (await prepared(params).all<T>()).results;
    },
    async run(...params: unknown[]): Promise<RunResult> {
      const { meta } = await prepared(params).run();
      return { changes: meta.changes ?? 0, lastInsertRowid: meta.last_row_id ?? 0 };
    },
    bind(...params: unknown[]): BoundStatement {
      return { sql, params };
    },
  };
}

export function d1Database(binding: D1Binding): Database {
  return {
    prepare: (sql: string) => statement(binding, sql),
    async exec(sql: string) {
      // D1's exec takes statements separated by newlines, not by semicolons alone.
      await binding.exec(sql.replace(/\r\n/g, "\n"));
    },
    async batch(statements: readonly BoundStatement[]) {
      if (statements.length === 0) return [];
      const results = await binding.batch(
        statements.map(entry =>
          entry.params.length === 0
            ? binding.prepare(entry.sql)
            : binding.prepare(entry.sql).bind(...entry.params),
        ),
      );
      return results.map(({ meta }) => ({
        changes: meta.changes ?? 0,
        lastInsertRowid: meta.last_row_id ?? 0,
      }));
    },
    async close() {
      // The binding is owned by the runtime, not by this process.
    },
  };
}
