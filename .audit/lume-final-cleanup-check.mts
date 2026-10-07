import { spawn } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync, createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const pointerFile = join(tmpdir(), 'lume-verify-current.json');
const pointer = JSON.parse(readFileSync(pointerFile, 'utf8'));
const state = JSON.parse(readFileSync(join(pointer.runDir, 'state.json'), 'utf8'));
if (state.runId !== '20261006T234247-d88728' || state.port !== 62541 || state.pgPort !== 62542
  || dirname(resolve(state.runDir)) !== resolve(tmpdir())
  || resolve(state.runDir) !== resolve(tmpdir(), `lume-verify-${state.runId}`)) throw Error('Wrong disposable run');
const isolated = Object.fromEntries(readFileSync(join(state.runDir, 'verify.env'), 'utf8').trim().split(/\r?\n/).map(line => {
  const index = line.indexOf('='); return [line.slice(0, index), line.slice(index + 1)];
}));
const names = new Set(['SENTRY_AUTH_TOKEN', 'SENTRY_REQUIRE_SOURCEMAPS', 'SENTRY_DSN', 'NEXT_PUBLIC_SENTRY_DSN']);
for (const file of ['.env.example', '.env', '.env.local', '.env.development', '.env.development.local', '.env.production', '.env.production.local']) {
  const path = join(root, 'apps/web', file);
  if (existsSync(path)) for (const match of readFileSync(path, 'utf8').matchAll(/^#?\s*(?:export\s+)?([A-Z][A-Z_0-9]+)=/gm)) names.add(match[1]);
}
const blank = Object.fromEntries([...names].map(name => [name, '']));
const output = join(state.evidenceDir, `final-cleanup-typecheck-${Date.now()}`);
mkdirSync(output, { recursive: true });
const log = createWriteStream(join(output, 'output.log'));
async function run(args: string[], env: NodeJS.ProcessEnv) {
  const child = spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', ...args], { cwd: root, windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const pipe of [child.stdout, child.stderr]) pipe.on('data', bytes => { log.write(bytes); process.stdout.write(bytes); });
  return await new Promise<number>((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)); });
}
const cleaned = await run(['pnpm --silent --dir apps/web exec tsx ../../.agents/skills/verify-lume/scripts/lume-verify.mts down'], process.env);
if (cleaned !== 0 || existsSync(pointerFile)) throw Error('Cleanup did not complete');
const checkEnv = {
  ...process.env, ...blank, ...isolated, K5_ENV_FILE: join(state.runDir, 'verify.env'),
  K5_NEXT_DIST_DIR: '.next-agent-verify', NODE_OPTIONS: '--max-old-space-size=6144',
};
const lint = await run(['pnpm lint --env-mode=loose'], checkEnv);
const code = await run(['pnpm typecheck --env-mode=loose'], checkEnv);
log.end();
console.log(JSON.stringify({ output, cleanupExitCode: cleaned, lintExitCode: lint, typecheckExitCode: code }));
process.exitCode = lint || code;
