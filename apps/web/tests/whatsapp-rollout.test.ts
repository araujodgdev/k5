import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withWhatsAppEnvironment } from '../src/lib/whatsapp/environment';
import { isWhatsAppEnabled } from '../src/lib/whatsapp/rollout';
import { withWhatsAppTransport } from '../src/lib/whatsapp/transport';

const restEnvironment = { CLOUDFLARE_ACCOUNT_ID: 'account', FLAGSHIP_APP_ID: 'app', FLAGSHIP_EVALUATE_TOKEN: 'evaluation-secret' };

test('Flagship binding evaluates each office with stable targeting and a false fallback', async () => {
  const results = await withWhatsAppEnvironment({ FLAGS: { async getBooleanValue(key, fallback, context) {
    assert.equal(key, 'whatsapp-integration');
    assert.equal(fallback, false);
    assert.equal(context.office_id, context.targetingKey);
    await Promise.resolve();
    return context.office_id === 'office-enabled';
  } } }, () => Promise.all([isWhatsAppEnabled('office-enabled'), isWhatsAppEnabled('office-disabled')]));
  assert.deepEqual(results, [true, false]);
});

test('Flagship REST reads a direct boolean response and keeps offices independent', async () => {
  const results = await withWhatsAppEnvironment(restEnvironment, () => withWhatsAppTransport(async (input, init) => {
    const url = new URL(input);
    assert.equal(url.origin + url.pathname, 'https://api.cloudflare.com/client/v4/accounts/account/flagship/apps/app/evaluate');
    assert.equal(url.searchParams.get('flagKey'), 'whatsapp-integration');
    assert.equal(url.searchParams.get('office_id'), url.searchParams.get('targetingKey'));
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer evaluation-secret');
    assert.equal(init?.redirect, 'manual');
    assert.equal(init?.cache, 'no-store');
    await Promise.resolve();
    return Response.json({ flagKey: 'whatsapp-integration', value: url.searchParams.get('office_id') === 'office-enabled' });
  }, () => Promise.all([isWhatsAppEnabled('office-enabled'), isWhatsAppEnabled('office-disabled')])));
  assert.deepEqual(results, [true, false]);
});

test('Flagship fails closed for missing config, unknown flags, invalid bodies and unavailable service', async () => {
  assert.equal(await withWhatsAppEnvironment({}, () => isWhatsAppEnabled('office')), false);
  for (const body of [
    { flagKey: 'whatsapp-integration', value: false }, { flagKey: 'whatsapp-integration', value: 'true' },
    { result: { flagKey: 'whatsapp-integration', value: true } }, { flagKey: 'different-flag', value: true },
  ]) {
    assert.equal(await withWhatsAppEnvironment(restEnvironment, () => withWhatsAppTransport(async () => Response.json(body),
      () => isWhatsAppEnabled('office'))), false);
  }
  for (const response of [new Response('not-json'), new Response('{}', { status: 503 }), new Response('{}', { status: 302 }),
    new Response('x'.repeat(16_385))]) {
    assert.equal(await withWhatsAppEnvironment(restEnvironment, () => withWhatsAppTransport(async () => response,
      () => isWhatsAppEnabled('office'))), false);
  }
  assert.equal(await withWhatsAppEnvironment(restEnvironment, () => withWhatsAppTransport(async () => { throw new Error('offline'); },
    () => isWhatsAppEnabled('office'))), false);
  assert.equal(await withWhatsAppEnvironment({ FLAGS: { async getBooleanValue() { throw new Error('binding unavailable'); } } },
    () => isWhatsAppEnabled('office')), false);
  assert.equal(await withWhatsAppEnvironment(restEnvironment, () => withWhatsAppTransport(async () => Response.json({
    flagKey: 'whatsapp-integration', value: true,
  }), () => isWhatsAppEnabled('office'))), true);
});

test('Flagship caps REST and binding evaluation at 1500ms', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let aborted = false;
  const rest = withWhatsAppEnvironment(restEnvironment, () => withWhatsAppTransport(async (_input, init) => {
    init?.signal?.addEventListener('abort', () => { aborted = true; });
    return new Promise<Response>(() => undefined);
  }, () => isWhatsAppEnabled('office')));
  const binding = withWhatsAppEnvironment({ FLAGS: {
    async getBooleanValue() { return new Promise<boolean>(() => undefined); },
  } }, () => isWhatsAppEnabled('office'));
  t.mock.timers.tick(1501);
  assert.deepEqual(await Promise.all([rest, binding]), [false, false]);
  assert.equal(aborted, true);
});
