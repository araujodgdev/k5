import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { nodeSqliteDatabase } from '../src/lib/db/node-sqlite';
import type { Database } from '../src/lib/db/types';

export const testDb = new DatabaseSync(':memory:');
testDb.exec('PRAGMA foreign_keys=ON; CREATE TABLE user(id TEXT PRIMARY KEY,email TEXT NOT NULL,name TEXT NOT NULL);');
for (const file of readdirSync(new URL('../db/migrations/', import.meta.url)).filter(file => file.endsWith('.sql')).sort()) {
  testDb.exec(readFileSync(new URL(`../db/migrations/${file}`, import.meta.url), 'utf8'));
}
(globalThis as unknown as { k5Database: Promise<{ database: Database; store: unknown }> }).k5Database = Promise.resolve({ database: nodeSqliteDatabase(testDb), store: testDb });
process.env.K5_CREDENTIALS_KEY = randomBytes(32).toString('base64');
