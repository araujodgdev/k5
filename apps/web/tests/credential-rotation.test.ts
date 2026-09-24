import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { postgresFixture } from './postgres-fixture';
import { postgresTransaction } from '../src/lib/db/postgres';
import { countSecretsNeedingReencryption } from '../src/lib/ai-connections-core';
import { credentialRotationStatus, CredentialRotationError, rotateCredentials } from '../src/lib/credential-rotation';
import { createCredentialKeyring, decryptCredential, encryptCredential, parseCredentialKeyring } from '../src/lib/platform-crypto';

async function fixture() {
  const f = await postgresFixture();
  const old = randomBytes(32), next = randomBytes(32), actor = randomUUID(), office = randomUUID();
  const connection = randomUUID();
  const ring = createCredentialKeyring(next, [old]);
  const secret = 'synthetic-private-credential-do-not-log';
  const cipher = encryptCredential(secret, old);
  const expected = [{ table: 'ai_connection', field: 'encrypted_api_key', plaintext: secret }];
  const encrypted = (table: string, field: string) => {
    const plaintext = `${secret}:${table}.${field}`;
    expected.push({ table, field, plaintext });
    return encryptCredential(plaintext, old);
  };
  const insert = async (table: string, row: Record<string, string | number>) => {
    await f.db.prepare(`INSERT INTO "${table}" (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`).run(...Object.values(row));
  };
  await insert('user', { id: actor, email: 'rotation@example.test', name: 'Rotation' });
  await insert('office', { id: office, name: 'Rotation test' });
  await insert('office_member', { id: randomUUID(), office_id: office, user_id: actor, role: 'administrator' });
  await insert('platform_admin', { user_id: actor });
  await insert('ai_connection', { id: randomUUID(), office_id: office, name: 'Test AI', provider: 'openai', api_key_hint: 'hidden', encrypted_api_key: cipher });
  await insert('typesafe_connection', { office_id: office, encrypted_api_key: encrypted('typesafe_connection', 'encrypted_api_key') });
  await f.db.prepare('INSERT INTO typesafe_platform_connection(id,encrypted_api_key) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET encrypted_api_key=EXCLUDED.encrypted_api_key').run(encrypted('typesafe_platform_connection', 'encrypted_api_key'));
  await insert('platform_secret_ref', { id: randomUUID(), user_id: actor, purpose: 'ai_connection_key', encrypted_secret: encrypted('platform_secret_ref', 'encrypted_secret'), secret_hint: 'hidden', expires_at: Date.now() + 60_000 });
  await insert('platform_secret_ref', { id: randomUUID(), user_id: actor, purpose: 'ai_connection_key', encrypted_secret: '', secret_hint: 'hidden', expires_at: Date.now() - 60_000 });
  await insert('push_subscription', { id: randomUUID(), office_id: office, user_id: actor, device_id: 'device-test', endpoint_hash: 'endpoint-test', encrypted_subscription: encrypted('push_subscription', 'encrypted_subscription'), vapid_key_id: 'vapid-test', auth_generation: 1, subscribed_at: new Date().toISOString(), last_reconciled_at: new Date().toISOString() });
  await insert('google_connection', { id: connection, office_id: office, user_id: actor, google_subject: 'synthetic', email: 'google@example.test', status: 'active', encrypted_refresh_token: encrypted('google_connection', 'encrypted_refresh_token'), encrypted_access_token: encrypted('google_connection', 'encrypted_access_token') });
  await f.db.prepare("INSERT INTO google_oauth_state(id,state_hash,office_id,user_id,session_id,encrypted_verifier,modules,scopes,expires_at) VALUES(?,?,?,?,?,?,ARRAY['gmail'],ARRAY['email'],CURRENT_TIMESTAMP+INTERVAL '1 minute')")
    .run(randomUUID(), randomUUID(), office, actor, randomUUID(), encrypted('google_oauth_state', 'encrypted_verifier'));
  await insert('google_operation', { id: randomUUID(), office_id: office, user_id: actor, connection_id: connection, action: 'test', capability_name: 'test', invocation: 'ui', idempotency_key: randomUUID(), request_hash: 'synthetic', encrypted_args: encrypted('google_operation', 'encrypted_args'), encrypted_result: encrypted('google_operation', 'encrypted_result'), checkpoint_json: encrypted('google_operation', 'checkpoint_json'), policy_version: 1, policy_mode: 'automatic', status: 'pending', usage_day: '2026-09-24' });
  return { ...f, old, next, ring, actor, secret, cipher, expected };
}

test('two-phase keyring reads old data, writes the staged key and supports promotion without exporting the old key', () => {
  const old = randomBytes(32).toString('base64'), next = randomBytes(32).toString('base64');
  const previous = randomBytes(32).toString('base64');
  const ring = parseCredentialKeyring(old, previous, next);
  assert.equal(decryptCredential(encryptCredential('old', Buffer.from(old, 'base64')), ring), 'old');
  assert.equal(decryptCredential(encryptCredential('previous', Buffer.from(previous, 'base64')), ring), 'previous');
  const written = encryptCredential('new', ring);
  assert.equal(decryptCredential(written, Buffer.from(next, 'base64')), 'new');
  assert.equal(decryptCredential(written, parseCredentialKeyring('', old, next)), 'new');
  assert.equal(decryptCredential(written, parseCredentialKeyring(next, old, '')), 'new');
  assert.equal(parseCredentialKeyring(old, '', '').current.key.toString('base64'), old);
  assert.throws(() => parseCredentialKeyring(old, '', 'malformed'));
});

test('rotation covers every encrypted column atomically, preserves empty references and is idempotent', async () => {
  const { db, pool, ring, actor, next, secret, cipher, expected } = await fixture();
  await db.prepare("INSERT INTO ai_connection(id,name,provider,encrypted_api_key,api_key_hint,deleted_at) VALUES(?,'Removed','openai',NULL,'hidden',CURRENT_TIMESTAMP)").run(randomUUID());
  assert.deepEqual(await credentialRotationStatus(db, ring), { keyId: ring.current.id, total: 11, pending: 11, unreadable: 0 });
  assert.equal(await countSecretsNeedingReencryption(db, ring), 3);
  assert.equal((await db.prepare('SELECT encrypted_api_key FROM ai_connection WHERE deleted_at IS NULL').get<{ encrypted_api_key: string }>())?.encrypted_api_key, cipher);
  const result = await postgresTransaction(pool, tx => rotateCredentials(tx, ring, actor, ring.current.id));
  assert.equal(result.reencrypted, 11);
  const current = createCredentialKeyring(next);
  for (const { table, field, plaintext } of expected) {
    // Fixture-owned identifiers and distinct sentinels catch swaps between encrypted columns.
    const rows = await db.prepare(`SELECT ${field} AS cipher FROM ${table} WHERE ${field} IS NOT NULL AND ${field} <> ''`)
      .all<{ cipher: string }>();
    assert.equal(rows.length, 1, `${table}.${field} remains present`);
    assert.equal(decryptCredential(rows[0].cipher, current), plaintext, `${table}.${field} preserves its own plaintext`);
  }
  assert.deepEqual(await credentialRotationStatus(db, current), { keyId: ring.current.id, total: 11, pending: 0, unreadable: 0 });
  assert.equal(await countSecretsNeedingReencryption(db, current), 0);
  const updated = await db.prepare('SELECT encrypted_api_key FROM ai_connection WHERE deleted_at IS NULL').get<{ encrypted_api_key: string }>();
  assert.equal(decryptCredential(updated!.encrypted_api_key, current), secret);
  assert.equal((await db.prepare("SELECT count(*) AS count FROM platform_secret_ref WHERE encrypted_secret=''").get<{ count: number }>())?.count, 1);
  assert.equal((await postgresTransaction(pool, tx => rotateCredentials(tx, ring, actor, ring.current.id))).reencrypted, 0);
  const audit = await db.prepare('SELECT * FROM platform_audit_log').all();
  assert.equal(audit.length, 1);
  assert.ok(!JSON.stringify(audit).includes(secret));
});

test('an unreadable final table rolls back earlier changes and audit, including damaged current-key payloads', async () => {
  const { db, pool, ring, actor, cipher } = await fixture();
  const damaged = JSON.parse(encryptCredential('synthetic', ring));
  damaged.tag = randomBytes(16).toString('base64');
  await db.prepare('UPDATE typesafe_platform_connection SET encrypted_api_key=?').run(JSON.stringify(damaged));
  assert.equal((await credentialRotationStatus(db, ring)).unreadable, 1);
  await assert.rejects(postgresTransaction(pool, tx => rotateCredentials(tx, ring, actor, ring.current.id)), CredentialRotationError);
  assert.equal((await db.prepare('SELECT encrypted_api_key FROM ai_connection').get<{ encrypted_api_key: string }>())?.encrypted_api_key, cipher);
  assert.equal((await db.prepare('SELECT count(*) AS count FROM platform_audit_log').get<{ count: number }>())?.count, 0);
  await assert.rejects(postgresTransaction(pool, tx => rotateCredentials(tx, ring, randomUUID(), ring.current.id)), /restrito/);
  await assert.rejects(postgresTransaction(pool, tx => rotateCredentials(tx, ring, actor, '0000000000000000')), /mudou/);
});

test('real route requires a live platform session, same origin and the reviewed target key', async () => {
  const req = createRequire(import.meta.url), serverOnly = req.resolve('server-only');
  req.cache[serverOnly] = { id: serverOnly, filename: serverOnly, loaded: true, exports: {} } as NodeJS.Module;
  process.env.BETTER_AUTH_SECRET = randomBytes(48).toString('base64url');
  process.env.BETTER_AUTH_URL = 'http://localhost:3000';
  process.env.K5_CREDENTIALS_KEY = randomBytes(32).toString('base64');
  delete process.env.K5_CREDENTIALS_NEXT_KEY;
  const { db, pool } = await postgresFixture({ seedDefaults: false });
  // Route imports use the same process-wide Node backend, with an isolated fixture pool.
  const backend = globalThis as typeof globalThis & { k5Postgres?: { database: typeof db; store: typeof pool } };
  const saved = backend.k5Postgres;
  backend.k5Postgres = { database: db, store: pool };
  try {
    const { auth } = await import('../src/lib/auth');
    assert.equal(await auth.api.getSession({ headers: new Headers() }), null);
    const { GET, POST } = await import('../src/app/api/platform/credentials/route');
    const origin = 'http://localhost:3000', url = origin + '/api/platform/credentials';
    assert.equal((await GET(new Request(url))).status, 401);
    const signup = await auth.handler(new Request(origin + '/api/auth/sign-up/email', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Rotation', officeName: 'Test', email: 'route@example.test', password: 'Synthetic-Password-2026!' }) }));
    assert.equal(signup.status, 200);
    const cookie = signup.headers.getSetCookie().map(v => v.split(';')[0]).join('; ');
    const user = (await signup.json()).user;
    const get = () => GET(new Request(url, { headers: { cookie } }));
    const post = (body: unknown, requestOrigin = origin) => POST(new Request(url, { method: 'POST', headers: { cookie, origin: requestOrigin, 'content-type': 'application/json' }, body: JSON.stringify(body) }));
    assert.equal((await get()).status, 403);
    await db.prepare('INSERT INTO platform_admin(user_id) VALUES(?)').run(user.id);
    const before = await get();
    assert.equal(before.headers.get('cache-control'), 'private, no-store');
    assert.equal((await before.json()).enabled, false);
    assert.equal((await post({})).status, 409);
    process.env.K5_CREDENTIALS_NEXT_KEY = randomBytes(32).toString('base64');
    try {
      const body = { expectedKeyId: parseCredentialKeyring().current.id, runtimesReady: true };
      assert.equal((await post(body, 'https://untrusted.example')).status, 403);
      assert.equal((await post(body, 'http://admin.localhost:3000')).status, 403);
      assert.equal((await post(body, 'not a url')).status, 403);
      assert.equal((await post({ ...body, expectedKeyId: '0000000000000000' })).status, 409);
      assert.equal((await post({ ...body, runtimesReady: false })).status, 400);
      assert.equal((await post({ ...body, actorUserId: 'forged' })).status, 400);
      assert.equal((await post(body)).status, 200);
      await db.prepare('DELETE FROM platform_admin WHERE user_id=?').run(user.id);
      assert.equal((await post(body)).status, 403);
      await db.prepare('DELETE FROM session WHERE userId=?').run(user.id);
      assert.equal((await get()).status, 401);
    } finally { delete process.env.K5_CREDENTIALS_NEXT_KEY; }
  } finally { backend.k5Postgres = saved; }
});
