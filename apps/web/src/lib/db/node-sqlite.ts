import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { BoundStatement, Database, PreparedStatement, Row, RunResult } from "./types";

/**
 * The `node:sqlite` backend: local development, the test suite and the Node workers that do OCR
 * and embeddings. It stays because those three need a database that a plain Node process owns,
 * and because the tests are the only place the whole schema is exercised end to end.
 *
 * The calls underneath are synchronous; the promises resolve immediately. Nothing here is made
 * faster or slower by the wrapper, only uniform with D1.
 */

/** node:sqlite returns rows with a null prototype, which cannot cross into a Client Component. */
function plain<T>(row: unknown): T {
  return { ...(row as object) } as T;
}

function statement(db: DatabaseSync, sql: string): PreparedStatement {
  return {
    async get<T = Row>(...params: unknown[]) {
      const row = db.prepare(sql).get(...(params as never[]));
      return row === undefined ? undefined : plain<T>(row);
    },
    async all<T = Row>(...params: unknown[]) {
      return db.prepare(sql).all(...(params as never[])).map(row => plain<T>(row));
    },
    async run(...params: unknown[]): Promise<RunResult> {
      const result = db.prepare(sql).run(...(params as never[]));
      return { changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) };
    },
    bind(...params: unknown[]): BoundStatement {
      return { sql, params };
    },
  };
}

export function nodeSqliteDatabase(db: DatabaseSync): Database {
  return {
    prepare: (sql: string) => statement(db, sql),
    async exec(sql: string) {
      db.exec(sql);
    },
    async batch(statements: readonly BoundStatement[]) {
      if (statements.length === 0) return [];
      // A real transaction, which is what this backend has and D1 does not. IMMEDIATE takes the
      // write lock up front so two workers cannot both begin and then collide on the first write.
      db.exec("BEGIN IMMEDIATE");
      try {
        const results = statements.map((entry) => {
          const result = db.prepare(entry.sql).run(...(entry.params as never[]));
          return { changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) };
        });
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    async close() {
      db.close();
    },
  };
}

/** Opens the file at `path`, creating its directory. Used by setup, tests and the workers. */
export function openNodeSqlite(path: string): { handle: DatabaseSync; database: Database } {
  const full = resolve(path);
  mkdirSync(dirname(full), { recursive: true });
  const handle = new DatabaseSync(full);
  handle.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
  return { handle, database: nodeSqliteDatabase(handle) };
}
