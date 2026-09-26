import { testDb } from './test-setup';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { abacatePayClient, AbacatePayError, signWebhookBody, verifyWebhook, type AbacatePayClient, type CheckoutStatus } from '../src/lib/billing/abacatepay';
import { billingOverview, handleBillingWebhook, settleCheckout, startPlanCheckout, syncPendingCheckouts } from '../src/lib/billing/office-billing';

process.env.BILLING_PLAN_PRICE_CENTS = '19900';
process.env.BETTER_AUTH_URL = 'https://tises.example.test/';

async function office() {
  const officeId = randomUUID(), userId = randomUUID();
  await testDb.prepare('INSERT INTO office(id,name) VALUES(?,?)').run(officeId, 'Escritório de teste');
  await testDb.prepare('INSERT INTO "user"(id,email,name) VALUES(?,?,?)').run(userId, `${userId}@example.test`, 'Pessoa');
  await testDb.prepare('INSERT INTO office_member(id,office_id,user_id,role) VALUES(?,?,?,?)').run(randomUUID(), officeId, userId, 'administrator');
  return { officeId, userId, email: `${userId}@example.test`, name: 'Pessoa' };
}

/** An in-memory AbacatePay: products by externalId, checkouts by id, and every call recorded. */
function fakeAbacate() {
  const products = new Map<string, { id: string; externalId: string; price: number }>();
  const checkouts = new Map<string, { id: string; url: string; amount: number; status: CheckoutStatus; devMode: boolean; receiptUrl: string | null }>();
  const calls: { name: string; input?: unknown }[] = [];
  const client: AbacatePayClient = {
    async getProduct(externalId) {
      calls.push({ name: 'getProduct', input: externalId });
      const product = products.get(externalId);
      if (!product) throw new AbacatePayError(404, 'Product not found');
      return product;
    },
    async createProduct(input) {
      calls.push({ name: 'createProduct', input });
      const product = { id: `prod_${randomUUID()}`, externalId: input.externalId, price: input.price };
      products.set(input.externalId, product);
      return product;
    },
    async createCustomer(input) { calls.push({ name: 'createCustomer', input }); return { id: `cust_${randomUUID()}` }; },
    async createCheckout(input) {
      calls.push({ name: 'createCheckout', input });
      const id = `bill_${randomUUID()}`;
      const checkout = { id, url: `https://app.abacatepay.com/pay/${id}`, amount: 19_900, status: 'PENDING' as const, devMode: true, receiptUrl: null };
      checkouts.set(id, checkout);
      return checkout;
    },
    async getCheckout(id) {
      calls.push({ name: 'getCheckout', input: id });
      const checkout = checkouts.get(id);
      if (!checkout) throw new AbacatePayError(404, 'Billing not found');
      return checkout;
    },
  };
  return { client, calls, checkouts };
}

const paidUntil = async (officeId: string) => (await billingOverview(officeId)).paidUntil;
const monthFrom = (from: Date) => { const next = new Date(from); next.setUTCMonth(next.getUTCMonth() + 1); return next; };

test('webhook verification needs the registered secret and AbacatePay\'s signature over the raw body', () => {
  const body = JSON.stringify({ id: 'log_1', event: 'checkout.completed' });
  const signature = signWebhookBody(body);
  assert.equal(verifyWebhook(body, signature, 's3cret', 's3cret'), true);
  assert.equal(verifyWebhook(body, signature, 'other', 's3cret'), false);
  assert.equal(verifyWebhook(body, signature, null, 's3cret'), false);
  assert.equal(verifyWebhook(`${body} `, signature, 's3cret', 's3cret'), false);
  assert.equal(verifyWebhook(body, null, 's3cret', 's3cret'), false);
  assert.equal(verifyWebhook(body, signature, '', ''), false);
});

test('the client sends the bearer key and turns an error envelope into AbacatePayError', async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const client = abacatePayClient('abc_dev_key', async (url, init) => {
    seen.push({ url, init });
    if (url.includes('/checkouts/get')) return Response.json({ data: null, success: false, error: 'Billing not found' }, { status: 404 });
    return Response.json({ data: { id: 'bill_1', url: 'https://app.abacatepay.com/pay/bill_1', amount: 100, status: 'PENDING', devMode: true }, success: true, error: null });
  });
  const created = await client.createCheckout({ items: [{ id: 'prod_1', quantity: 1 }] });
  assert.equal(created.id, 'bill_1');
  assert.equal(seen[0].url, 'https://api.abacatepay.com/v2/checkouts/create');
  assert.equal((seen[0].init.headers as Record<string, string>).authorization, 'Bearer abc_dev_key');
  await assert.rejects(client.getCheckout('bill_x'), (error: unknown) => error instanceof AbacatePayError && error.status === 404 && error.message === 'Billing not found');
  assert.equal(seen[1].url, 'https://api.abacatepay.com/v2/checkouts/get?id=bill_x');
});

test('opening a checkout creates the plan product and customer once and reuses a recent pending checkout', async () => {
  const payer = await office();
  const abacate = fakeAbacate();
  const first = await startPlanCheckout(payer, abacate.client);
  const again = await startPlanCheckout(payer, abacate.client);
  assert.equal(again.url, first.url);
  assert.deepEqual(abacate.calls.map(call => call.name), ['getProduct', 'createProduct', 'createCustomer', 'createCheckout']);
  const checkout = abacate.calls.find(call => call.name === 'createCheckout')!.input as { completionUrl: string; returnUrl: string; items: unknown[] };
  assert.equal(checkout.completionUrl, 'https://tises.example.test/app/billing?pagamento=concluido');
  assert.equal(checkout.returnUrl, 'https://tises.example.test/app/billing');
  const overview = await billingOverview(payer.officeId);
  assert.equal(overview.active, false);
  assert.equal(overview.checkouts.length, 1);
  assert.equal(overview.checkouts[0].status, 'PENDING');
});

test('a payment credits one month once, early renewals stack and a refund removes its month', async () => {
  const payer = await office();
  const abacate = fakeAbacate();
  const { url } = await startPlanCheckout(payer, abacate.client);
  const firstId = url.split('/').pop()!;

  const before = new Date();
  assert.equal(await settleCheckout(firstId, 'PAID', 'https://app.abacatepay.com/receipt/1'), true);
  assert.equal(await settleCheckout(firstId, 'PAID'), false, 'a second confirmation is a no-op');
  const afterFirst = new Date((await paidUntil(payer.officeId))!);
  assert.ok(Math.abs(afterFirst.getTime() - monthFrom(before).getTime()) < 60_000);

  // Paying while active adds a month to the end of the current one.
  await testDb.prepare("UPDATE billing_checkout SET created_at = created_at - interval '1 hour' WHERE id = ?").run(firstId);
  const second = (await startPlanCheckout(payer, abacate.client)).url.split('/').pop()!;
  assert.notEqual(second, firstId);
  await settleCheckout(second, 'PAID');
  const afterSecond = new Date((await paidUntil(payer.officeId))!);
  assert.ok(Math.abs(afterSecond.getTime() - monthFrom(afterFirst).getTime()) < 60_000);

  assert.equal(await settleCheckout(second, 'REFUNDED'), true);
  assert.equal(await settleCheckout(second, 'REFUNDED'), false);
  assert.equal(new Date((await paidUntil(payer.officeId))!).getTime(), afterFirst.getTime());
  assert.equal(await settleCheckout(second, 'PAID'), false, 'a refunded checkout is never credited again');

  const overview = await billingOverview(payer.officeId);
  assert.equal(overview.active, true);
  assert.deepEqual(overview.checkouts.map(row => row.status), ['REFUNDED', 'PAID']);
  assert.equal(overview.checkouts[1].receiptUrl, 'https://app.abacatepay.com/receipt/1');
});

test('webhooks are applied once per delivery id and ignore checkouts this app did not open', async () => {
  const payer = await office();
  const abacate = fakeAbacate();
  const id = (await startPlanCheckout(payer, abacate.client)).url.split('/').pop()!;
  const delivery = { id: `log_${randomUUID()}`, event: 'checkout.completed', apiVersion: 2, devMode: true, data: { checkout: { id, status: 'PAID', receiptUrl: 'https://app.abacatepay.com/receipt/2', future: { field: true } } } };
  assert.equal(await handleBillingWebhook(delivery), 'applied');
  assert.equal(await handleBillingWebhook(delivery), 'duplicate');
  assert.equal(await handleBillingWebhook({ id: `log_${randomUUID()}`, event: 'checkout.completed', data: { checkout: { id: 'bill_elsewhere' } } }), 'ignored');
  assert.equal(await handleBillingWebhook({ id: `log_${randomUUID()}`, event: 'payout.completed', data: {} }), 'ignored');
  assert.equal((await billingOverview(payer.officeId)).active, true);
});

test('returning to the page settles pending checkouts from AbacatePay', async () => {
  const payer = await office();
  const abacate = fakeAbacate();
  const paid = (await startPlanCheckout(payer, abacate.client)).url.split('/').pop()!;
  abacate.checkouts.get(paid)!.status = 'PAID';
  await syncPendingCheckouts(payer.officeId, abacate.client);
  assert.equal((await billingOverview(payer.officeId)).active, true);

  await testDb.prepare("UPDATE billing_checkout SET created_at = created_at - interval '1 hour' WHERE id = ?").run(paid);
  const expired = (await startPlanCheckout(payer, abacate.client)).url.split('/').pop()!;
  abacate.checkouts.get(expired)!.status = 'EXPIRED';
  await syncPendingCheckouts(payer.officeId, abacate.client);
  const overview = await billingOverview(payer.officeId);
  assert.deepEqual(overview.checkouts.map(row => row.status), ['EXPIRED', 'PAID']);
});
