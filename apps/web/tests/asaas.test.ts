import { testDb } from './test-setup';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { WorkspaceContext } from '../src/lib/application/context';
import { withAsaasTransport } from '../src/lib/asaas/provider';
import { asaasCredential, connectAsaas, disconnectAsaas, getAsaasStatus, refreshAsaas } from '../src/lib/asaas/service';
import { decryptCredential, parseCredentialKeyring } from '../src/lib/platform-crypto';
import * as asaasCharges from '../src/lib/asaas/charges';
import * as charges from '../src/lib/honorarios/charges';
import * as honorarios from '../src/lib/honorarios/service';
import { fakeAccount, fakeAsaas, type Call, type RemotePayment } from './asaas-fake';
import * as webhookRoute from '../src/app/api/asaas/webhook/route';

async function office() {
  const officeId = randomUUID(), userId = randomUUID(), sessionId = randomUUID();
  await testDb.prepare('INSERT INTO office(id,name) VALUES(?,?)').run(officeId, 'Escritório sintético');
  await testDb.prepare('INSERT INTO "user"(id,email,name) VALUES(?,?,?)').run(userId, `${userId}@asaas.test`, 'Ana Advogada');
  await testDb.prepare('INSERT INTO office_member(id,office_id,user_id) VALUES(?,?,?)').run(randomUUID(), officeId, userId);
  await testDb.prepare('INSERT INTO session(id,userId,token,expiresAt,createdAt,updatedAt) VALUES(?,?,?,CURRENT_TIMESTAMP+INTERVAL \'1 day\',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)')
    .run(sessionId, userId, randomUUID());
  return { officeId, userId, sessionId } satisfies WorkspaceContext;
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

async function honorario(context: WorkspaceContext, installments = [{ amountCents: 10000, dueOn: '2035-10-20' }]) {
  const clientId = randomUUID();
  await testDb.prepare("INSERT INTO crm_client(id,office_id,name,email,stage,created_at,updated_at) VALUES(?,?,?,?,'active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)")
    .run(clientId, context.officeId, 'Maria Cliente', 'maria@example.com');
  const detail = await honorarios.createHonorario(context, { clientId, title: 'Contrato de honorários', installments, idempotencyKey: randomUUID() });
  return { clientId, installmentIds: detail.installments.map(row => row.id) };
}
const issue = (installmentId: string, extra: Record<string, unknown> = {}) => ({ installmentId, dueOn: '2035-10-20', document: null, idempotencyKey: randomUUID(), ...extra });

test('Asaas charges register the client once, issue a payment link and keep one active charge per installment', async () => {
  const context = await office();
  const apiKey = `$aact_prod_${randomUUID()}`;
  const remote = fakeAccount(apiKey);
  await withAsaasTransport(remote.handler, async () => {
    const { installmentIds: [first, second] } = await honorario(context, [{ amountCents: 10000, dueOn: '2035-10-20' }, { amountCents: 5050, dueOn: '2035-11-20' }]);
    assert.equal((await asaasCharges.getAsaasCharge(context, { installmentId: first })).connection, null);
    await assert.rejects(() => asaasCharges.createAsaasCharge(context, issue(first)), { code: 'CONFLICT' });
    await connectAsaas(context, { apiKey, expectedVersion: null });

    const before = await asaasCharges.getAsaasCharge(context, { installmentId: first });
    assert.equal(before.needsDocument, true); assert.equal(before.chargeable, true); assert.equal(before.active, null);
    await assert.rejects(() => asaasCharges.createAsaasCharge(context, issue(first)), { code: 'INVALID' });
    await assert.rejects(() => asaasCharges.createAsaasCharge(context, issue(first, { dueOn: '2020-01-01', document: '123.456.789-09' })), { code: 'INVALID' });
    assert.equal(remote.state.calls.filter(call => call.method === 'POST').length, 0);

    const input = issue(first, { document: '123.456.789-09' });
    const issued = await asaasCharges.createAsaasCharge(context, input);
    assert.equal(issued.active?.state, 'open'); assert.equal(issued.active?.amountCents, 10000);
    assert.match(issued.active?.invoiceUrl ?? '', /^https:\/\/www\.asaas\.com\/i\/pay_/);
    assert.equal(issued.needsDocument, false);
    const [customer] = remote.state.customers;
    assert.equal(customer.cpfCnpj, '12345678909'); assert.equal(customer.name, 'Maria Cliente');
    const [payment] = remote.state.payments;
    assert.equal(payment.value, 100); assert.equal(payment.billingType, 'UNDEFINED'); assert.equal(payment.customer, customer.id);
    assert.equal(payment.externalReference, `lume:${issued.active?.id}`); assert.match(payment.description ?? '', /parcela 1 de 2/);
    const stored = await testDb.prepare('SELECT * FROM asaas_customer WHERE office_id=?').all(context.officeId);
    assert.equal(JSON.stringify(stored).includes('12345678909'), false);

    assert.deepEqual(await asaasCharges.createAsaasCharge(context, { ...input, document: null }), issued);
    await assert.rejects(() => asaasCharges.createAsaasCharge(context, { ...input, dueOn: '2035-12-01' }), { code: 'CONFLICT' });
    await assert.rejects(() => asaasCharges.createAsaasCharge(context, issue(first)), { code: 'CONFLICT' });
    assert.equal(remote.state.payments.length, 1);
    assert.match((await charges.getCharge(context, { installmentId: first })).message, new RegExp(`Pague pelo link .*${payment.id}`));

    const next = await asaasCharges.createAsaasCharge(context, issue(second, { dueOn: '2035-11-20' }));
    assert.equal(next.active?.amountCents, 5050);
    assert.equal(remote.state.customers.length, 1);
    assert.equal(remote.state.payments[1].value, 50.5);

    const cancelled = await asaasCharges.cancelAsaasCharge(context, { installmentId: first, paymentId: issued.active?.id });
    assert.equal(cancelled.active, null); assert.equal(cancelled.history[0].state, 'cancelled');
    assert.equal(remote.state.payments.length, 1);
    assert.doesNotMatch((await charges.getCharge(context, { installmentId: first })).message, /Pague pelo link/);
    assert.equal((await asaasCharges.createAsaasCharge(context, issue(first))).active?.state, 'open');
  });
});

test('Asaas charges confirm a lost answer before sending again and record a refusal', async () => {
  const context = await office();
  const apiKey = `$aact_prod_${randomUUID()}`;
  const remote = fakeAccount(apiKey);
  await withAsaasTransport(remote.handler, async () => {
    await connectAsaas(context, { apiKey, expectedVersion: null });
    const { installmentIds: [installmentId] } = await honorario(context);
    const expire = () => testDb.prepare("UPDATE asaas_payment SET lease_until=CURRENT_TIMESTAMP-INTERVAL '1 second' WHERE office_id=? AND state='creating'").run(context.officeId);

    remote.state.next = 'lost';
    await assert.rejects(() => asaasCharges.createAsaasCharge(context, issue(installmentId, { document: '12345678909' })), { kind: 'unavailable' });
    const waiting = await asaasCharges.getAsaasCharge(context, { installmentId });
    assert.equal(waiting.active?.state, 'creating'); assert.equal(waiting.active?.unconfirmed, false);
    await assert.rejects(() => asaasCharges.confirmAsaasCharge(context, { installmentId, paymentId: waiting.active?.id }), { code: 'CONFLICT' });
    await assert.rejects(() => asaasCharges.createAsaasCharge(context, issue(installmentId)), { code: 'CONFLICT' });
    await expire();
    assert.equal((await asaasCharges.getAsaasCharge(context, { installmentId })).active?.unconfirmed, true);
    const adopted = await asaasCharges.confirmAsaasCharge(context, { installmentId, paymentId: waiting.active?.id });
    assert.equal(adopted.active?.state, 'open'); assert.equal(adopted.active?.invoiceUrl, remote.state.payments[0].invoiceUrl);
    assert.equal(remote.state.payments.length, 1);
    await asaasCharges.cancelAsaasCharge(context, { installmentId, paymentId: adopted.active?.id });

    remote.state.next = 'unanswered';
    const retry = issue(installmentId);
    await assert.rejects(() => asaasCharges.createAsaasCharge(context, retry), { kind: 'unavailable' });
    await expire();
    const resent = await asaasCharges.createAsaasCharge(context, retry);
    assert.equal(resent.active?.state, 'open'); assert.equal(remote.state.payments.length, 1);

    await asaasCharges.cancelAsaasCharge(context, { installmentId, paymentId: resent.active?.id });
    remote.state.next = 'reject';
    await assert.rejects(() => asaasCharges.createAsaasCharge(context, issue(installmentId)), (error: Error) => /valor mínimo/.test(error.message));
    const refused = await asaasCharges.getAsaasCharge(context, { installmentId });
    assert.equal(refused.active, null); assert.equal(refused.history[0].state, 'failed'); assert.match(refused.history[0].failure ?? '', /valor mínimo/);
  });
});

test('Asaas charges stay with the honorário owner in the active office', async () => {
  const owner = await office(), stranger = await office();
  const apiKey = `$aact_prod_${randomUUID()}`, otherKey = `$aact_prod_${randomUUID()}`;
  const remote = fakeAccount(apiKey), other = fakeAccount(otherKey);
  await withAsaasTransport(async (input, init) => new Headers(init?.headers).get('access_token') === otherKey ? other.handler(input, init) : remote.handler(input, init), async () => {
    await connectAsaas(owner, { apiKey, expectedVersion: null });
    await connectAsaas(stranger, { apiKey: otherKey, expectedVersion: null });
    const { installmentIds: [installmentId] } = await honorario(owner);
    const issued = await asaasCharges.createAsaasCharge(owner, issue(installmentId, { document: '12345678909' }));
    await assert.rejects(() => asaasCharges.getAsaasCharge(stranger, { installmentId }), { code: 'NOT_FOUND' });
    await assert.rejects(() => asaasCharges.createAsaasCharge(stranger, issue(installmentId, { document: '12345678909' })), { code: 'NOT_FOUND' });
    await assert.rejects(() => asaasCharges.cancelAsaasCharge(stranger, { installmentId, paymentId: issued.active?.id }), { code: 'NOT_FOUND' });
    await assert.rejects(() => asaasCharges.getAsaasCharge({ ...stranger, officeId: owner.officeId }, { installmentId }), { code: 'FORBIDDEN' });
    assert.equal(other.state.calls.filter(call => call.method !== 'GET').length, 0);
  });
});

async function withWebhookBase<T>(base: string | undefined, action: () => Promise<T>) {
  const previous = process.env.ASAAS_WEBHOOK_BASE_URL;
  if (base === undefined) delete process.env.ASAAS_WEBHOOK_BASE_URL; else process.env.ASAAS_WEBHOOK_BASE_URL = base;
  try { return await action(); } finally {
    if (previous === undefined) delete process.env.ASAAS_WEBHOOK_BASE_URL; else process.env.ASAAS_WEBHOOK_BASE_URL = previous;
  }
}
const deliver = (token: string | null, body: unknown) => webhookRoute.POST(new Request('https://lume.test/api/asaas/webhook', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { 'asaas-access-token': token } : {}) }, body: JSON.stringify(body),
}));
const event = (name: string, payment: Partial<RemotePayment> & Record<string, unknown>) => ({ id: `evt_${randomUUID()}`, event: name, dateCreated: '2035-10-01 10:00:00', payment: { object: 'payment', ...payment } });

test('Asaas registers its webhook on connect, repairs it on refresh and removes it on disconnect', async () => withWebhookBase('https://lume.test', async () => {
  const context = await office();
  const apiKey = `$aact_prod_${randomUUID()}`;
  const remote = fakeAccount(apiKey);
  remote.state.webhooks.push({ id: 'stale', url: 'https://lume.test/api/asaas/webhook', authToken: 'x'.repeat(40), events: [], enabled: true, interrupted: true, email: '', sendType: 'SEQUENTIALLY' });
  remote.state.webhooks.push({ id: 'other', url: 'https://erp.example.com/asaas', authToken: 'y'.repeat(40), events: [], enabled: true, interrupted: false, email: '', sendType: 'SEQUENTIALLY' });
  await withAsaasTransport(remote.handler, async () => {
    const saved = await connectAsaas(context, { apiKey, expectedVersion: null });
    assert.equal(saved.connection?.webhook.state, 'active');
    assert.deepEqual(remote.state.webhooks.map(hook => hook.id).filter(id => id === 'stale' || id === 'other'), ['other']);
    const hook = remote.state.webhooks.find(row => row.url === 'https://lume.test/api/asaas/webhook');
    assert.ok(hook);
    assert.ok(hook.authToken.length >= 32 && !/\s/.test(hook.authToken)); assert.notEqual(hook.authToken, apiKey);
    assert.equal(hook.sendType, 'SEQUENTIALLY'); assert.equal(hook.email, `${context.userId}@asaas.test`);
    for (const name of ['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED', 'PAYMENT_REFUNDED', 'PAYMENT_DELETED']) assert.ok(hook.events.includes(name));
    const stored = await testDb.prepare('SELECT webhook_id,webhook_token_hash FROM asaas_connection WHERE office_id=?').get<{ webhook_id: string; webhook_token_hash: string }>(context.officeId);
    assert.equal(stored?.webhook_id, hook.id); assert.notEqual(stored?.webhook_token_hash, hook.authToken);

    hook.interrupted = true;
    const refreshed = await refreshAsaas(context, { expectedVersion: saved.connection?.version });
    assert.equal(refreshed.connection?.webhook.state, 'active'); assert.equal(hook.interrupted, false);
    assert.equal(remote.state.webhooks.filter(row => row.url === hook.url).length, 1);

    remote.state.webhooks.splice(remote.state.webhooks.indexOf(hook), 1);
    const recreated = await refreshAsaas(context, { expectedVersion: refreshed.connection?.version });
    assert.equal(recreated.connection?.webhook.state, 'active');
    const replacement = remote.state.webhooks.find(row => row.url === hook.url);
    assert.ok(replacement); assert.notEqual(replacement.authToken, hook.authToken);
    assert.equal((await deliver(hook.authToken, event('PAYMENT_RECEIVED', { id: 'pay_x', status: 'RECEIVED', value: 1 }))).status, 401);

    await disconnectAsaas(context, { expectedVersion: recreated.connection?.version });
    assert.equal(remote.state.webhooks.some(row => row.url === hook.url), false);
    assert.equal((await deliver(replacement.authToken, event('PAYMENT_RECEIVED', { id: 'pay_x', status: 'RECEIVED', value: 1 }))).status, 401);
  });
  await withWebhookBase('http://localhost:3000', async () => {
    const local = await office();
    const localKey = `$aact_prod_${randomUUID()}`;
    const account = fakeAccount(localKey);
    await withAsaasTransport(account.handler, async () => {
      assert.equal((await connectAsaas(local, { apiKey: localKey, expectedVersion: null })).connection?.webhook.state, 'unavailable');
      assert.equal(account.state.webhooks.length, 0);
    });
  });
}));

test('Asaas webhook records a confirmed payment once, within the balance, and undoes it on refund', async () => withWebhookBase('https://lume.test', async () => {
  const context = await office(), other = await office();
  const apiKey = `$aact_prod_${randomUUID()}`, otherKey = `$aact_prod_${randomUUID()}`;
  const remote = fakeAccount(apiKey), foreign = fakeAccount(otherKey);
  await withAsaasTransport(async (input, init) => new Headers(init?.headers).get('access_token') === otherKey ? foreign.handler(input, init) : remote.handler(input, init), async () => {
    await connectAsaas(context, { apiKey, expectedVersion: null });
    await connectAsaas(other, { apiKey: otherKey, expectedVersion: null });
    const token = remote.state.webhooks[0].authToken, otherToken = foreign.state.webhooks[0].authToken;
    const { installmentIds: [first, second] } = await honorario(context, [{ amountCents: 10000, dueOn: '2035-10-20' }, { amountCents: 10000, dueOn: '2035-11-20' }]);
    const issued = await asaasCharges.createAsaasCharge(context, issue(first, { document: '12345678909' }));
    const payment = remote.state.payments[0];
    const base = { id: payment.id, customer: payment.customer, value: 100, billingType: 'PIX', externalReference: payment.externalReference, invoiceUrl: payment.invoiceUrl, dueDate: '2035-10-20' };

    assert.equal((await deliver(null, event('PAYMENT_RECEIVED', base))).status, 401);
    assert.equal((await deliver('z'.repeat(43), event('PAYMENT_RECEIVED', base))).status, 401);
    assert.equal((await deliver(otherToken, event('PAYMENT_RECEIVED', { ...base, status: 'RECEIVED' }))).status, 200);
    assert.equal((await asaasCharges.getAsaasCharge(context, { installmentId: first })).active?.state, 'open');
    assert.equal((await deliver(token, event('PAYMENT_RECEIVED', { id: `pay_${randomUUID()}`, status: 'RECEIVED', value: 50, externalReference: 'pedido-42' }))).status, 200);
    assert.equal((await deliver(token, { malformed: true })).status, 200);

    const confirmed = event('PAYMENT_CONFIRMED', { ...base, status: 'CONFIRMED', clientPaymentDate: '2026-01-02', confirmedDate: '2026-01-02' });
    assert.equal((await deliver(token, confirmed)).status, 200);
    assert.equal((await deliver(token, confirmed)).status, 200);
    assert.equal((await deliver(token, event('PAYMENT_RECEIVED', { ...base, status: 'RECEIVED', paymentDate: '2026-01-03' }))).status, 200);
    const owner = await testDb.prepare('SELECT agreement_id FROM honorario_installment WHERE id=?').get<{ agreement_id: string }>(first);
    const detail = await honorarios.getHonorario(context, { agreementId: owner?.agreement_id ?? '' });
    assert.equal(detail.receipts.length, 1);
    const [receipt] = detail.receipts;
    assert.equal(receipt.amountCents, 10000); assert.equal(receipt.method, 'pix'); assert.equal(receipt.receivedOn, '2026-01-02');
    assert.match(receipt.notes, new RegExp(payment.id)); assert.equal(receipt.createdByName, 'Ana Advogada');
    assert.equal(detail.installments.find(row => row.id === first)?.status, 'received');
    const charge = await asaasCharges.getAsaasCharge(context, { installmentId: first });
    assert.equal(charge.active, null); assert.equal(charge.history[0].state, 'paid'); assert.equal(charge.chargeable, false);
    const notices = await testDb.prepare("SELECT event_type,intended_recipients_json FROM notification_event WHERE office_id=? AND source_id=?").all<{ event_type: string; intended_recipients_json: string }>(context.officeId, first);
    assert.deepEqual(notices.map(row => row.event_type), ['honorarios.charge.paid']);
    assert.deepEqual(JSON.parse(notices[0].intended_recipients_json), [context.userId]);

    assert.equal((await deliver(token, event('PAYMENT_REFUNDED', { ...base, status: 'REFUNDED' }))).status, 200);
    const refunded = await honorarios.getHonorario(context, { agreementId: detail.agreement.id });
    assert.match(refunded.receipts[0].reversal?.reason ?? '', /estornado no Asaas/);
    assert.equal(refunded.installments.find(row => row.id === first)?.pendingCents, 10000);
    assert.equal((await asaasCharges.getAsaasCharge(context, { installmentId: first })).history[0].state, 'refunded');
    assert.equal(issued.active?.id, (await asaasCharges.getAsaasCharge(context, { installmentId: first })).history[0].id);

    // Paid above the balance after a manual receipt: only the balance is recorded, with a note.
    await asaasCharges.createAsaasCharge(context, issue(second, { dueOn: '2035-11-20' }));
    await honorarios.receiveHonorario(context, { installmentId: second, amountCents: 3000, receivedOn: '2026-01-01', method: 'cash', idempotencyKey: randomUUID() });
    const later = remote.state.payments[1];
    await deliver(token, event('PAYMENT_RECEIVED', { id: later.id, status: 'RECEIVED', value: 100, billingType: 'BOLETO', externalReference: later.externalReference, paymentDate: '2026-01-05' }));
    const partial = await honorarios.getHonorario(context, { agreementId: detail.agreement.id });
    const boleto = partial.receipts.find(row => row.installmentId === second && row.method === 'boleto');
    assert.equal(boleto?.amountCents, 7000);
    assert.equal(partial.installments.find(row => row.id === second)?.status, 'received');
    const review = await testDb.prepare('SELECT review FROM asaas_payment WHERE provider_payment_id=?').get<{ review: string }>(later.id);
    assert.match(review?.review ?? '', /acima do saldo/);
  });
}));

test('Asaas webhook adopts a charge whose creation answer was lost and follows deletion', async () => withWebhookBase('https://lume.test', async () => {
  const context = await office();
  const apiKey = `$aact_prod_${randomUUID()}`;
  const remote = fakeAccount(apiKey);
  await withAsaasTransport(remote.handler, async () => {
    await connectAsaas(context, { apiKey, expectedVersion: null });
    const token = remote.state.webhooks[0].authToken;
    const { installmentIds: [installmentId] } = await honorario(context);
    remote.state.next = 'lost';
    await assert.rejects(() => asaasCharges.createAsaasCharge(context, issue(installmentId, { document: '12345678909' })), { kind: 'unavailable' });
    const created = remote.state.payments[0];
    await deliver(token, event('PAYMENT_CREATED', { id: created.id, status: 'PENDING', value: 100, externalReference: created.externalReference, invoiceUrl: created.invoiceUrl }));
    const adopted = await asaasCharges.getAsaasCharge(context, { installmentId });
    assert.equal(adopted.active?.state, 'open'); assert.equal(adopted.active?.invoiceUrl, created.invoiceUrl);
    await deliver(token, event('PAYMENT_DELETED', { id: created.id, status: 'PENDING', value: 100, externalReference: created.externalReference, deleted: true }));
    const removed = await asaasCharges.getAsaasCharge(context, { installmentId });
    assert.equal(removed.active, null); assert.equal(removed.history[0].state, 'cancelled');
    await deliver(token, event('PAYMENT_RESTORED', { id: created.id, status: 'PENDING', value: 100, externalReference: created.externalReference }));
    assert.equal((await asaasCharges.getAsaasCharge(context, { installmentId })).active?.state, 'open');
  });
}));
