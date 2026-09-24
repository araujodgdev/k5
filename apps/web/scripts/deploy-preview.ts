import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { createPostgresPool } from '../src/lib/db/postgres';
import { checkPostgresMigrations, migratePostgres } from '../src/lib/db/migrate';
import { buildPreviewConfig, previewName, previewUrl, validateDatabaseUrl, validateProfile, type PreviewProfile } from './preview-config';

const appDirectory = fileURLToPath(new URL('../', import.meta.url));
process.chdir(appDirectory);

function run(args: string[], env: NodeJS.ProcessEnv, capture = false) {
  // Invoke Node entrypoints directly: no shell interpretation of branch names or paths on Windows.
  const result = spawnSync(process.execPath, args, {
    cwd: appDirectory, env, windowsHide: true, encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit', maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw new Error(`Falha ao executar ${args[0]}.`);
  return result.stdout ?? '';
}

async function main() {
  const args = process.argv.slice(2);
  let explicitName: string | undefined;
  let checkOnly = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--name' && args[i + 1] && !explicitName) explicitName = args[++i];
    else if (args[i] === '--check') checkOnly = true;
    else throw new Error('Use preview:deploy [--name nome] [--check].');
  }
  const branch = spawnSync('git', ['branch', '--show-current'], { encoding: 'utf8', windowsHide: true }).stdout?.trim() ?? '';
  const name = previewName(branch, explicitName);
  const profilePath = resolve('previews', `${name}.json`);
  if (!existsSync(profilePath)) throw new Error(`Provisione os recursos isolados e crie previews/${name}.json; veja docs/previews.md.`);
  const profile: PreviewProfile = JSON.parse(readFileSync(profilePath, 'utf8'));
  validateProfile(profile, name);
  const directory = resolve('.data/previews', name);
  const databasePath = resolve(directory, 'database.env');
  if (!existsSync(databasePath)) throw new Error(`Configure DATABASE_URL e DATABASE_URL_UNPOOLED em .data/previews/${name}/database.env.`);
  const database = parseEnv(readFileSync(databasePath, 'utf8'));
  if (!database.DATABASE_URL) throw new Error('DATABASE_URL de leitura/escrita do preview ausente.');
  validateDatabaseUrl(database.DATABASE_URL, profile);
  if (database.DATABASE_URL_UNPOOLED) validateDatabaseUrl(database.DATABASE_URL_UNPOOLED, profile);

  // Check the actual Hyperdrive destination before any migration or deployment.
  const cliEnv = { ...process.env, CLOUDFLARE_ACCOUNT_ID: profile.accountId, CI: 'true', WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_LEVEL: 'error' };
  const wrangler = resolve('node_modules/wrangler/bin/wrangler.js');
  const hyperdriveOutput = run([wrangler, 'hyperdrive', 'get', profile.hyperdriveId], cliEnv, true);
  // Wrangler's get command prints a banner before its JSON (there is no --json flag).
  const hyperdrive = JSON.parse(hyperdriveOutput.slice(hyperdriveOutput.indexOf('{')));
  if (hyperdrive.origin?.host !== profile.databaseHost || hyperdrive.origin?.database !== 'postgres' ||
    !hyperdrive.origin?.user?.endsWith(`.${profile.databaseBranchId}`) || hyperdrive.caching?.disabled !== true ||
    (hyperdrive.integration && hyperdrive.integration.database_branch_name !== profile.databaseBranch)) {
    throw new Error('Hyperdrive não corresponde à branch de preview ou mantém cache de consultas ativo.');
  }
  const pool = createPostgresPool(database.DATABASE_URL, { max: 1 });
  let pending: string[];
  try { pending = await checkPostgresMigrations(pool, new URL('../db/postgres/', import.meta.url)); }
  finally { await pool.end(); }
  if (pending.length) {
    if (checkOnly) throw new Error(`Migrações pendentes no preview: ${pending.join(', ')}.`);
    if (!database.DATABASE_URL_UNPOOLED) throw new Error('Migrações pendentes: configure DATABASE_URL_UNPOOLED da branch de preview.');
    const admin = createPostgresPool(database.DATABASE_URL_UNPOOLED, { max: 1 });
    try { await migratePostgres(admin, new URL('../db/postgres/', import.meta.url)); }
    finally { await admin.end(); }
  }
  if (checkOnly) {
    console.log(`Preview ${name}: destino isolado, cache desativado e esquema atualizado.`);
    return;
  }

  mkdirSync(directory, { recursive: true });
  const secretsPath = resolve(directory, 'secrets.json');
  if (!existsSync(secretsPath)) writeFileSync(secretsPath, JSON.stringify({
    BETTER_AUTH_SECRET: randomBytes(48).toString('base64'),
    K5_CREDENTIALS_KEY: randomBytes(32).toString('base64'),
  }, null, 2), { mode: 0o600, flag: 'wx' });
  const secrets = JSON.parse(readFileSync(secretsPath, 'utf8')) as Record<string, string>;
  if (Object.keys(secrets).sort().join(',') !== 'BETTER_AUTH_SECRET,K5_CREDENTIALS_KEY' ||
    typeof secrets.BETTER_AUTH_SECRET !== 'string' || secrets.BETTER_AUTH_SECRET.length < 32 ||
    typeof secrets.K5_CREDENTIALS_KEY !== 'string' || Buffer.from(secrets.K5_CREDENTIALS_KEY, 'base64').length !== 32) {
    throw new Error('Secrets do preview inválidos; somente BETTER_AUTH_SECRET e K5_CREDENTIALS_KEY são permitidos.');
  }
  const configPath = resolve(directory, 'wrangler.json');
  const config = buildPreviewConfig(profile, appDirectory);
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  const env = {
    ...process.env, ...secrets, ...config.vars,
    DATABASE_URL: database.DATABASE_URL, DATABASE_URL_UNPOOLED: database.DATABASE_URL,
    K5_PREVIEW_CONFIG: configPath,
    NEXT_PUBLIC_SENTRY_ENVIRONMENT: `preview-${name}`,
    CLOUDFLARE_ACCOUNT_ID: profile.accountId, WRANGLER_SEND_METRICS: 'false',
  };
  run(['--import', 'tsx', 'scripts/generate-service-worker.ts'], env);
  run([resolve('node_modules/vinext/dist/cli.js'), 'build'], env);
  // Vite produces the final module and assets paths. Require the isolated bindings to survive it.
  const builtPath = resolve('dist/server/wrangler.json');
  const built = JSON.parse(readFileSync(builtPath, 'utf8'));
  if (built.name !== profile.workerName || built.previews?.hyperdrive?.[0]?.id !== profile.hyperdriveId ||
    built.previews?.r2_buckets?.[0]?.bucket_name !== profile.bucket ||
    built.previews?.vectorize?.[0]?.index_name !== profile.vectorIndex ||
    built.containers?.length || built.durable_objects?.bindings?.length || built.triggers?.crons?.length ||
    built.queues?.producers?.length || built.queues?.consumers?.length || built.services?.length || built.workflows?.length) {
    throw new Error('Build não preservou o isolamento do preview. Publicação bloqueada.');
  }
  run([wrangler, 'preview', '--config', builtPath, '--name', name, '--ignore-base-config', '--secrets-file', secretsPath], env);
  console.log(`Preview publicado: ${previewUrl(profile)}`);
}

main().catch(error => {
  const code = typeof error?.code === 'string' && /^[A-Z0-9_]+$/.test(error.code) ? error.code : undefined;
  // PostgreSQL failures can carry URLs, values or credentials. Never print their detail/stack.
  console.error(code ? `Falha no PostgreSQL do preview (${code}). Confira a credencial da branch.`
    : error instanceof Error && !/postgres(?:ql)?:\/\//i.test(error.message) ? error.message : 'Falha ao configurar preview.');
  process.exitCode = 1;
});
