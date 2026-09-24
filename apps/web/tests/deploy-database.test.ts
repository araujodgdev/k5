import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import { postgresFixture } from './postgres-fixture';

async function runMigration(args: string[], runtimeUrl: string, adminUrl: string) {
  const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/migrate-postgres.ts', ...args], {
    cwd: process.cwd(), windowsHide: true,
    env: { ...process.env, K5_ENV_FILE: '.env.does-not-exist',
      PROCESSOR_DATABASE_URL: runtimeUrl, DATABASE_URL_UNPOOLED: adminUrl },
  });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  const status = await new Promise<number | null>((resolve, reject) => {
    child.on('error', reject); child.on('close', resolve);
  });
  return { status, output };
}

async function deploymentFixture() {
  const fixture = await postgresFixture();
  const { rows: [row] } = await fixture.pool.query<{ schema: string }>('SELECT current_schema() AS schema');
  const admin = new URL(process.env.TEST_DATABASE_URL!);
  admin.searchParams.set('options', `-c search_path=${row.schema}`);
  const runtime = new URL(admin);
  runtime.searchParams.set('options', `-c search_path=${row.schema} -c default_transaction_read_only=on`);
  const expired = new URL(admin);
  expired.password = 'expired-credential';
  return { ...fixture, admin: admin.href, runtime: runtime.href, expired: expired.href };
}

test('code-only deploy accepts the current schema through a read-only runtime connection despite expired admin credentials', async () => {
  const f = await deploymentFixture();
  const result = await runMigration(['--deploy'], f.runtime, f.expired);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /sem usar a credencial administrativa/);
});

test('deploy blocks pending migrations with expired admin credentials and gives a safe recovery instruction', async () => {
  const f = await deploymentFixture();
  await f.pool.query("DELETE FROM postgres_migration WHERE name = '0021_feedback_question.sql'");
  const result = await runMigration(['--deploy'], f.runtime, f.expired);
  assert.notEqual(result.status, 0);
  assert.match(result.output, /0021_feedback_question.sql/);
  assert.match(result.output, /DATABASE_URL_UNPOOLED/);
  assert.match(result.output, /28P01/);
  assert.ok(!result.output.includes('expired-credential'));
  assert.ok(!result.output.includes(f.expired));
});

test('read-only preflight refuses missing or changed migrations without applying them', async () => {
  const f = await deploymentFixture();
  await f.pool.query("DELETE FROM postgres_migration WHERE name = '0021_feedback_question.sql'");
  const missing = await runMigration(['--check'], f.runtime, f.admin);
  assert.notEqual(missing.status, 0, missing.output);
  assert.match(missing.output, /0021_feedback_question.sql/);
  assert.equal((await f.pool.query("SELECT count(*) FROM postgres_migration WHERE name = '0021_feedback_question.sql'")).rows[0].count, '0');
  await f.pool.query("UPDATE postgres_migration SET checksum = 'changed' WHERE name = '0001_initial.sql'");
  const changed = await runMigration(['--deploy'], f.runtime, f.admin);
  assert.notEqual(changed.status, 0, changed.output);
  assert.match(changed.output, /Applied migration changed: 0001_initial.sql/);
});

test('deploy applies pending migrations only with the admin connection', async () => {
  const f = await deploymentFixture();
  await f.pool.query("DELETE FROM postgres_migration WHERE name = '0021_feedback_question.sql'");
  const result = await runMigration(['--deploy'], f.runtime, f.admin);
  assert.equal(result.status, 0, result.output);
  assert.equal((await f.pool.query("SELECT count(*) FROM postgres_migration WHERE name = '0021_feedback_question.sql'")).rows[0].count, '1');
});

test('migration CLI rejects unknown flags instead of bypassing validation', async () => {
  const f = await deploymentFixture();
  const result = await runMigration(['--skip-migrations'], f.runtime, f.admin);
  assert.notEqual(result.status, 0);
  assert.match(result.output, /Argumento desconhecido/);
});
