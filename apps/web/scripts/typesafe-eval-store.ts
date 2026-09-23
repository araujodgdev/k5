import { randomUUID,randomBytes } from 'node:crypto';
import { createPostgresPool,postgresDatabase } from '../src/lib/db/postgres';
import { migratePostgres } from '../src/lib/db/migrate';

const url=process.env.TEST_DATABASE_URL;
if(!url) throw new Error('Defina TEST_DATABASE_URL para a avaliação sintética PostgreSQL.');
const schema=`k5_eval_${randomUUID().replaceAll('-','')}`;
const admin=createPostgresPool(url,{max:1});
await admin.query(`CREATE SCHEMA "${schema}"`);
const pool=createPostgresPool(url,{max:3,options:`-c search_path=${schema}`});
export const testDb=postgresDatabase(pool);
testDb.close=async()=>{await pool.end();try{await admin.query(`DROP SCHEMA "${schema}" CASCADE`);}finally{await admin.end();}};
await migratePostgres(pool,new URL('../db/postgres/',import.meta.url));
await testDb.exec(`ALTER TABLE "user" ALTER COLUMN "emailVerified" SET DEFAULT false,
  ALTER COLUMN "officeName" SET DEFAULT 'Avaliação',ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP`);
(globalThis as unknown as {k5Database:Promise<unknown>}).k5Database=Promise.resolve({database:testDb,store:pool});
process.env.K5_CREDENTIALS_KEY=randomBytes(32).toString('base64');
