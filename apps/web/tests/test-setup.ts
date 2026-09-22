import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { nodeSqliteDatabase } from "../src/lib/db/node-sqlite";
import type { Database } from "../src/lib/db/types";

// Mock server-only so unit tests can import server modules under default Node conditions
const req = createRequire(import.meta.url);
try {
  const p = req.resolve("server-only");
  req.cache[p] = { id: p, filename: p, loaded: true, exports: {}, path: p } as unknown as NodeJS.Module;
} catch {
  // If not resolvable, ignore
}

export const testDb = new DatabaseSync(":memory:");
testDb.exec("PRAGMA foreign_keys = ON;");
testDb.exec("CREATE TABLE IF NOT EXISTS user (id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL);");
testDb.exec("CREATE TABLE IF NOT EXISTS session (id TEXT PRIMARY KEY, user_id TEXT, userId TEXT, expires_at INTEGER);");
// Every migration in order, read from the directory: a new file is part of the schema under test
// the moment it exists, instead of when someone remembers to add a line here.
for (const name of readdirSync(new URL("../db/migrations", import.meta.url)).filter((file) => file.endsWith(".sql")).sort()) {
  testDb.exec(readFileSync(new URL(`../db/migrations/${name}`, import.meta.url), "utf8"));
}

/**
 * The suite keeps two handles on the same in-memory database.
 *
 * `testDb` is the raw synchronous handle, used where a test arranges rows or asserts against them
 * directly — that stays terse and needs no awaiting. `testDatabase` is the async `Database` the
 * application depends on, and it is what gets injected, so every module under test runs through
 * exactly the seam that D1 implements in production.
 */
export const testDatabase: Database = nodeSqliteDatabase(testDb);

// src/lib/database.ts caches the resolved backend here, so assigning it decides the backend
// before any application module asks for one. The raw handle travels along as the store, which is
// what Better Auth would be handed in production.
(globalThis as unknown as { k5Database: Promise<{ database: Database; store: unknown }> }).k5Database =
  Promise.resolve({ database: testDatabase, store: testDb });

// Object storage under the test's own temporary root, so the traversal assertions exercise the
// real adapter instead of a stub that cannot fail the way production would.
export const testStorageRoot = mkdtempSync(resolve(tmpdir(), "k5-test-storage-"));
process.env.VAULT_STORAGE_PATH = testStorageRoot;
process.env.RESEARCH_STORAGE_PATH = resolve(testStorageRoot, 'research');
process.env.K5_CREDENTIALS_KEY ??= randomBytes(32).toString("base64");
