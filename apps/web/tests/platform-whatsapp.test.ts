import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { postgresFixture } from './postgres-fixture';
import { withPostgres } from '../src/lib/database';
import { grantPlatformAdmin, PlatformRequestError } from '../src/lib/platform-core';
import { platformWhatsAppStatus, setPlatformWhatsApp } from '../src/lib/platform-whatsapp';
import { withWhatsAppEnvironment } from '../src/lib/whatsapp/environment';
import { withWhatsAppTransport } from '../src/lib/whatsapp/transport';

async function fixture() {
  const { db, pool } = await postgresFixture();
  const actor = randomUUID(), outsider = randomUUID(), a = randomUUID(), b = randomUUID();
  await db.prepare('INSERT INTO "user"(id,email,name) VALUES(?,?,?),(?,?,?)')
    .run(actor, `${actor}@example.test`, 'Admin', outsider, `${outsider}@example.test`, 'Pessoa');
  await db.prepare('INSERT INTO office(id,name) VALUES(?,?),(?,?)').run(a, 'Alfa', b, 'Beta');
  await db.prepare('INSERT INTO office_member(id,office_id,user_id) VALUES(?,?,?)').run(randomUUID(), a, outsider);
  await grantPlatformAdmin(db, actor);
  type Rule = { priority: number; conditions: { attribute: string; operator: string; value: string }[]; serve_variation: string };
  let flag = { key: 'whatsapp-integration', enabled: true, default_variation: 'off', variations: { on: true, off: false },
    description: 'Preservar descrição', rules: [{ priority: 8, conditions: [{ attribute: 'office_id', operator: 'equals', value: b }], serve_variation: 'on' }] as Rule[] };
  let calls = 0, writes = 0;
  let unavailable = false;
  const run = <T>(action: () => T) => withPostgres(pool, () => withWhatsAppEnvironment({
    CLOUDFLARE_ACCOUNT_ID: 'account', FLAGSHIP_APP_ID: 'app', FLAGSHIP_MANAGE_TOKEN: 'private-token',
  }, () => withWhatsAppTransport(async (input, init) => {
    calls++;
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer private-token');
    if (unavailable) return new Response('provider failure', { status: 503 });
    if (init?.method === 'PUT') { writes++; flag = JSON.parse(String(init.body)); }
    if (String(input).includes('/evaluate?')) {
      const officeId = new URL(input).searchParams.get('office_id');
      const match = flag.rules.find(rule => rule.conditions[0]?.value === officeId);
      const selected = flag.enabled && match ? match.serve_variation : flag.default_variation;
      return Response.json({ flagKey: flag.key, value: selected === 'on' });
    }
    return Response.json({ success: true, result: flag });
  }, action)));
  return { db, actor, outsider, a, b, run, get flag() { return flag; }, get calls() { return calls; }, get writes() { return writes; }, fail() { unavailable = true; } };
}

test('platform admin toggles one office, preserves other offices, and records audit', async () => {
  const f = await fixture();
  await f.run(async () => {
    const before = await platformWhatsAppStatus(f.actor, f.a);
    assert.equal(before.enabled, false);
    await setPlatformWhatsApp(f.actor, f.a, true, before.revision);
    const after = await platformWhatsAppStatus(f.actor, f.a);
    assert.equal(after.enabled, true);
    assert.equal((await platformWhatsAppStatus(f.actor, f.b)).enabled, true);
    await setPlatformWhatsApp(f.actor, f.a, false, after.revision);
    assert.equal((await platformWhatsAppStatus(f.actor, f.a)).enabled, false);
    assert.equal((await platformWhatsAppStatus(f.actor, f.b)).enabled, true);
    assert.equal(f.flag.rules.length, 2);
    assert.equal(f.flag.description, 'Preservar descrição');
    const audit = await f.db.prepare('SELECT action,details_json FROM platform_audit_log WHERE office_id=? ORDER BY created_at').all<{ action: string; details_json: string }>(f.a);
    assert.equal(audit.length, 2);
    assert.equal(audit[0].action, 'whatsapp.rollout.updated');
    assert.equal(JSON.stringify(audit).includes('private-token'), false);
  });
});

test('office administrator and missing office cannot read or change rollout', async () => {
  const f = await fixture();
  await f.run(async () => {
    await assert.rejects(() => platformWhatsAppStatus(f.outsider, f.a), (e: unknown) => e instanceof PlatformRequestError && e.status === 403);
    await assert.rejects(() => setPlatformWhatsApp(f.outsider, f.a, true, 'revision'), (e: unknown) => e instanceof PlatformRequestError && e.status === 403);
    await assert.rejects(() => setPlatformWhatsApp(f.actor, 'missing', true, 'revision'), (e: unknown) => e instanceof PlatformRequestError && e.status === 404);
    assert.equal(f.calls, 0);
  });
});

test('concurrent changes cannot overwrite a newer rule and global pause remains in force', async () => {
  const f = await fixture();
  await f.run(async () => {
    const before = await platformWhatsAppStatus(f.actor, f.a);
    const results = await Promise.allSettled([
      setPlatformWhatsApp(f.actor, f.a, true, before.revision),
      setPlatformWhatsApp(f.actor, f.b, false, before.revision),
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(f.writes, 1);
    f.flag.enabled = false;
    const paused = await platformWhatsAppStatus(f.actor, f.a);
    assert.equal(paused.globalEnabled, false);
    await assert.rejects(() => setPlatformWhatsApp(f.actor, f.a, true, paused.revision), /pausado/);
    assert.equal(f.writes, 1);
  });
});

test('provider failures are shown as unavailable rather than disabled', async () => {
  const f = await fixture();
  f.fail();
  await f.run(async () => {
    await assert.rejects(() => platformWhatsAppStatus(f.actor, f.a), (e: unknown) => e instanceof PlatformRequestError && e.status === 502 && !e.message.includes('private-token'));
  });
});
