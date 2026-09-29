import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { SentryCli } from '@sentry/cli';
import { sentryBuildOptions } from './sentry-build';

const deploy = process.argv.includes('--deploy');
if (deploy && !sentryBuildOptions.authToken) throw new Error('SENTRY_AUTH_TOKEN é obrigatório para publicar com source maps.');
function wrangler(args: string[]) {
  const result = spawnSync('pnpm', ['exec', 'wrangler', ...args], {
    stdio: 'inherit', shell: process.platform === 'win32', windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const output = 'build/monitoring';
const bundle = `${output}/monitoring.js`;
wrangler(['deploy', '--config', 'wrangler.monitoring.jsonc', '--dry-run', '--outdir', output]);
if (!existsSync(`${bundle}.map`)) throw new Error('O build do monitor não gerou source maps.');
if (sentryBuildOptions.authToken) {
  const cli = new SentryCli(null, { ...sentryBuildOptions, silent: false });
  await cli.execute(['sourcemaps', 'inject', output], true);
  await cli.execute(['sourcemaps', 'upload', output], true);
}
if (deploy) {
  const secrets = '.data/monitoring/secrets.json';
  wrangler(['deploy', bundle, '--no-bundle', '--config', 'wrangler.monitoring.jsonc',
    ...(existsSync(secrets) ? ['--secrets-file', secrets] : [])]);
}
