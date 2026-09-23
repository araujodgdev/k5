import { before } from 'node:test';
import { postgresFixture } from './postgres-fixture';
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import type { Database } from "../src/lib/db/types";

// Mock server-only so unit tests can import server modules under default Node conditions
const req = createRequire(import.meta.url);
try {
  const p = req.resolve("server-only");
  req.cache[p] = { id: p, filename: p, loaded: true, exports: {}, path: p } as unknown as NodeJS.Module;
} catch {
  // If not resolvable, ignore
}

const ready = postgresFixture();
before(async () => { await ready; });
export const testDatabase: Database = {
  prepare(sql) { return {
    async get<T>(...params: unknown[]) { return (await ready).db.prepare(sql).get<T>(...params); },
    async all<T>(...params: unknown[]) { return (await ready).db.prepare(sql).all<T>(...params); },
    async run(...params: unknown[]) { return (await ready).db.prepare(sql).run(...params); },
    bind(...params: unknown[]) { return {sql,params}; },
  }; },
  async exec(sql) { return (await ready).db.exec(sql); },
  async batch(statements) { return (await ready).db.batch(statements); },
  async close() { return (await ready).db.close(); },
};
export const testDb = testDatabase;
(globalThis as unknown as { k5Database: Promise<unknown> }).k5Database = ready.then(({pool})=>({database:testDatabase,store:pool}));

// Object storage under the test's own temporary root, so the traversal assertions exercise the
// real adapter instead of a stub that cannot fail the way production would.
export const testStorageRoot = mkdtempSync(resolve(tmpdir(), "k5-test-storage-"));
process.env.VAULT_STORAGE_PATH = testStorageRoot;
process.env.RESEARCH_STORAGE_PATH = resolve(testStorageRoot, 'research');
process.env.K5_CREDENTIALS_KEY ??= randomBytes(32).toString("base64");
