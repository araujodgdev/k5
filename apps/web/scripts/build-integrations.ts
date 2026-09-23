import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { SentryCli } from '@sentry/cli';
import { sentryBuildOptions } from './sentry-build';

const deploy = process.argv.includes('--deploy');
if (deploy) {
  const config = readFileSync('wrangler.integrations.jsonc', 'utf8');
  const id = config.match(/"hyperdrive"[\s\S]*?"id"\s*:\s*"([a-f0-9]{32})"/i)?.[1];
  if (!id || /^0+$/.test(id)) throw new Error('Configure o mesmo Hyperdrive validado para web e integrações.');
}
if (deploy && !sentryBuildOptions.authToken) throw new Error('SENTRY_AUTH_TOKEN é obrigatório para publicar com source maps.');

function wrangler(args: string[]) {
  const result = spawnSync('pnpm', ['exec', 'wrangler', ...args], { stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// Separate from dist/, which vinext replaces while building the web app.
const output = 'build/integrations';
const bundle = `${output}/integrations.js`;
wrangler(['deploy', '--config', 'wrangler.integrations.jsonc', '--dry-run', '--outdir', output]);
if (!existsSync(`${bundle}.map`)) throw new Error('O build de integrações não gerou source maps.');
if (deploy && sentryBuildOptions.authToken) {
  const cli = new SentryCli(null, { ...sentryBuildOptions, silent: false });
  await cli.execute(['sourcemaps', 'inject', output], true);
  await cli.execute(['sourcemaps', 'upload', output], true);
}
// Secrets (GOOGLE_OAUTH_CLIENT_ID/SECRET, K5_CREDENTIALS_KEY...) are set with `wrangler secret put`, never here.
if (deploy) wrangler(['deploy', bundle, '--no-bundle', '--config', 'wrangler.integrations.jsonc', '--keep-vars']);
