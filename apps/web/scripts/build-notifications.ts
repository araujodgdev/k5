import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { SentryCli } from '@sentry/cli';
import { sentryBuildOptions } from './sentry-build';

const deploy = process.argv.includes('--deploy');
if (deploy && !sentryBuildOptions.authToken) throw new Error('SENTRY_AUTH_TOKEN é obrigatório para publicar com source maps.');

function wrangler(args: string[]) {
  const result = spawnSync('pnpm', ['exec', 'wrangler', ...args], { stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// Separate from dist/, which vinext replaces while building the web app.
const output = 'build/notifications';
const bundle = `${output}/notifications.js`;
wrangler(['deploy', '--config', 'wrangler.notifications.jsonc', '--dry-run', '--outdir', output]);
if (!existsSync(`${bundle}.map`)) throw new Error('O build de notificações não gerou source maps.');
if (sentryBuildOptions.authToken) {
  const cli = new SentryCli(null, { ...sentryBuildOptions, silent: false });
  await cli.execute(['sourcemaps', 'inject', output], true);
  await cli.execute(['sourcemaps', 'upload', output], true);
}
if (deploy) wrangler(['deploy', bundle, '--no-bundle', '--config', 'wrangler.notifications.jsonc', '--keep-vars']);
