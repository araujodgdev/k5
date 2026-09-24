import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPostgresPool, postgresDatabase } from '../src/lib/db/postgres';
import { migratePostgres } from '../src/lib/db/migrate';

async function main() {
  const envFile = resolve(process.env.K5_ENV_FILE ?? '.env.local');
  if (!existsSync(envFile) && !process.env.BETTER_AUTH_SECRET) {
    if (process.env.NODE_ENV === 'production') throw new Error('Configure o ambiente de produção.');
    writeFileSync(envFile, `BETTER_AUTH_URL=http://localhost:3000\nBETTER_AUTH_SECRET=${randomBytes(48).toString('base64url')}\nDATABASE_URL=\nSESSION_IDLE_SECONDS=28800\n`, {mode:0o600});
    console.log('Ambiente local criado com segredo aleatório.');
  }
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  if (!process.env.K5_CREDENTIALS_KEY && process.env.NODE_ENV !== 'production') {
    const key = randomBytes(32).toString('base64');
    appendFileSync(envFile, `\nK5_CREDENTIALS_KEY=${key}\n`, {mode:0o600});
    process.env.K5_CREDENTIALS_KEY = key;
    console.log('Chave local de criptografia criada. Preserve seu backup junto aos dados.');
  }
  if (!process.env.BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET.length < 32) throw new Error('Configure BETTER_AUTH_SECRET.');
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) throw new Error('Configure DATABASE_URL para PostgreSQL.');
  const pool = createPostgresPool(url,{max:1});
  try {
    await migratePostgres(pool,new URL('../db/postgres/',import.meta.url));
    console.log('PostgreSQL pronto: esquema verificado e migrações aplicadas.');
    const {parseCredentialKeyring} = await import('../src/lib/platform-crypto');
    const {countSecretsNeedingReencryption} = await import('../src/lib/ai-connections-core');
    const pending = await countSecretsNeedingReencryption(postgresDatabase(pool),parseCredentialKeyring());
    if (pending) console.log(`${pending} credenciais de IA usam uma chave anterior. Execute platform:admin rotate-key após configurar o chaveiro.`);
  } finally { await pool.end(); }
}
main().catch(error=>{
  // Never print a driver error's connection string or row details.
  console.error(error instanceof Error && !('code' in error) ? error.message : 'Falha ao preparar PostgreSQL; confira a conexão e as migrações.');
  process.exitCode=1;
});
