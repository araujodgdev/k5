import { randomUUID } from 'node:crypto';
import { after } from 'node:test';
import { createPostgresPool, postgresDatabase } from '../src/lib/db/postgres';
import { migratePostgres } from '../src/lib/db/migrate';

/** Each fixture owns a schema on a real PostgreSQL server; no shared business rows. */
export async function postgresFixture({ seedDefaults = true } = {}) {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('Execute pnpm test (ou configure TEST_DATABASE_URL para um PostgreSQL de testes).');
  const schema = `k5_test_${randomUUID().replaceAll('-','')}`;
  const admin = createPostgresPool(url,{ max:1,idleTimeoutMillis:100 });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = createPostgresPool(url,{max:3,idleTimeoutMillis:100,options:`-c search_path=${schema}`});
  const db = postgresDatabase(pool);
  let closed = false;
  db.close = async () => {
    if (closed) return;
    closed = true;
    await pool.end();
    try { await admin.query(`DROP SCHEMA "${schema}" CASCADE`); }
    finally { await admin.end(); }
  };
  after(() => db.close());
  try {
    await migratePostgres(pool,new URL('../db/postgres/',import.meta.url));
    if (seedDefaults) await db.exec(`ALTER TABLE "user"
      ALTER COLUMN "emailVerified" SET DEFAULT false,
      ALTER COLUMN "officeName" SET DEFAULT 'Escritório de teste',
      ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP,
      ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP`);
    return { db, database:db, pool };
  } catch (error) { await db.close(); throw error; }
}
