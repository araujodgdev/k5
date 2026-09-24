import { existsSync } from 'node:fs';
import { createPostgresPool } from '../src/lib/db/postgres';
import { checkPostgresMigrations, migratePostgres } from '../src/lib/db/migrate';

let connectionVariable = 'DATABASE_URL_UNPOOLED';

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => !['--deploy', '--check'].includes(arg))) throw new Error('Argumento desconhecido. Use --deploy ou --check; não é permitido pular a validação do esquema.');
  const envFile = process.env.K5_ENV_FILE ?? '.env.postgres.local';
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const adminUrl = process.env.DATABASE_URL_UNPOOLED;
  const runtimeUrl = process.env.PROCESSOR_DATABASE_URL;
  const directory = new URL('../db/postgres/', import.meta.url);

  if (args.includes('--deploy') || args.includes('--check')) {
    connectionVariable = runtimeUrl ? 'PROCESSOR_DATABASE_URL' : 'DATABASE_URL_UNPOOLED';
    const checkUrl = runtimeUrl || adminUrl;
    if (!checkUrl) throw new Error('Configure PROCESSOR_DATABASE_URL ou DATABASE_URL_UNPOOLED do destino para verificar o esquema.');
    const pool = createPostgresPool(checkUrl, { max: 1 });
    let pending: string[];
    try { pending = await checkPostgresMigrations(pool, directory); }
    finally { await pool.end(); }
    if (!pending.length) {
      console.log(runtimeUrl
        ? 'Esquema PostgreSQL atualizado; verificado sem usar a credencial administrativa.'
        : 'Esquema PostgreSQL atualizado; verificação somente de leitura.');
      return;
    }
    console.log(`Migrações pendentes: ${pending.join(', ')}.`);
    if (args.includes('--check')) throw new Error('Deploy bloqueado: aplique as migrações com DATABASE_URL_UNPOOLED administrativa válida.');
    if (runtimeUrl && adminUrl) {
      const runtime = new URL(runtimeUrl), admin = new URL(adminUrl);
      if (runtime.hostname !== admin.hostname || (runtime.port || '5432') !== (admin.port || '5432') || runtime.pathname !== admin.pathname) {
        throw new Error('PROCESSOR_DATABASE_URL e DATABASE_URL_UNPOOLED devem apontar para o mesmo endpoint direto e banco.');
      }
    }
  }

  connectionVariable = 'DATABASE_URL_UNPOOLED';
  if (!adminUrl) throw new Error('Configure DATABASE_URL_UNPOOLED administrativa válida para aplicar migrações pelo endpoint direto.');
  const pool = createPostgresPool(adminUrl, { max: 1 });
  try { await migratePostgres(pool, directory); console.log('Migrações PostgreSQL verificadas e aplicadas.'); }
  finally { await pool.end(); }
}

main().catch(error => {
  // Do not print driver messages, URLs, row details or credentials.
  const code = error && typeof error.code === 'string' ? error.code : undefined;
  if (code === '28P01' || code === '28000') {
    console.error(`PostgreSQL recusou a autenticação (${code}) de ${connectionVariable}. A credencial pode ter expirado ou sido revogada. No PlanetScale, emita/renove o papel correspondente e atualize essa variável no ambiente ou no arquivo selecionado por K5_ENV_FILE (padrão .env.postgres.local). A chave K5_CREDENTIALS_NEXT_KEY não substitui a senha do banco.`);
  } else if (code) {
    console.error(`Falha no PostgreSQL usando ${connectionVariable}; confira conectividade, permissões e migrações. Código: ${/^[A-Z0-9_]+$/.test(code) ? code : 'indisponível'}.`);
  } else {
    console.error(error instanceof Error && !/postgres(?:ql)?:\/\//i.test(error.message) ? error.message : 'Falha ao verificar PostgreSQL. Confira conexão e migrações.');
  }
  process.exitCode = 1;
});
