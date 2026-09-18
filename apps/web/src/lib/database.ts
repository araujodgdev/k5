import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

// Runtime data lives outside build artifacts and must never be traced into a bundle.
const databasePath = resolve(/* turbopackIgnore: true */ process.env.DATABASE_PATH ?? ".data/k5.sqlite");
const globalDatabase = globalThis as typeof globalThis & { k5Database?: DatabaseSync };

function openDatabase() {
  mkdirSync(dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  return db;
}

export const database = globalDatabase.k5Database ?? openDatabase();
if (process.env.NODE_ENV !== "production") globalDatabase.k5Database = database;
