/**
 * The database seam.
 *
 * K5 ran on `node:sqlite`, whose API is synchronous. D1 is the same SQLite dialect reached over a
 * binding, and every call is asynchronous. This interface is the narrow waist between the two, in
 * the same shape as the `ObjectStorage` and `VectorIndex` adapters: the application depends on the
 * interface, and which backend answers is an environment decision rather than a code change.
 *
 * The statement methods deliberately keep the `node:sqlite` argument shape — `get(...params)`,
 * `all(...params)`, `run(...params)` — so porting a call site means adding `await` and nothing
 * else. The SQL strings never change: both backends take `?` placeholders. That matters more than
 * it looks, because those 264 statements carry the `office_id` scoping that keeps one office from
 * reading another's, and rewriting them by hand is how that gets broken.
 */

export type Row = Record<string, unknown>;

/** What a write reports back, matching `node:sqlite`'s StatementResultingChanges. */
export interface RunResult {
  changes: number;
  lastInsertRowid: number;
}

/** A statement with its parameters already applied, ready to run inside a batch. */
export interface BoundStatement {
  readonly sql: string;
  readonly params: readonly unknown[];
}

export interface PreparedStatement {
  /** The first row, or undefined when the query selected none. */
  get<T = Row>(...params: unknown[]): Promise<T | undefined>;
  all<T = Row>(...params: unknown[]): Promise<T[]>;
  run(...params: unknown[]): Promise<RunResult>;
  /** Produces an entry for `batch` instead of executing now. */
  bind(...params: unknown[]): BoundStatement;
}

export interface Database {
  prepare(sql: string): PreparedStatement;
  /** Runs one or more statements with no parameters. Used by migrations and setup. */
  exec(sql: string): Promise<void>;
  /**
   * Runs every statement atomically: all of them commit, or none does.
   *
   * This replaces the `BEGIN IMMEDIATE`/`COMMIT` blocks the codebase used, and it is deliberately
   * write-only. D1 has no interactive transaction, so a read cannot hold a lock while the code
   * decides what to write next. Where the old code read and then wrote under one lock — claiming a
   * queued job, for instance — the replacement is a single conditional `UPDATE ... RETURNING`,
   * which is atomic on its own and says the same thing without pretending to hold a lock.
   */
  batch(statements: readonly BoundStatement[]): Promise<void>;
  /** Releases the handle. A no-op where connections are not owned by the process. */
  close(): Promise<void>;
}
