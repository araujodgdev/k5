import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './test-setup';
import { verifyTurnstile } from '../src/lib/turnstile';

const realFetch = globalThis.fetch;
const env = { secret: process.env.TURNSTILE_SECRET_KEY, hostnames: process.env.TURNSTILE_HOSTNAMES };
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const [name, value] of [['TURNSTILE_SECRET_KEY', env.secret], ['TURNSTILE_HOSTNAMES', env.hostnames]] as const)
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
});

function siteverify(answer: object | Error, sent: URLSearchParams[] = []) {
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    sent.push(new URLSearchParams(String(init.body)));
    if (answer instanceof Error) throw answer;
    return Response.json(answer);
  }) as typeof fetch;
  return sent;
}

test('siteverify accepts only a successful sign-up token from an approved hostname', async () => {
  process.env.TURNSTILE_SECRET_KEY = 'segredo-de-teste';
  process.env.TURNSTILE_HOSTNAMES = 'lume.software';
  const sent = siteverify({ success: true, action: 'sign-up', hostname: 'lume.software' });
  assert.equal(await verifyTurnstile('token', '203.0.113.9'), true);
  assert.deepEqual(Object.fromEntries(sent[0]), { secret: 'segredo-de-teste', response: 'token', remoteip: '203.0.113.9' });

  for (const answer of [
    { success: false, 'error-codes': ['timeout-or-duplicate'] },
    { success: true, action: 'login', hostname: 'lume.software' },
    { success: true, action: 'sign-up', hostname: 'localhost' },
  ]) {
    siteverify(answer);
    assert.equal(await verifyTurnstile('token', null), false, JSON.stringify(answer));
  }
  siteverify(new Error('offline'));
  assert.equal(await verifyTurnstile('token', null), false, 'an unreachable siteverify fails closed');
});

test('without a secret or a hostname allowlist the token is never sent', async () => {
  const sent = siteverify({ success: true, action: 'sign-up', hostname: 'lume.software' });
  process.env.TURNSTILE_SECRET_KEY = 'segredo-de-teste';
  delete process.env.TURNSTILE_HOSTNAMES;
  assert.equal(await verifyTurnstile('token', null), false);
  process.env.TURNSTILE_HOSTNAMES = 'lume.software';
  delete process.env.TURNSTILE_SECRET_KEY;
  assert.equal(await verifyTurnstile('token', null), false);
  assert.equal(sent.length, 0);
});
