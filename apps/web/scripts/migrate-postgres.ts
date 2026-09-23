import { existsSync } from 'node:fs';
import { createPostgresPool } from '../src/lib/db/postgres';
import { migratePostgres } from '../src/lib/db/migrate';

const envFile=process.env.K5_ENV_FILE ?? '.env.postgres.local';
if (existsSync(envFile)) process.loadEnvFile(envFile);
const url=process.env.DATABASE_URL_UNPOOLED;
if (!url) throw new Error('Configure DATABASE_URL_UNPOOLED para aplicar migrações pelo endpoint direto.');
const pool=createPostgresPool(url,{max:1});
try { await migratePostgres(pool,new URL('../db/postgres/',import.meta.url)); console.log('Migrações PostgreSQL verificadas.'); }
finally { await pool.end(); }
