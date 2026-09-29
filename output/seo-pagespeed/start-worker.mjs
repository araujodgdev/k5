import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const local = resolve('.data/seo-local');
mkdirSync(local, { recursive: true });
const config = JSON.parse(readFileSync('dist/server/wrangler.json', 'utf8'));
config.main = resolve('dist/server/index.js');
config.assets.directory = resolve('dist/client');
config.dev = { ...config.dev, enable_containers: false };
config.vars = { ...config.vars, BETTER_AUTH_URL: 'http://localhost:3107', PROCESSORS_ENABLED: 'false' };
writeFileSync(resolve(local, 'wrangler.json'), JSON.stringify(config));
const keys = ['BETTER_AUTH_SECRET', 'K5_CREDENTIALS_KEY', 'SESSION_IDLE_SECONDS', 'DATABASE_URL', 'DATABASE_URL_UNPOOLED'];
writeFileSync(resolve(local, '.dev.vars'), keys.filter(key => process.env[key]).map(key => `${key}=${JSON.stringify(process.env[key])}`).join('\n'), { mode: 0o600 });

const child = spawn(process.execPath, [
  resolve('node_modules/wrangler/bin/wrangler.js'), 'dev',
  '--config', resolve(local, 'wrangler.json'), '--port', '3107',
  '--local', '--enable-containers=false', '--env-file', resolve('.env.local'),
  '--var', 'BETTER_AUTH_URL:http://localhost:3107',
  '--var', 'PROCESSORS_ENABLED:false', '--log-level', 'warn',
], {
  stdio: 'inherit', windowsHide: true,
  env: { ...process.env, CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: process.env.DATABASE_URL },
});
child.on('exit', code => process.exit(code ?? 1));
