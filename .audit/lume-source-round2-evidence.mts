import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const pointer = JSON.parse(readFileSync(join(tmpdir(), 'lume-verify-current.json'), 'utf8'));
const state = JSON.parse(readFileSync(join(pointer.runDir, 'state.json'), 'utf8'));
assert.equal(state.runId, '20261006T234247-d88728'); assert.equal(state.port, 62541); assert.equal(state.pgPort, 62542); assert.equal(state.status, 'ready');
const inventory = JSON.parse(readFileSync(join(root, '.audit/lume-provenance-files.json'), 'utf8')).round2;
const files = [...inventory.production, ...inventory.testsAndBrowser, ...inventory.additiveMigrations].map((path: string) => 'apps/web/' + path).concat(inventory.workspaceArtifacts);
assert.equal(new Set(files).size, files.length);
const digest = (text: string) => createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');
const hashes = files.map((path: string) => ({ path, sha256: digest(readFileSync(join(root, path), 'utf8')) }));
const freezePath = join(state.evidenceDir, 'source-round2-freeze.json');
if (process.argv[2] === 'freeze') {
  writeFileSync(freezePath, JSON.stringify({ createdAt: new Date().toISOString(), files: hashes }, null, 2));
  console.log(JSON.stringify({ freezePath, files: hashes.length }));
} else {
  const frozen = JSON.parse(readFileSync(freezePath, 'utf8'));
  assert.deepEqual(hashes, frozen.files, 'Frozen production, tests and verification helpers changed');
  const require = createRequire(join(root, 'apps/web/package.json'));
  const client = new (require('pg').Client)({ connectionString: state.databaseUrl }); await client.connect();
  let database;
  try {
    await client.query('BEGIN READ ONLY');
    const migrations = (await client.query("SELECT name,checksum FROM postgres_migration WHERE name ~ '^00(75|76|77|78|79|80|80a|81|82|83)_' ORDER BY name")).rows;
    assert.equal(migrations.length, 10);
    for (const migration of migrations) assert.equal(migration.checksum, digest(readFileSync(join(root, 'apps/web/db/postgres', migration.name), 'utf8')));
    const schemas = (await client.query("SELECT nspname FROM pg_namespace WHERE nspname LIKE 'k5_test_%' ORDER BY nspname")).rows;
    const compatibilityTriggers = (await client.query("SELECT tgname FROM pg_trigger WHERE tgname='capture_upgrade_preserve_approval'")).rows;
    assert.equal(schemas.length, 0); assert.equal(compatibilityTriggers.length, 0);
    await client.query('COMMIT'); database = { migrations, schemas, compatibilityTriggers };
  } finally { await client.end(); }
  const runs = readdirSync(state.evidenceDir).filter(name => /^source-(test|e2e|migrate)-/.test(name) && Number(name.split('-').at(-1)) >= 1791352050518).map(directory => {
    const path = join(state.evidenceDir, directory);
    if (directory.startsWith('source-test-')) {
      const log = readFileSync(join(path, 'output.log'), 'utf8');
      const number = (key: string) => Number(log.match(new RegExp(`ℹ ${key} (\\d+)`))?.[1]);
      return { directory, tests: number('tests'), passed: number('pass'), failed: number('fail') };
    }
    if (directory.startsWith('source-e2e-') && existsSync(join(path, 'report.json'))) {
      const report = JSON.parse(readFileSync(join(path, 'report.json'), 'utf8'));
      return { directory, status: report.run.status, passed: report.run.results.filter((r: { status: string }) => r.status === 'passed').length,
        failed: report.run.results.filter((r: { status: string }) => r.status === 'failed').length };
    }
    return { directory };
  });
  const output = join(state.evidenceDir, `source-round2-manifest-${Date.now()}`); mkdirSync(output);
  copyFileSync(join(pointer.runDir, 'instance.log'), join(output, 'instance.log'));
  writeFileSync(join(output, 'manifest.json'), JSON.stringify({ runId: state.runId, ports: [state.port, state.pgPort], frozenAt: frozen.createdAt, files: hashes, database, runs }, null, 2));
  console.log(JSON.stringify({ output, files: hashes.length, migrations: database.migrations.length, fixtureSchemas: database.schemas.length }));
}
