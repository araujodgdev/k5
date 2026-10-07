import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const pointer = JSON.parse(readFileSync(join(tmpdir(), 'lume-verify-current.json'), 'utf8'));
const state = JSON.parse(readFileSync(join(pointer.runDir, 'state.json'), 'utf8'));
assert.equal(state.runId, '20261006T234247-d88728'); assert.equal(state.port, 62541); assert.equal(state.pgPort, 62542);
const inventory = JSON.parse(readFileSync(join(root, '.audit/lume-provenance-files.json'), 'utf8')).repair;
const files = [...inventory.production, ...inventory.testsAndBrowser, ...inventory.additiveMigrations] as string[];
assert.equal(new Set(files).size, files.length);
const digest = (text: string) => createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');
const hashes = files.map(path => ({ path, sha256: digest(readFileSync(join(root, 'apps/web', path), 'utf8')) }));
const require = createRequire(join(root, 'apps/web/package.json'));
const client = new (require('pg').Client)({ connectionString: state.databaseUrl });
await client.connect();
let database;
try {
  await client.query('BEGIN READ ONLY');
  const migrations = (await client.query('SELECT name,checksum FROM postgres_migration WHERE name=ANY($1) ORDER BY name', [inventory.additiveMigrations.map((path: string) => path.split('/').at(-1))])).rows;
  for (const migration of migrations) assert.equal(migration.checksum, digest(readFileSync(join(root, 'apps/web/db/postgres', migration.name), 'utf8')));
  assert.equal(migrations.length, inventory.additiveMigrations.length);
  const schemas = (await client.query("SELECT nspname FROM pg_namespace WHERE nspname LIKE 'k5_test_%' ORDER BY nspname")).rows;
  const compatibilityTriggers = (await client.query("SELECT tgname FROM pg_trigger WHERE tgname='capture_upgrade_preserve_approval'")).rows;
  assert.equal(schemas.length, 0); assert.equal(compatibilityTriggers.length, 0);
  await client.query('COMMIT'); database = { migrations, schemas, compatibilityTriggers };
} finally { await client.end(); }
const runs = readdirSync(state.evidenceDir).filter((name: string) => /^source-(test|e2e|migrate)-/.test(name)).map((directory: string) => {
  const path = join(state.evidenceDir, directory);
  if (directory.startsWith('source-test-')) {
    if (!existsSync(join(path, 'output.log'))) return { directory, incomplete: true };
    const log = readFileSync(join(path, 'output.log'), 'utf8');
    const number = (key: string) => Number(log.match(new RegExp(`ℹ ${key} (\\d+)`))?.[1]);
    const tests = number('tests');
    return Number.isFinite(tests) ? { directory, tests, passed: number('pass'), failed: number('fail') } : { directory, incomplete: true };
  }
  if (directory.startsWith('source-e2e-')) {
    try { const report = JSON.parse(readFileSync(join(path, 'report.json'), 'utf8')); return { directory, status: report.run.status, exitCode: report.run.exitCode,
      passed: report.run.results.filter((result: {status: string}) => result.status === 'passed').length,
      failed: report.run.results.filter((result: {status: string}) => result.status === 'failed').length,
      executed: report.run.results.filter((result: {status: string}) => result.status === 'passed' || result.status === 'failed').length,
      catalogResults: report.run.results.length }; }
    catch { return { directory, incomplete: true }; }
  }
  return { directory };
});
const output = join(state.evidenceDir, `source-repair-manifest-${Date.now()}`); mkdirSync(output);
copyFileSync(join(pointer.runDir, 'instance.log'), join(output, 'instance.log'));
const video = join(state.evidenceDir, 'source-repair-preview-1791348900115/proposal-continuation.mp4');
writeFileSync(join(output, 'manifest.json'), JSON.stringify({ runId: state.runId, ports: [state.port, state.pgPort], files: hashes, database, runs,
  video: { path: video, bytes: statSync(video).size, limit: 'Arranged chat card; actual UI selection/clear; no live model' } }, null, 2));
console.log(JSON.stringify({ output, files: hashes.length, migrations: database.migrations.length, fixtureSchemas: database.schemas.length, runs: runs.slice(-5) }));
