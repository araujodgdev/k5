/** Async PostgreSQL interface shared by Node workers and the Hyperdrive request adapter.
 * Statements retain ? parameters and case-preserving aliases; postgresSql binds them for pg.
 * Business services own office scoping. A batch commits all writes in one transaction.
 */

export type Row = Record<string, unknown>;

/** Number of affected rows. IDs are application-generated; lastInsertRowid is always zero. */
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
   * Queue claims additionally use row locking with SKIP LOCKED inside UPDATE RETURNING.
   */
  batch(statements: readonly BoundStatement[]): Promise<RunResult[]>;
  /** Releases the handle. A no-op where connections are not owned by the process. */
  close(): Promise<void>;
}
