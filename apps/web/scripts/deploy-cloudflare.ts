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

// Schema first: a newly uploaded Worker must never observe a database from the previous release.
run('pnpm', ['exec', 'wrangler', 'd1', 'migrations', 'apply', 'k5-staging', '--remote', '--config', configPath]);
run('pnpm', ['exec', 'vinext-cloudflare', 'deploy', '--config', 'dist/server/wrangler.json']);
