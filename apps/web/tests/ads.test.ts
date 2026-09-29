import { testDb } from './test-setup';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { WorkspaceContext } from '../src/lib/application/context';
import { withAdsEnvironment } from '../src/lib/ads/environment';
import { isAdsEnabled } from '../src/lib/ads/rollout';
import { withAdsTransport, verifyAdsAccount } from '../src/lib/ads/provider';
import { connectAds, disconnectAds, getAdsStatus, refreshAds } from '../src/lib/ads/service';
import { decryptCredential, parseCredentialKeyring } from '../src/lib/platform-crypto';

async function fixture(role: WorkspaceContext['role'] = 'administrator') {
  const officeId = randomUUID(), userId = randomUUID(), sessionId = randomUUID();
  await testDb.prepare('INSERT INTO office(id,name) VALUES(?,?)').run(officeId, 'Anúncios sintéticos');
  await testDb.prepare('INSERT INTO "user"(id,email,name) VALUES(?,?,?)').run(userId, `${userId}@ads.test`, 'Pessoa sintética');
  await testDb.prepare('INSERT INTO office_member(id,office_id,user_id,role) VALUES(?,?,?,?)').run(randomUUID(), officeId, userId, role);
  await testDb.prepare('INSERT INTO session(id,userId,token,expiresAt,createdAt,updatedAt) VALUES(?,?,?,CURRENT_TIMESTAMP+INTERVAL \'1 day\',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)')
    .run(sessionId, userId, randomUUID());
  return { officeId, userId, role, sessionId } satisfies WorkspaceContext;
}
const account = (id = randomUUID()) => ({ id: `adacct_${id}`, name: 'Conta sintética', currency_code: 'USD', timezone: 'UTC', status: 'active', review: { status: 'pending' } });
function enabled<T>(action: () => T, value = true) {
  return withAdsEnvironment({ K5_CREDENTIALS_KEY: process.env.K5_CREDENTIALS_KEY, FLAGS: { getBooleanValue: async () => value } }, action);
}

test('Ads flag targets the authenticated user and office, independently of WhatsApp', async () => {
  const results = await withAdsEnvironment({ FLAGS: { async getBooleanValue(key, fallback, context) {
    assert.equal(key, 'chatgpt-ads'); assert.equal(fallback, false);
    assert.equal(context.targetingKey, `${context.office_id}:${context.user_id}`);
    return context.office_id === 'office-a' && context.user_id === 'user-a' && context.role === 'administrator';
  } } }, () => Promise.all([
    isAdsEnabled({ officeId: 'office-a', userId: 'user-a', role: 'administrator' }),
    isAdsEnabled({ officeId: 'office-a', userId: 'user-b', role: 'administrator' }),
    isAdsEnabled({ officeId: 'office-b', userId: 'user-a', role: 'administrator' }),
  ]));
  assert.deepEqual(results, [true, false, false]);
  assert.equal(await withAdsEnvironment({}, () => isAdsEnabled({ officeId: 'a', userId: 'b', role: 'administrator' })), false);
});

test('Ads onboarding stores encrypted credentials, scopes accounts, refreshes and disconnects with audit', async () => enabled(async () => {
  const first = await fixture(), second = await fixture(), remote = account();
  let calls = 0;
  await withAdsTransport(async (url, init) => {
    calls++; assert.equal(String(url), 'https://api.ads.openai.com/v1/ad_account');
    assert.equal(init?.redirect, 'manual'); assert.equal(init?.cache, 'no-store');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer synthetic-ads-key');
    return Response.json({ ...remote, unrelated_secret: 'never-return-this' });
  }, async () => {
    const saved = await connectAds(first, { apiKey: 'synthetic-ads-key', expectedVersion: null });
    assert.equal(saved.connection?.account.id, remote.id);
    assert.equal(saved.connection?.account.review?.status, 'pending');
    assert.equal(JSON.stringify(saved).includes('synthetic-ads-key'), false);
    assert.equal(JSON.stringify(saved).includes('unrelated_secret'), false);
    const stored = await testDb.prepare('SELECT encrypted_api_key FROM ads_connection WHERE office_id=?').get<{ encrypted_api_key: string }>(first.officeId);
    assert.ok(stored); assert.notEqual(stored.encrypted_api_key, 'synthetic-ads-key');
    assert.equal(decryptCredential(stored.encrypted_api_key, parseCredentialKeyring()), 'synthetic-ads-key');
    assert.equal((await getAdsStatus(second)).connection, null);
    await assert.rejects(() => connectAds(second, { apiKey: 'synthetic-ads-key', expectedVersion: null }), { code: 'CONFLICT' });
    const refreshed = await refreshAds(first, { expectedVersion: saved.connection?.version });
    assert.notEqual(refreshed.connection?.version, saved.connection?.version);
    await assert.rejects(() => disconnectAds(first, { expectedVersion: saved.connection?.version }), { code: 'CONFLICT' });
    assert.equal((await disconnectAds(first, { expectedVersion: refreshed.connection?.version })).connection, null);
    assert.equal(calls, 3);
    const history = await testDb.prepare('SELECT action FROM ads_connection_audit WHERE office_id=? ORDER BY created_at').all<{ action: string }>(first.officeId);
    assert.deepEqual(history.map(row => row.action), ['connected', 'verified', 'disconnected']);
  });
}));

test('Ads denies disabled flags, reviewers, removed memberships and revoked sessions before contacting OpenAI', async () => {
  const context = await fixture();
  await withAdsTransport(async () => { assert.fail('Unauthorized access contacted OpenAI'); }, async () => {
    await enabled(async () => {
      await assert.rejects(() => getAdsStatus(context), { code: 'NOT_FOUND' });
      await assert.rejects(() => connectAds(context, { apiKey: 'synthetic', expectedVersion: null }), { code: 'NOT_FOUND' });
    }, false);
    await enabled(async () => {
      const reviewer = await fixture('reviewer');
      assert.equal((await getAdsStatus(reviewer)).canManage, false);
      await assert.rejects(() => connectAds(reviewer, { apiKey: 'synthetic', expectedVersion: null }), { code: 'FORBIDDEN' });
      await testDb.prepare('DELETE FROM office_member WHERE office_id=?').run(reviewer.officeId);
      await assert.rejects(() => getAdsStatus(reviewer), { code: 'FORBIDDEN' });
      await testDb.prepare('DELETE FROM session WHERE id=?').run(context.sessionId);
      await assert.rejects(() => getAdsStatus(context), { code: 'UNAUTHENTICATED' });
    });
  });
});

test('Ads preserves the old key on verification failure and rejects late operations after reconnecting', async () => enabled(async () => {
  const context = await fixture(), remote = account();
  const saved = await withAdsTransport(async () => Response.json(remote), () => connectAds(context, { apiKey: 'old-key', expectedVersion: null }));
  await withAdsTransport(async () => new Response('private provider details', { status: 401 }), async () => {
    await assert.rejects(() => connectAds(context, { apiKey: 'bad-key', expectedVersion: saved.connection?.version }), { status: 422 });
  });
  assert.equal((await getAdsStatus(context)).connection?.version, saved.connection?.version);
  await disconnectAds(context, { expectedVersion: saved.connection?.version });
  const next = await withAdsTransport(async () => Response.json(remote), () => connectAds(context, { apiKey: 'next-key', expectedVersion: null }));
  await assert.rejects(() => disconnectAds(context, { expectedVersion: saved.connection?.version }), { code: 'CONFLICT' });
  assert.equal((await getAdsStatus(context)).connection?.version, next.connection?.version);
}));

test('Ads transport rejects redirects, invalid or oversized responses, and never exposes provider bodies', async () => {
  for (const response of [new Response('secret', { status: 302 }), new Response('secret', { status: 500 }),
    Response.json({ id: 'only-id' }), new Response('x'.repeat(65_537))]) {
    await withAdsTransport(async () => response, () => assert.rejects(() => verifyAdsAccount('synthetic'), error => {
      assert.ok(error instanceof Error); assert.equal(error.message.includes('secret'), false); return true;
    }));
  }
});

test('Ads revalidates access after OpenAI responds, before saving a credential', async () => enabled(async () => {
  const context = await fixture();
  await withAdsTransport(async () => {
    await testDb.prepare('DELETE FROM session WHERE id=?').run(context.sessionId);
    return Response.json(account());
  }, () => assert.rejects(() => connectAds(context, { apiKey: 'synthetic', expectedVersion: null }), { code: 'UNAUTHENTICATED' }));
  assert.equal(await testDb.prepare('SELECT office_id FROM ads_connection WHERE office_id=?').get(context.officeId), undefined);
}));

test('Ads never attaches one external account to two offices during concurrent onboarding', async () => enabled(async () => {
  const first = await fixture(), second = await fixture(), remote = account();
  const results = await withAdsTransport(async () => Response.json(remote), () => Promise.allSettled([
    connectAds(first, { apiKey: 'synthetic', expectedVersion: null }),
    connectAds(second, { apiKey: 'synthetic', expectedVersion: null }),
  ]));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = results.find(result => result.status === 'rejected');
  assert.ok(rejected && rejected.status === 'rejected');
  assert.equal(rejected.reason.code, 'CONFLICT');
}));

test('Ads verification has a bounded timeout even when the provider never responds', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let aborted = false;
  const request = withAdsTransport(async (_url, init) => {
    init?.signal?.addEventListener('abort', () => { aborted = true; });
    return new Promise<Response>(() => undefined);
  }, () => verifyAdsAccount('synthetic'));
  const result = assert.rejects(request, { status: 504 });
  t.mock.timers.tick(10_001);
  await result; assert.equal(aborted, true);
});
