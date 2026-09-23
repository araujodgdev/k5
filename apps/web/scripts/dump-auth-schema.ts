/** Compile an auth schema diff for review; never mutate the database or rewrite legacy migrations. */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { getMigrations } from 'better-auth/db/migration';
import { createAuth } from '../src/lib/auth-core';
import { createPostgresPool, postgresDatabase } from '../src/lib/db/postgres';
const envFile=process.env.K5_ENV_FILE??'.env.local';
if(existsSync(envFile))process.loadEnvFile(envFile);
const url=process.env.DATABASE_URL_UNPOOLED||process.env.DATABASE_URL;
if(!url)throw new Error('Configure a conexão PostgreSQL direta.');
const pool=createPostgresPool(url,{max:1});
try {
  const auth=createAuth(pool,postgresDatabase(pool),{secret:'schema-review-only-'.repeat(3),baseURL:'http://localhost:3000',idleSeconds:28800});
  const plan=await getMigrations(auth.options,{throwOnUnsafe:false});
  mkdirSync('.data',{recursive:true});
  writeFileSync('.data/auth-schema-review.sql',await plan.compileMigrations(),{mode:0o600});
  console.log('Diff do Better Auth salvo em .data/auth-schema-review.sql; revise antes de criar uma nova migração PostgreSQL.');
}finally{await pool.end();}
