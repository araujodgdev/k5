/**
 * k5-verify: one entry point to launch an isolated K5 instance, drive mapped features in a real
 * browser, inspect its database read-only, and tear it down. Every command prints one JSON object
 * on stdout ({ ok: true, ... } or { ok: false, error: { code, message, fix } }); progress goes to
 * stderr. Run `k5-verify.mts help` or `k5-verify.mts <command> --help`.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const FEATURES = resolve(SCRIPTS, '../features');
export const WEB = resolve(SCRIPTS, '../../../../apps/web');
const webRequire = createRequire(join(WEB, 'package.json'));
const POINTER = join(tmpdir(), 'k5-verify-current.json');
// Build directory reserved for verification in next.config.ts, tsconfig.json and the ignore files.
const DIST_DIR = '.next-verify';
// tsconfig.json includes these so Next does not rewrite it, but next dev can leave them half-written
// (overlapping writes on Windows), which breaks `pnpm typecheck`. They are regenerated on every start.
const GENERATED_TYPES = join(WEB, DIST_DIR, 'dev', 'types');
const ACCOUNT = { name: 'Verificação K5', officeName: 'Escritório de Verificação', email: 'verify@k5.test', password: 'VerificaK5!2026#segura' };
const DEV_PORT = 3000;
const DEV_DB_PORT = 55432;
const CLI = 'pnpm --dir apps/web exec tsx ../../.claude/skills/verify-k5/scripts/k5-verify.mts';

export type State = {
  runId: string; runDir: string; status: 'starting' | 'ready' | 'failed' | 'stopped'; error?: string;
  supervisorPid: number; nextPid?: number; postmasterPid?: number; port: number; baseURL: string; pgPort: number; databaseUrl: string;
  evidenceDir: string; log: string; account: typeof ACCOUNT;
};

class CliError extends Error {
  constructor(readonly code: string, message: string, readonly fix: string, readonly details?: unknown) { super(message); }
}
const note = (line: string) => process.stderr.write(`[k5-verify] ${line}\n`);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const alive = (pid?: number) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch { return false; } };
const readJson = <T>(file: string): T | undefined => { try { return JSON.parse(readFileSync(file, 'utf8')) as T; } catch { return undefined; } };
export function currentState(): State | undefined {
  const pointer = readJson<{ runDir: string }>(POINTER);
  return pointer && readJson<State>(join(pointer.runDir, 'state.json'));
}
const writeState = (state: State) => writeFileSync(join(state.runDir, 'state.json'), JSON.stringify(state, null, 2));
const publicState = ({ databaseUrl, ...rest }: State) => ({ ...rest, databaseUrl: databaseUrl.replace(/:[^:@/]+@/, ':***@') });
function requireReady() {
  const state = currentState();
  if (!state) throw new CliError('NO_INSTANCE', 'No verification instance is registered.', `Start one with \`${CLI} up\`.`);
  if (state.status !== 'ready' || !alive(state.supervisorPid)) {
    throw new CliError('INSTANCE_NOT_READY', `Instance ${state.runId} is "${state.status}"${state.error ? `: ${state.error}` : ''}${alive(state.supervisorPid) ? '' : ' and its supervisor is gone'}.`,
      `Read ${state.log}, then run \`${CLI} down\` and \`${CLI} up\`.`);
  }
  return state;
}
async function freePort() {
  const server = createServer();
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as { port: number };
  await new Promise<void>(r => server.close(() => r()));
  return port;
}
/** Kill a process and everything it spawned. Only called with PIDs this tool started. */
function killTree(pid?: number) {
  if (!alive(pid)) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  else { try { process.kill(-pid!, 'SIGTERM'); } catch { try { process.kill(pid!, 'SIGTERM'); } catch { /* already gone */ } } }
}
/** Names Next would load from apps/web/.env*; blanking them keeps the developer's keys out of the instance. */
function developerEnvNames() {
  const names = new Set<string>();
  for (const file of ['.env', '.env.local', '.env.development', '.env.development.local']) {
    const path = join(WEB, file);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
      if (match) names.add(match[1]);
    }
  }
  return names;
}
async function pgClient(url: string) {
  const { Client } = webRequire('pg') as typeof import('pg');
  const client = new Client({ connectionString: url });
  await client.connect();
  return client;
}
/**
 * Clean PostgreSQL shutdown. embedded-postgres' own stop() force-kills the postmaster on Windows,
 * which can orphan PG 18 io_worker processes that keep the port open.
 */
async function stopPostgres(dataDir: string) {
  if (!existsSync(join(dataDir, 'postmaster.pid'))) return;
  const { default: getBinaries } = await import(pathToFileURL(join(dirname(webRequire.resolve('embedded-postgres')), 'binary.js')).href);
  const { pg_ctl } = await getBinaries();
  spawnSync(pg_ctl, ['stop', '-D', dataDir, '-m', 'fast', '-w', '-t', '30'], { stdio: 'ignore', windowsHide: true });
}
const postmasterPid = (dataDir: string) => Number(readFileSync(join(dataDir, 'postmaster.pid'), 'utf8').split(/\r?\n/)[0]) || undefined;

/** Only a scratch directory this tool created may be deleted. */
const ownedRunDir = (dir: string) => dirname(resolve(dir)) === resolve(tmpdir()) && /^k5-verify-[\w-]+$/.test(basename(dir));

// ---------------------------------------------------------------- supervisor (internal)

async function serve(runDir: string) {
  const state = readJson<State>(join(runDir, 'state.json'))!;
  // The supervisor has no inherited stdio; it and its children write to the run log.
  const logFd = openSync(state.log, 'a');
  const log = (line: string) => appendFileSync(state.log, `[k5-verify] ${line}\n`);
  let next: ChildProcess | undefined;
  const { default: EmbeddedPostgres } = await import(pathToFileURL(webRequire.resolve('embedded-postgres')).href);
  const password = randomBytes(24).toString('hex');
  const postgres = new EmbeddedPostgres({
    databaseDir: join(runDir, 'pg'), user: 'postgres', password, port: state.pgPort, persistent: true,
    authMethod: 'scram-sha-256', initdbFlags: ['--encoding=UTF8', '--locale=C'], postgresFlags: ['-h', '127.0.0.1'],
    onLog: () => {}, onError: () => {},
  });
  const stop = async () => {
    killTree(next?.pid);
    await stopPostgres(join(runDir, 'pg'));
    // embedded-postgres' exit hook would otherwise call stop() again and wait forever for an exit that already happened.
    (postgres as unknown as { process?: unknown }).process = undefined;
  };
  try {
    await postgres.initialise();
    await postgres.start();
    state.postmasterPid = postmasterPid(join(runDir, 'pg')); writeState(state);
    const admin = postgres.getPgClient(); await admin.connect(); await admin.query('CREATE DATABASE k5_verify'); await admin.end();
    state.databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${state.pgPort}/k5_verify`;
    const envFile = join(runDir, 'verify.env');
    const env: Record<string, string> = {
      BETTER_AUTH_URL: state.baseURL, BETTER_AUTH_SECRET: randomBytes(48).toString('base64url'),
      DATABASE_URL: state.databaseUrl, DATABASE_URL_UNPOOLED: state.databaseUrl, SESSION_IDLE_SECONDS: '28800',
      K5_CREDENTIALS_KEY: randomBytes(32).toString('base64'), RESEARCH_STORAGE_PATH: join(runDir, 'research-objects'),
      SENTRY_ENABLED: 'false', NEXT_PUBLIC_SENTRY_ENABLED: 'false',
      // The e2e suite's HTTP sessions each send their own value, so its many test accounts get
      // separate auth rate-limit buckets. Only this local instance trusts the header.
      K5_CLIENT_IP_HEADER: 'x-e2e-client',
    };
    writeFileSync(envFile, Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600 });
    const setup = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/setup.ts'], { cwd: WEB, stdio: ['ignore', logFd, logFd], windowsHide: true, env: { ...process.env, K5_ENV_FILE: envFile } });
    if (setup.status !== 0) throw new Error('scripts/setup.ts (migrations) failed on the verification database.');
    const blank = Object.fromEntries([...developerEnvNames()].filter(name => !(name in env)).map(name => [name, '']));
    next = spawn(process.execPath, [webRequire.resolve('next/dist/bin/next'), 'dev', '--port', String(state.port), '--hostname', '127.0.0.1'], {
      cwd: WEB, stdio: ['ignore', logFd, logFd], windowsHide: true, detached: process.platform !== 'win32',
      env: { ...process.env, ...blank, ...env, K5_NEXT_DIST_DIR: DIST_DIR, NEXT_TELEMETRY_DISABLED: '1' },
    });
    state.nextPid = next.pid; writeState(state);
    const deadline = Date.now() + 300_000;
    for (;;) {
      if (next.exitCode !== null) throw new Error(`next dev exited with code ${next.exitCode}.`);
      if (Date.now() > deadline) throw new Error('next dev did not serve /sign-in within 5 minutes.');
      try { if ((await fetch(`${state.baseURL}/sign-in`)).ok) break; } catch { /* still compiling */ }
      await sleep(1000);
    }
    // The real Better Auth endpoint the sign-up form calls; provisions the office through its hook.
    const signUp = await fetch(`${state.baseURL}/api/auth/sign-up/email`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: state.baseURL },
      body: JSON.stringify({ name: ACCOUNT.name, officeName: ACCOUNT.officeName, email: ACCOUNT.email, password: ACCOUNT.password }),
    });
    if (!signUp.ok) throw new Error(`Registering the verification account failed: HTTP ${signUp.status} ${await signUp.text()}`);
    state.status = 'ready'; writeState(state);
    log(`ready at ${state.baseURL}`);
    while (!existsSync(join(runDir, 'stop')) && next.exitCode === null) await sleep(500);
    if (next.exitCode !== null && !existsSync(join(runDir, 'stop'))) throw new Error(`next dev exited with code ${next.exitCode}.`);
    await stop();
    state.status = 'stopped'; writeState(state);
  } catch (error) {
    state.status = 'failed'; state.error = error instanceof Error ? error.message : String(error); writeState(state);
    log(state.error);
    await stop();
    process.exitCode = 1;
  }
}

/**
 * Start `serve` fully detached. On Windows a spawned child inherits the caller's pipe handles and
 * keeps the calling shell waiting until the instance stops; Start-Process does not inherit them.
 */
function launchSupervisor(runDir: string) {
  const args = ['--import', 'tsx', fileURLToPath(import.meta.url), 'serve', runDir];
  if (process.platform !== 'win32') {
    const child = spawn(process.execPath, args, { cwd: WEB, detached: true, stdio: 'ignore' });
    child.unref();
    return child.pid!;
  }
  const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;
  const command = `(Start-Process -FilePath ${quote(process.execPath)} -ArgumentList ${args.map(arg => quote(`"${arg}"`)).join(',')} -WorkingDirectory ${quote(WEB)} -WindowStyle Hidden -PassThru).Id`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true });
  const pid = Number(result.stdout.trim());
  if (result.status !== 0 || !pid) throw new CliError('SUPERVISOR_START_FAILED', `Start-Process failed: ${result.stderr.trim()}`, 'Check that powershell.exe is on PATH and that Node can run apps/web scripts with tsx.');
  return pid;
}

// ---------------------------------------------------------------- commands

async function up(flags: Flags) {
  const existing = currentState();
  if (existing && alive(existing.supervisorPid)) {
    throw new CliError('INSTANCE_ALREADY_RUNNING', `Instance ${existing.runId} is already running at ${existing.baseURL} (only one at a time: they share ${DIST_DIR}).`,
      `Reuse it (\`${CLI} doctor\`), or stop it first with \`${CLI} down\`.`, publicState(existing));
  }
  const runId = `${new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '')}-${randomUUID().slice(0, 6)}`;
  const runDir = join(tmpdir(), `k5-verify-${runId}`);
  // Inside apps/web, because e2e writes its output under the project root; .e2e/ is git-ignored.
  const evidenceDir = join(WEB, '.e2e', 'verify', runId);
  const port = await freePort(); const pgPort = await freePort();
  if (port === DEV_PORT || pgPort === DEV_DB_PORT) throw new CliError('PORT_COLLISION', `The OS offered a developer port (${port}/${pgPort}).`, `Run \`${CLI} up\` again.`);
  const plan = { runId, runDir, evidenceDir, baseURL: `http://127.0.0.1:${port}`, pgPort, distDir: join(WEB, DIST_DIR), cleansStaleRun: existing ? existing.runDir : null };
  if (flags['dry-run']) return { dryRun: true, wouldCreate: plan, next: `Run \`${CLI} up\` without --dry-run to start it.` };
  if (existing) { note(`cleaning leftovers of dead run ${existing.runId}`); await down({}); }
  mkdirSync(runDir, { recursive: true });
  mkdirSync(evidenceDir, { recursive: true });
  const log = join(runDir, 'instance.log');
  const state: State = { runId, runDir, status: 'starting', supervisorPid: 0, port, baseURL: plan.baseURL, pgPort, databaseUrl: '', evidenceDir, log, account: ACCOUNT };
  writeState(state);
  writeFileSync(POINTER, JSON.stringify({ runId, runDir }));
  state.supervisorPid = launchSupervisor(runDir); writeState(state);
  note(`starting ${runId} at ${state.baseURL}; first compile takes about a minute (log: ${log})`);
  const deadline = Date.now() + 330_000;
  for (;;) {
    const now = currentState()!;
    if (now.status === 'ready') return { instance: publicState(now), next: `Run \`${CLI} doctor\`, then \`${CLI} features\` to pick what to drive.` };
    if (now.status === 'failed' || !alive(state.supervisorPid)) {
      throw new CliError('START_FAILED', `The instance failed to start: ${now.error ?? 'the supervisor exited'}.`, `Read ${log} for the cause, then run \`${CLI} down\` before retrying.`);
    }
    if (Date.now() > deadline) throw new CliError('START_TIMEOUT', 'The instance was not ready within 5.5 minutes.', `Read ${log}; if next dev is still compiling, wait and run \`${CLI} doctor\`, otherwise \`${CLI} down\`.`);
    await sleep(1000);
  }
}

function status() {
  const state = currentState();
  if (!state) return { instance: null, next: `No instance. Start one with \`${CLI} up\`.` };
  return { instance: { ...publicState(state), supervisorAlive: alive(state.supervisorPid), nextAlive: alive(state.nextPid) } };
}

async function doctor() {
  const state = currentState();
  if (!state) throw new CliError('NO_INSTANCE', 'No verification instance is registered.', `Start one with \`${CLI} up\`.`);
  const checks: { name: string; ok: boolean; detail: string; fix?: string }[] = [];
  const restart = `Read ${state.log}, then \`${CLI} down\` and \`${CLI} up\`.`;
  checks.push({ name: 'status-ready', ok: state.status === 'ready', detail: state.status + (state.error ? `: ${state.error}` : ''), fix: restart });
  checks.push({ name: 'supervisor-alive', ok: alive(state.supervisorPid), detail: `pid ${state.supervisorPid}`, fix: restart });
  checks.push({ name: 'next-dev-alive', ok: alive(state.nextPid), detail: `pid ${state.nextPid}`, fix: restart });
  checks.push({ name: 'isolated-from-dev', ok: state.port !== DEV_PORT && state.pgPort !== DEV_DB_PORT && !state.databaseUrl.includes(`:${DEV_DB_PORT}/`), detail: `app ${state.port}, pg ${state.pgPort}`, fix: `Do not drive this instance. Run \`${CLI} down\` and \`${CLI} up\`.` });
  try {
    const res = await fetch(`${state.baseURL}/sign-in`);
    checks.push({ name: 'sign-in-serves-lume', ok: res.ok && (await res.text()).includes('Entre no Lume'), detail: `HTTP ${res.status}`, fix: restart });
  } catch (error) { checks.push({ name: 'sign-in-serves-lume', ok: false, detail: String(error), fix: restart }); }
  try {
    const client = await pgClient(state.databaseUrl);
    try {
      const { rows } = await client.query(`SELECT u.email, o.name AS office FROM "user" u JOIN office_member m ON m.user_id=u.id JOIN office o ON o.id=m.office_id WHERE u.email=$1`, [state.account.email]);
      checks.push({ name: 'account-has-office', ok: rows.length === 1, detail: rows[0] ? `${rows[0].email} → ${rows[0].office}` : 'missing', fix: restart });
    } finally { await client.end(); }
  } catch (error) { checks.push({ name: 'database-reachable', ok: false, detail: error instanceof Error ? error.message : String(error), fix: restart }); }
  const ok = checks.every(check => check.ok);
  const result = { healthy: ok, checks: checks.map(({ fix, ...check }) => (check.ok ? check : { ...check, fix })), baseURL: state.baseURL, evidenceDir: state.evidenceDir };
  if (!ok) throw new CliError('UNHEALTHY', `Doctor failed: ${checks.filter(c => !c.ok).map(c => c.name).join(', ')}. Do not drive this instance.`, restart, result);
  return result;
}

// Each recipe names the e2e tests that prove it, one `Test:` line per file under apps/web/e2e/.
function listFeatures() {
  return readdirSync(FEATURES).filter(file => file.endsWith('.md') && file !== 'README.md').map(file => {
    const id = file.replace(/\.md$/, '');
    const text = readFileSync(join(FEATURES, file), 'utf8');
    const tests = [...text.matchAll(/^Test: `apps\/web\/(e2e\/[^`]+\.e2e\.ts)`/gm)].map(match => match[1]);
    return { id, title: /^# (.+)$/m.exec(text)?.[1] ?? id, recipe: join(FEATURES, file), tests: tests.filter(test => existsSync(join(WEB, test))) };
  });
}

function features() {
  const list = listFeatures();
  return { features: list, next: `Read a feature's recipe before driving it; \`${CLI} drive <id>\` runs its e2e tests against the instance. A feature without tests needs an apps/web/e2e/<name>.e2e.ts and a \`Test:\` line in its recipe.` };
}

type E2EReport = { run: { status: string; exitCode: number; results: { titlePath: string[]; file: string; status: string; tags: string[]; error?: { code?: string; message?: string };
  attempts: { artifacts: { kind?: string; path?: string }[] }[] }[] } };

function drive(args: string[]) {
  const id = args[0];
  const known = listFeatures();
  if (!id) throw new CliError('MISSING_FEATURE', 'drive needs a feature id.', `Pick one of: ${known.map(f => f.id).join(', ')}. Example: \`${CLI} drive office-tasks\`.`);
  const feature = known.find(f => f.id === id);
  if (!feature) throw new CliError('UNKNOWN_FEATURE', `No feature "${id}" in the map.`, `Use one of: ${known.map(f => f.id).join(', ')}. To add one, write features/${id}.md following features/README.md.`);
  if (!feature.tests.length) throw new CliError('NO_TESTS', `Feature "${id}" has a recipe but no e2e test.`, `Write apps/web/e2e/<name>.e2e.ts from ${feature.recipe}, add a \`Test:\` line for it to the recipe, then rerun.`);
  const state = requireReady();
  const dir = join(state.evidenceDir, id);
  // Results of an earlier drive of the same feature must not be reported as this run's.
  rmSync(dir, { recursive: true, force: true });
  note(`driving ${id} (${feature.tests.join(', ')}) against ${state.baseURL}`);
  const bin = join(WEB, 'node_modules', 'e2e', JSON.parse(readFileSync(join(WEB, 'node_modules', 'e2e', 'package.json'), 'utf8')).bin.e2e);
  const run = spawnSync(process.execPath, [bin, 'run', ...feature.tests, '--output', relative(WEB, dir), '--reporter', 'list,markdown', '--trace', 'on', '--retries', '0'], {
    cwd: WEB, encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024,
    // apps/web/e2e.config.ts targets K5_E2E_URL instead of starting a server; tests sign in as this account.
    env: { ...process.env, K5_E2E_URL: state.baseURL, DATABASE_URL: state.databaseUrl, E2E_EMAIL: state.account.email, E2E_PASSWORD: state.account.password, E2E_OFFICE_NAME: state.account.officeName },
  });
  const report = readJson<E2EReport>(join(dir, 'report.json'));
  const tests = (report?.run.results ?? []).filter(result => result.status !== 'skipped').map(result => ({
    title: result.titlePath.join(' › '), file: result.file, status: result.status,
    ...(result.error ? { error: [result.error.code, result.error.message].filter(Boolean).join(': ') } : {}),
    artifacts: result.attempts.flatMap(attempt => attempt.artifacts.flatMap(artifact => artifact.path ? [join(dir, 'artifacts', artifact.path)] : [])),
  }));
  const result = { feature: id, passed: run.status === 0, evidenceDir: dir, summary: join(dir, 'summary.md'), tests };
  if (run.status !== 0) {
    // The runner prints colors; strip them so the failure reads as plain text in JSON.
    const failure = `${run.stdout}\n${run.stderr}`.replace(/\x1b\[[0-9;]*m/g, '').split('\n')
      .filter(line => line.trim() && !/^\s+at /.test(line) && !/^⎯+/.test(line.trim())).slice(-25).join('\n');
    throw new CliError('DRIVE_FAILED', `e2e exited ${run.status} for ${id}: ${tests.filter(test => test.status !== 'passed').length} test(s) did not pass.`,
      `Read ${join(dir, 'summary.md')} and its failures/ pages, then open the trace (\`pnpm --dir apps/web exec playwright show-trace <artifacts/.../trace.zip>\`). If the app is wrong, report it; if the test is wrong, fix it and note the trap in the feature's Gotchas.`,
      { ...result, failure });
  }
  return result;
}

async function sql(args: string[], flags: Flags) {
  const query = args[0];
  if (!query) throw new CliError('MISSING_QUERY', 'sql needs a query.', `Example: \`${CLI} sql "SELECT title, status FROM agenda_activity WHERE title=$1" --params '["Minha tarefa"]'\`.`);
  let params: unknown[] = [];
  if (typeof flags.params === 'string') {
    try { params = JSON.parse(flags.params); } catch { throw new CliError('BAD_PARAMS', '--params is not valid JSON.', `Pass a JSON array, e.g. --params '["value", 1]'.`); }
    if (!Array.isArray(params)) throw new CliError('BAD_PARAMS', '--params must be a JSON array.', `Wrap the values: --params '["value"]'.`);
  }
  const state = requireReady();
  const client = await pgClient(state.databaseUrl);
  try {
    await client.query('BEGIN READ ONLY');
    const { rows, rowCount } = await client.query(query, params);
    return { rowCount, rows };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const fix = /read-only transaction/.test(message)
      ? 'sql is read-only by design. Create or change data through the UI in a driver, so the proof exercises the real user path.'
      : /does not exist/.test(message) ? 'Check table and column names in apps/web/db/postgres/*.sql (Better Auth columns are camelCase and quoted, e.g. "userId").'
        : 'Fix the query; use $1, $2 placeholders with --params.';
    throw new CliError('QUERY_FAILED', message, fix);
  } finally { await client.query('ROLLBACK').catch(() => {}); await client.end(); }
}

async function down(flags: Flags) {
  const state = currentState();
  if (!state) return { stopped: null, next: 'Nothing to stop: no verification instance is registered.' };
  const plan = {
    runId: state.runId,
    stop: { supervisorPid: alive(state.supervisorPid) ? state.supervisorPid : null, nextPid: alive(state.nextPid) ? state.nextPid : null, postmasterPid: alive(state.postmasterPid) ? state.postmasterPid : null },
    delete: [...(ownedRunDir(state.runDir) ? [state.runDir] : []), POINTER, GENERATED_TYPES],
    keep: state.evidenceDir,
  };
  if (flags['dry-run']) return { dryRun: true, wouldDo: plan, next: `Run \`${CLI} down\` without --dry-run to apply.` };
  if (alive(state.supervisorPid)) {
    writeFileSync(join(state.runDir, 'stop'), '');
    const deadline = Date.now() + 30_000;
    while (alive(state.supervisorPid) && Date.now() < deadline) await sleep(500);
    if (alive(state.supervisorPid)) { note('supervisor did not stop in 30 s; killing its process tree'); killTree(state.nextPid); killTree(state.supervisorPid); await sleep(1000); }
  } else killTree(state.nextPid);
  // A supervisor that died or was killed leaves PostgreSQL running; shut it down cleanly.
  if (alive(state.postmasterPid)) { note(`stopping PostgreSQL ${state.postmasterPid} with pg_ctl`); await stopPostgres(join(state.runDir, 'pg')); }
  if (ownedRunDir(state.runDir)) rmSync(state.runDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  rmSync(GENERATED_TYPES, { recursive: true, force: true });
  rmSync(POINTER, { force: true });
  const leftovers = [state.supervisorPid, state.nextPid, state.postmasterPid].filter(pid => alive(pid));
  if (leftovers.length) throw new CliError('STOP_INCOMPLETE', `Processes still alive: ${leftovers.join(', ')}.`, `They were started by run ${state.runId}; stop them with taskkill /PID <pid> /T /F (never by process name).`, plan);
  return { stopped: plan, evidenceKept: existsSync(state.evidenceDir) ? state.evidenceDir : null };
}

// ---------------------------------------------------------------- help and dispatch

const HELP: Record<string, string> = {
  '': `k5-verify: isolated K5 instance for end-to-end verification. Every command prints JSON on stdout.

Usage: ${CLI} <command> [options]

Commands (in the order you use them):
  up         start an isolated instance (own database, port and build dir)
  doctor     read-only health check; run before driving
  features   list mapped features, their recipes and e2e tests
  drive      run a feature's e2e tests against the instance and collect evidence
  sql        read-only query against the instance database
  status     show the registered instance without checking it
  down       stop the instance and delete its scratch data (evidence is kept)

Run \`${CLI} <command> --help\` for options and examples.`,
  up: `up [--dry-run]
Start an isolated instance: embedded PostgreSQL on a free port, all migrations, fresh secrets,
\`next dev\` on a free port with build dir ${DIST_DIR}, and the account ${ACCOUNT.email} (office "${ACCOUNT.officeName}").
Developer keys from apps/web/.env* are blanked, so external integrations are off. Workers are not started.
Blocks until ready (first compile about 1 minute). Only one instance at a time.
  --dry-run   print the run id, directories and ports it would use; start nothing
Output: { ok, instance: { runId, baseURL, account, evidenceDir, log, ... } }`,
  doctor: `doctor
Read-only checks: status ready, supervisor and next dev alive, ports isolated from 3000/55432,
/sign-in serving Lume, verification account provisioned with its office.
Output: { ok, healthy, checks: [{ name, ok, detail, fix? }] }. ok:false means do not drive.`,
  features: `features
List the feature map (features/*.md) with each recipe path and the e2e tests its \`Test:\` lines name.
Output: { ok, features: [{ id, title, recipe, tests }] }`,
  drive: `drive <feature-id>
Run the feature's e2e tests (apps/web/e2e/*.e2e.ts) against the ready instance, signed in as its
account, with a trace for every test. The report, summary.md, screenshots and traces go to
<evidenceDir>/<feature-id>/. Agent tests (e2e/agent/) need OPENAI_API_KEY in your environment.
Output: { ok, passed, tests: [{ title, status, error?, artifacts }], summary, evidenceDir }; on failure, error.details.failure has the runner's last lines.
Example: ${CLI} drive office-tasks`,
  sql: `sql "<query>" [--params '<json array>']
Run one query inside a READ ONLY transaction on the instance database. Writes are rejected by design.
Output: { ok, rowCount, rows }
Example: ${CLI} sql "SELECT title, status FROM agenda_activity WHERE title=$1" --params '["Minha tarefa"]'`,
  status: `status
Print the registered instance (runId, baseURL, pids, paths) without contacting it.
Output: { ok, instance | null }`,
  down: `down [--dry-run]
Stop the supervisor, next dev (process tree) and PostgreSQL started by this tool, delete the run's scratch
directory in the temp dir, and unregister it. Kills only recorded PIDs, never by process name.
The evidence directory is kept.
  --dry-run   print what would be stopped, deleted and kept; change nothing
Output: { ok, stopped, evidenceKept }`,
};

type Flags = Record<string, string | boolean>;
function parse(argv: string[]) {
  const args: string[] = []; const flags: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h') flags.help = true;
    else if (arg.startsWith('--')) {
      const [key, inline] = arg.slice(2).split(/=(.*)/s);
      if (inline !== undefined) flags[key] = inline;
      else if (key === 'params') flags[key] = argv[++i] ?? '';
      else flags[key] = true;
    } else args.push(arg);
  }
  return { args, flags };
}
const ALLOWED: Record<string, string[]> = { up: ['dry-run'], down: ['dry-run'], sql: ['params'], doctor: [], features: [], drive: [], status: [] };

async function main() {
  const [command = 'help', ...rest] = process.argv.slice(2);
  if (command === 'serve') return serve(rest[0]);
  const { args, flags } = parse(rest);
  if (command === 'help' || command === '--help' || command === '-h') { process.stdout.write(`${HELP[args[0] ?? ''] ?? HELP['']}\n`); return; }
  if (flags.help) { process.stdout.write(`${HELP[command] ?? HELP['']}\n`); return; }
  try {
    if (!(command in ALLOWED)) throw new CliError('UNKNOWN_COMMAND', `Unknown command "${command}".`, `Use one of: ${Object.keys(ALLOWED).join(', ')}. Run \`${CLI} help\`.`);
    const unknown = Object.keys(flags).filter(flag => !ALLOWED[command].includes(flag));
    if (unknown.length) throw new CliError('UNKNOWN_OPTION', `${command} does not accept --${unknown.join(', --')}.`, `Run \`${CLI} ${command} --help\` for its options.`);
    const result = command === 'up' ? await up(flags) : command === 'doctor' ? await doctor() : command === 'features' ? features()
      : command === 'drive' ? drive(args) : command === 'sql' ? await sql(args, flags) : command === 'status' ? status() : await down(flags);
    process.stdout.write(`${JSON.stringify({ ok: true, ...result }, null, 2)}\n`);
  } catch (error) {
    const body = error instanceof CliError
      ? { code: error.code, message: error.message, fix: error.fix, ...(error.details ? { details: error.details } : {}) }
      : { code: 'INTERNAL', message: error instanceof Error ? error.message : String(error), fix: 'Unexpected failure in k5-verify; run `status`, then read the instance log it names.' };
    process.stdout.write(`${JSON.stringify({ ok: false, error: body }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
