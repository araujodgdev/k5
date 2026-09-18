import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";

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
testDb.exec(readFileSync(new URL("../db/migrations/0001_offices.sql", import.meta.url), "utf8"));
testDb.exec(readFileSync(new URL("../db/migrations/0002_platform.sql", import.meta.url), "utf8"));
testDb.exec(readFileSync(new URL("../db/migrations/0003_vault.sql", import.meta.url), "utf8"));
testDb.exec(readFileSync(new URL("../db/migrations/0004_ai_workspace.sql", import.meta.url), "utf8"));
testDb.exec(readFileSync(new URL("../db/migrations/0005_ai_providers.sql", import.meta.url), "utf8"));
testDb.exec(readFileSync(new URL("../db/migrations/0006_vault_knowledge_index.sql", import.meta.url), "utf8"));
testDb.exec(readFileSync(new URL("../db/migrations/0007_upload_refs_and_index_jobs.sql", import.meta.url), "utf8"));
testDb.exec(readFileSync(new URL("../db/migrations/0008_ai_connection_embedding.sql", import.meta.url), "utf8"));

(globalThis as unknown as { k5Database: DatabaseSync }).k5Database = testDb;

// Object storage under the test's own temporary root, so the traversal assertions exercise the
// real adapter instead of a stub that cannot fail the way production would.
export const testStorageRoot = mkdtempSync(resolve(tmpdir(), "k5-test-storage-"));
process.env.VAULT_STORAGE_PATH = testStorageRoot;
process.env.K5_CREDENTIALS_KEY ??= randomBytes(32).toString("base64");
