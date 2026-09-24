import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPreviewConfig, previewName, validateDatabaseUrl, validateProfile, type PreviewProfile } from '../scripts/preview-config';

const profile: PreviewProfile = {
  name: 'example', accountId: 'a'.repeat(32), workerName: 'k5-staging', subdomain: 'k5-web',
  databaseBranch: 'k5-preview-example', databaseBranchId: 'preview123', databaseHost: 'aws-sa-east-1-1.pg.psdb.cloud',
  hyperdriveId: 'b'.repeat(32), bucket: 'k5-preview-example-vault', vectorIndex: 'k5-preview-example-knowledge',
};

test('preview migration rejects a main-branch role, unsafe TLS and connection overrides', () => {
  const valid = `postgresql://role.preview123:password@${profile.databaseHost}/postgres?sslmode=verify-full`;
  validateDatabaseUrl(valid, profile);
  for (const url of [valid.replace('preview123', 'main123'), valid.replace('verify-full', 'require'), `${valid}&options=-c%20search_path=public`, valid.replace('/postgres?', '/other?')]) {
    assert.throws(() => validateDatabaseUrl(url, profile), /Conexão recusada/);
  }
});

test('preview profiles cannot silently point to shared staging storage', () => {
  validateProfile(profile, 'example');
  for (const override of [{ bucket: 'k5-vault-staging' }, { vectorIndex: 'k5-knowledge-staging' }, { databaseBranch: 'main' }]) {
    assert.throws(() => validateProfile({ ...profile, ...override }, 'example'), /exclusivamente/);
  }
});

test('preview build has isolated HTTP bindings and no background or cross-Worker bindings', () => {
  const config = buildPreviewConfig(profile, process.cwd());
  assert.equal(config.previews.hyperdrive[0].id, profile.hyperdriveId);
  assert.equal(config.previews.vars.PROCESSORS_ENABLED, 'false');
  assert.match(config.previews.vars.BETTER_AUTH_URL, /^https:\/\/example-k5-staging\./);
  for (const key of ['containers', 'durable_objects', 'triggers', 'queues', 'services', 'workflows']) {
    assert.equal(key in config, false);
    assert.equal(key in config.previews, false);
  }
  assert.deepEqual(config.secrets.required, ['BETTER_AUTH_SECRET', 'K5_CREDENTIALS_KEY']);
});

test('branch-derived names are stable, collision resistant and safe for paths', () => {
  assert.equal(previewName('codex/test'), previewName('codex/test'));
  assert.notEqual(previewName('codex/test'), previewName('codex-test'));
  assert.throws(() => previewName('main'), /explicitamente/);
  for (const name of ['../main', 'a;whoami', 'UPPER', '-invalid']) assert.throws(() => previewName('', name));
  assert.equal(previewName('main', 'refactor'), 'refactor');
});
