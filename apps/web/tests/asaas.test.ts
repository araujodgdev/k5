import { testDb } from './test-setup';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { WorkspaceContext } from '../src/lib/application/context';
import { withAsaasTransport } from '../src/lib/asaas/provider';
import { asaasCredential, connectAsaas, disconnectAsaas, getAsaasStatus, refreshAsaas } from '../src/lib/asaas/service';
import { decryptCredential, parseCredentialKeyring } from '../src/lib/platform-crypto';

async function office() {
  const officeId = randomUUID(), userId = randomUUID(), sessionId = randomUUID();
  await testDb.prepare('INSERT INTO office(id,name) VALUES(?,?)').run(officeId, 'Escritório sintético');
  await testDb.prepare('INSERT INTO "user"(id,email,name) VALUES(?,?,?)').run(userId, `${userId}@asaas.test`, 'Ana Advogada');
  await testDb.prepare('INSERT INTO office_member(id,office_id,user_id) VALUES(?,?,?)').run(randomUUID(), officeId, userId);
  await testDb.prepare('INSERT INTO session(id,userId,token,expiresAt,createdAt,updatedAt) VALUES(?,?,?,CURRENT_TIMESTAMP+INTERVAL \'1 day\',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)')
    .run(sessionId, userId, randomUUID());
  return { officeId, userId, sessionId } satisfies WorkspaceContext;
}

type Call = { method: string; url: URL; key: string | null; body: unknown };
/** A fake Asaas: one account per key, answering the account reads the connection makes. */
function fakeAsaas(accounts: Record<string, { wallet: string; host: string }>, calls: Call[] = []) {
  return async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const key = new Headers(init?.headers).get('access_token');
    calls.push({ method: init?.method ?? 'GET', url, key, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    assert.equal(init?.redirect, 'manual');
    assert.match(new Headers(init?.headers).get('user-agent') ?? '', /^Lume\//);
    const account = key ? accounts[key] : undefined;
    if (!account || account.host !== url.host) return Response.json({ errors: [{ code: 'invalid_access_token', description: 'Chave inválida' }] }, { status: 401 });
    if (url.pathname === '/v3/myAccount/commercialInfo/') return Response.json({ name: 'Ana Advogada', companyName: 'Ana Advocacia', email: 'ana@example.com', cpfCnpj: '12345678000190', personType: 'JURIDICA', status: 'APPROVED', incomeValue: 10_000 });
    if (url.pathname === '/v3/wallets/') return Response.json({ object: 'list', data: [{ object: 'wallet', id: account.wallet }] });
    return Response.json({ errors: [{ description: 'Rota não simulada' }] }, { status: 404 });
  };
}

test('Asaas connection stores the key encrypted, detects the environment and keeps one office per account', async () => {
  const first = await office(), second = await office();
  const production = `$aact_prod_${randomUUID()}`, sandbox = `$aact_hmlg_${randomUUID()}`, wallet = randomUUID();
  const calls: Call[] = [];
  await withAsaasTransport(fakeAsaas({ [production]: { wallet, host: 'api.asaas.com' }, [sandbox]: { wallet: randomUUID(), host: 'api-sandbox.asaas.com' } }, calls), async () => {
    const saved = await connectAsaas(first, { apiKey: production, expectedVersion: null });
    assert.equal(saved.connection?.environment, 'production');
    assert.equal(saved.connection?.walletId, wallet);
    assert.equal(saved.connection?.account.name, 'Ana Advocacia');
    assert.equal(saved.connection?.account.document, '**.***.***/0001-90');
    assert.equal(JSON.stringify(saved).includes(production), false);
    assert.equal(JSON.stringify(saved).includes('incomeValue'), false);
    const stored = await testDb.prepare('SELECT encrypted_api_key,account_json FROM asaas_connection WHERE office_id=?').get<{ encrypted_api_key: string; account_json: string }>(first.officeId);
    assert.ok(stored); assert.notEqual(stored.encrypted_api_key, production);
    assert.equal(decryptCredential(stored.encrypted_api_key, parseCredentialKeyring()), production);
    assert.equal(stored.account_json.includes('12345678000190'), false);
    assert.equal((await asaasCredential(first.officeId))?.apiKey, production);

    assert.equal((await getAsaasStatus(second)).connection, null);
    await assert.rejects(() => connectAsaas(second, { apiKey: production, expectedVersion: null }), { code: 'CONFLICT' });
    await assert.rejects(() => connectAsaas(first, { apiKey: sandbox, expectedVersion: saved.connection?.version }), { code: 'CONFLICT' });
    const testing = await connectAsaas(second, { apiKey: sandbox, expectedVersion: null });
    assert.equal(testing.connection?.environment, 'sandbox');

    const refreshed = await refreshAsaas(first, { expectedVersion: saved.connection?.version });
    assert.notEqual(refreshed.connection?.version, saved.connection?.version);
    await assert.rejects(() => disconnectAsaas(first, { expectedVersion: saved.connection?.version }), { code: 'CONFLICT' });
    assert.equal((await disconnectAsaas(first, { expectedVersion: refreshed.connection?.version })).connection, null);
    assert.equal(await asaasCredential(first.officeId), null);
  });
  assert.ok(calls.every(call => call.method === 'GET'));
  const history = await testDb.prepare('SELECT action FROM asaas_connection_audit WHERE office_id=? ORDER BY created_at').all<{ action: string }>(first.officeId);
  assert.deepEqual(history.map(row => row.action), ['connected', 'verified', 'disconnected']);
});

test('Asaas tries a legacy key in production, then in the sandbox, and explains a refused key', async () => {
  const context = await office();
  const legacy = `$aact_${randomUUID()}`;
  const calls: Call[] = [];
  await withAsaasTransport(fakeAsaas({ [legacy]: { wallet: randomUUID(), host: 'api-sandbox.asaas.com' } }, calls), async () => {
    assert.equal((await connectAsaas(context, { apiKey: legacy, expectedVersion: null })).connection?.environment, 'sandbox');
    assert.deepEqual([...new Set(calls.map(call => call.url.host))], ['api.asaas.com', 'api-sandbox.asaas.com']);
    const other = await office();
    await assert.rejects(() => connectAsaas(other, { apiKey: `$aact_prod_${randomUUID()}`, expectedVersion: null }), { status: 422, kind: 'unauthorized' });
    await assert.rejects(() => connectAsaas(other, { apiKey: 'sk_live_not_asaas', expectedVersion: null }), (error: Error) => /\$aact_/.test(error.message));
  });
});

test('Asaas refuses revoked sessions and removed members before contacting Asaas', async () => {
  const context = await office();
  await withAsaasTransport(async () => { assert.fail('Unauthorized access contacted Asaas'); }, async () => {
    await testDb.prepare('DELETE FROM session WHERE id=?').run(context.sessionId);
    await assert.rejects(() => connectAsaas(context, { apiKey: `$aact_prod_${randomUUID()}`, expectedVersion: null }), { code: 'UNAUTHENTICATED' });
    const removed = await office();
    await testDb.prepare('DELETE FROM office_member WHERE office_id=?').run(removed.officeId);
    await assert.rejects(() => getAsaasStatus(removed), { code: 'FORBIDDEN' });
    await assert.rejects(() => connectAsaas(removed, { apiKey: `$aact_prod_${randomUUID()}`, expectedVersion: null }), { code: 'FORBIDDEN' });
  });
});
