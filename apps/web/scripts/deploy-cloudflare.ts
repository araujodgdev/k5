import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { sentryBuildOptions } from './sentry-build';

if (!sentryBuildOptions.authToken) throw new Error('SENTRY_AUTH_TOKEN é obrigatório para publicar com source maps.');

const configPath = 'wrangler.jsonc';
const config = readFileSync(configPath, 'utf8');
const accountId = config.match(/"account_id"\s*:\s*"([a-f0-9]{32})"/i)?.[1];

if (!accountId) throw new Error(`account_id ausente ou inválido em ${configPath}.`);

const environment = { ...process.env, CLOUDFLARE_ACCOUNT_ID: accountId };

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: environment,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// Import and validation precede the first cutover. An unset binding cannot deploy accidentally.
const hyperdriveId=config.match(/"hyperdrive"[\s\S]*?"id"\s*:\s*"([a-f0-9]{32})"/i)?.[1];
if (!hyperdriveId || /^0+$/.test(hyperdriveId)) throw new Error('Configure o Hyperdrive verificado após importar o PostgreSQL.');
run('pnpm', ['exec', 'tsx', 'scripts/migrate-postgres.ts']);
run('pnpm', ['exec', 'vinext-cloudflare', 'deploy', '--config', 'dist/server/wrangler.json']);
