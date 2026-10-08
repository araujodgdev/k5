import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createPostgresPool } from '../src/lib/db/postgres';

const available = (binary: string) => spawnSync(binary, ['--version'], { stdio: 'ignore' }).status === 0;

function run(binary: string, args: string[], env = process.env, allowFailure = false, cwd = process.cwd()) {
  return new Promise<{ stdout: string; stderr: string; code: number }>((resolve, reject) => {
    const child = spawn(binary, args, { env, cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on('error', () => reject(new Error(`Could not run backup verification tool: ${binary}`)));
    child.on('exit', code => {
      if (code !== 0 && !allowFailure) reject(new Error(`Backup verification tool failed: ${binary}`));
      else resolve({ stdout, stderr, code: code ?? 1 });
    });
  });
}

test('encrypted database backup restores exactly and a failed encryption leaves no partial artifact', {
  skip: process.platform === 'win32' || !['age', 'age-keygen', 'pg_dump', 'pg_restore'].every(available)
    ? 'Requires age and the PostgreSQL 18 client; the Security workflow installs both.' : false,
}, async () => {
  assert.ok(process.env.TEST_DATABASE_URL);
  const admin = createPostgresPool(process.env.TEST_DATABASE_URL);
  const suffix = randomUUID().replaceAll('-', '');
  const sourceName = `backup_source_${suffix}`, restoredName = `backup_restored_${suffix}`;
  const directory = await mkdtemp(join(tmpdir(), 'lume-backup-test-'));
  const key = join(directory, 'identity.age'), artifacts = join(directory, 'artifacts');
  const sourceURL = new URL(process.env.TEST_DATABASE_URL);
  sourceURL.pathname = `/${sourceName}`;
  const restoredURL = new URL(sourceURL);
  restoredURL.pathname = `/${restoredName}`;
  const source = createPostgresPool(sourceURL.toString()), restored = createPostgresPool(restoredURL.toString());
  try {
    // Names are generated identifiers, never request input. Both databases belong only to this test.
    await admin.query(`CREATE DATABASE "${sourceName}"`);
    await admin.query(`CREATE DATABASE "${restoredName}"`);
    await source.query('CREATE TABLE backup_probe (id text PRIMARY KEY, payload text NOT NULL)');
    const payload = 'private-backup-fixture-with-unicode-ação';
    await source.query('INSERT INTO backup_probe VALUES ($1, $2)', ['fixture', payload]);
    await run('age-keygen', ['-o', key]);
    const recipient = (await run('age-keygen', ['-y', key])).stdout.trim();
    const env = { ...process.env, DATABASE_URL_UNPOOLED: sourceURL.toString(), K5_BACKUP_AGE_RECIPIENT: recipient, K5_BACKUP_DIR: artifacts };
    await run('bash', ['scripts/backup-database.sh'], env);
    const files = await readdir(artifacts);
    assert.equal(files.length, 2);
    const encryptedName = files.find(name => name.endsWith('.dump.age'));
    assert.ok(encryptedName);
    const encrypted = join(artifacts, encryptedName);
    assert.equal((await readFile(encrypted)).includes(Buffer.from(payload)), false);
    await run('sha256sum', ['--check', `${encryptedName}.sha256`], process.env, false, artifacts);

    const failed = await run('bash', ['scripts/backup-database.sh'], { ...env, K5_BACKUP_AGE_RECIPIENT: 'invalid-recipient' }, true);
    assert.notEqual(failed.code, 0);
    assert.deepEqual((await readdir(artifacts)).sort(), files.sort());
    if (sourceURL.password) assert.equal(failed.stderr.includes(sourceURL.password), false);

    const remote = new URL(sourceURL);
    remote.hostname = 'database.invalid';
    remote.searchParams.set('sslmode', 'disable');
    const insecure = await run('bash', ['scripts/backup-database.sh'], { ...env, DATABASE_URL_UNPOOLED: remote.toString() }, true);
    assert.notEqual(insecure.code, 0);
    assert.deepEqual((await readdir(artifacts)).sort(), files.sort());

    const dump = join(directory, 'restore.dump');
    await run('age', ['--decrypt', '--identity', key, '--output', dump, encrypted]);
    await run('pg_restore', ['--exit-on-error', '--no-owner', '--no-acl', '--dbname', restoredName, dump], {
      ...process.env, PGHOST: sourceURL.hostname, PGPORT: sourceURL.port || '5432', PGUSER: decodeURIComponent(sourceURL.username),
      PGPASSWORD: decodeURIComponent(sourceURL.password), PGDATABASE: restoredName, PGSSLMODE: sourceURL.searchParams.get('sslmode') ?? 'prefer',
    });
    assert.deepEqual((await restored.query('SELECT id, payload FROM backup_probe')).rows, [{ id: 'fixture', payload }]);
  } finally {
    await Promise.all([source.end(), restored.end()]);
    await admin.query(`DROP DATABASE IF EXISTS "${sourceName}"`);
    await admin.query(`DROP DATABASE IF EXISTS "${restoredName}"`);
    await admin.end();
    await rm(directory, { recursive: true, force: true });
  }
});
