import { testDb } from './test-setup';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { abacatePayClient, AbacatePayError, signWebhookBody, verifyWebhook, type AbacatePayClient, type CheckoutStatus } from '../src/lib/billing/abacatepay';
import { billingOverview, handleBillingWebhook, settleCheckout, startPlanCheckout, syncPendingCheckouts } from '../src/lib/billing/office-billing';
import { POST as webhookPost } from '../src/app/api/billing/webhook/route';
import { createClientCheckout, clientBillingAction, platformFinance, refreshClientBilling } from '../src/lib/billing/platform-billing';
import { handleSubscriptionWebhook, subscriptionsForOffice } from '../src/lib/billing/subscriptions';
import { withTransaction } from '../src/lib/database';

process.env.BILLING_PLAN_PRICE_CENTS = '19900';
process.env.BETTER_AUTH_URL = 'https://tises.example.test/';

async function office() {
  const officeId = randomUUID(), userId = randomUUID();
  await testDb.prepare('INSERT INTO office(id,name) VALUES(?,?)').run(officeId, 'Escritório de teste');
  await testDb.prepare('INSERT INTO "user"(id,email,name) VALUES(?,?,?)').run(userId, `${userId}@example.test`, 'Pessoa');
  await testDb.prepare('INSERT INTO office_member(id,office_id,user_id) VALUES(?,?,?)').run(randomUUID(), officeId, userId);
  return { officeId, userId, email: `${userId}@example.test`, name: 'Pessoa' };
}

/** An in-memory AbacatePay: products by externalId, checkouts by id, and every call recorded. */
function fakeAbacate() {
  const products = new Map<string, { id: string; externalId: string; price: number }>();
  const checkouts = new Map<string, { id: string; externalId?: string; url: string; amount: number; status: CheckoutStatus; devMode: boolean; receiptUrl: string | null }>();
  const calls: { name: string; input?: unknown }[] = [];
  const client: AbacatePayClient = {
    ...abacatePayClient('unused', async () => { throw new Error('Unexpected provider request'); }),
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
      const checkout = { id, externalId: input.externalId, url: `https://app.abacatepay.com/pay/${id}`, amount: 19_900, status: 'PENDING' as const, devMode: true, receiptUrl: null };
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
  client.getSubscriptionCheckout = client.getCheckout;
  client.getCheckoutByExternalId = client.getSubscriptionCheckoutByExternalId = async externalId => {
    const checkout = [...checkouts.values()].find(row => row.externalId === externalId);
    if (!checkout) throw new AbacatePayError(404, 'Billing not found');
    return checkout;
  };
  return { client, calls, checkouts };
}

const paidUntil = async (officeId: string) => (await billingOverview(officeId)).paidUntil;
const monthFrom = (from: Date) => { const next = new Date(from); next.setUTCMonth(next.getUTCMonth() + 1); return next; };

async function platformActor() {
  const actor = await office();
  await testDb.prepare('INSERT INTO platform_admin(user_id) VALUES(?)').run(actor.userId);
  return actor.userId;
}

test('platform billing authorizes every action and verifies the target office membership', async () => {
  const actor = await platformActor(), payer = await office(), other = await office();
  const fake = fakeAbacate();
  await assert.rejects(createClientCheckout(other.userId,payer.officeId,payer.userId,false,fake.client), /Acesso restrito/);
  await assert.rejects(createClientCheckout(actor,payer.officeId,other.userId,false,fake.client), /advogado deste cliente/);
  assert.equal(fake.calls.length,0);
  const opened = await createClientCheckout(actor,payer.officeId,payer.userId,false,fake.client);
  const id = opened.url.split('/').pop()!;
  await settleCheckout(id,'PAID');
  await assert.rejects(clientBillingAction(actor,other.officeId,id,'refund',fake.client), /não encontrada neste cliente/);
  await testDb.prepare('DELETE FROM platform_admin WHERE user_id=?').run(actor);
  await assert.rejects(clientBillingAction(actor,payer.officeId,id,'refund',fake.client), /Acesso restrito/);
});

test('refund is scoped, audited, confirmed and submitted only once under concurrency', async () => {
  const actor = await platformActor(), payer = await office(), fake = fakeAbacate();
  const id = (await startPlanCheckout(payer,fake.client)).url.split('/').pop()!;
  fake.checkouts.get(id)!.status='PAID'; await settleCheckout(id,'PAID');
  let refunds=0;
  fake.client.refundCheckout = async target => { refunds++; await new Promise(resolve=>setTimeout(resolve,30)); fake.checkouts.get(target)!.status='REFUNDED'; return {id:'refund_1',status:'COMPLETE'}; };
  await Promise.allSettled([clientBillingAction(actor,payer.officeId,id,'refund',fake.client),clientBillingAction(actor,payer.officeId,id,'refund',fake.client)]);
  await clientBillingAction(actor,payer.officeId,id,'refund',fake.client);
  assert.equal(refunds,1);
  assert.equal((await billingOverview(payer.officeId)).checkouts[0].status,'REFUNDED');
  assert.equal((await testDb.prepare('SELECT status FROM billing_action WHERE target_id=?').get<{status:string}>(id))?.status,'SUCCEEDED');
  assert.ok(await testDb.prepare("SELECT 1 FROM platform_audit_log WHERE actor_user_id=? AND office_id=? AND action='billing.refund_requested'").get(actor,payer.officeId));
});

test('an uncertain refund is reconciled, never resent after a network failure', async () => {
  const actor = await platformActor(), payer = await office(), fake = fakeAbacate();
  const id = (await startPlanCheckout(payer,fake.client)).url.split('/').pop()!;
  fake.checkouts.get(id)!.status='PAID'; await settleCheckout(id,'PAID');
  let refunds=0;
  fake.client.refundCheckout = async () => { refunds++; throw new AbacatePayError(0,'timeout'); };
  await assert.rejects(clientBillingAction(actor,payer.officeId,id,'refund',fake.client), /confirmação ainda/);
  await assert.rejects(clientBillingAction(actor,payer.officeId,id,'refund',fake.client), /já foi solicitada/);
  fake.checkouts.get(id)!.status='REFUNDED';
  await refreshClientBilling(actor,payer.officeId,fake.client);
  assert.equal(refunds,1);
  assert.equal((await testDb.prepare('SELECT status FROM billing_action WHERE target_id=?').get<{status:string}>(id))?.status,'SUCCEEDED');
});

test('a provider refusal preserves paid time and a faster webhook cannot be downgraded by a stale API read', async () => {
  const actor=await platformActor(),payer=await office(),fake=fakeAbacate();
  const id=(await startPlanCheckout(payer,fake.client)).url.split('/').pop()!;
  fake.checkouts.get(id)!.status='PAID'; await settleCheckout(id,'PAID');
  const before=await paidUntil(payer.officeId);
  fake.client.refundCheckout=async ()=>{throw new AbacatePayError(400,'Saldo insuficiente para realizar o reembolso.');};
  await assert.rejects(clientBillingAction(actor,payer.officeId,id,'refund',fake.client),/Saldo insuficiente/);
  assert.equal(await paidUntil(payer.officeId),before);
  assert.equal((await billingOverview(payer.officeId)).checkouts[0].status,'PAID');
  fake.client.refundCheckout=async ()=>{await settleCheckout(id,'REFUNDED');return {id:'refund',status:'COMPLETE'};};
  await clientBillingAction(actor,payer.officeId,id,'refund',fake.client);
  assert.equal((await testDb.prepare("SELECT status FROM billing_action WHERE target_id=? AND status<>'FAILED'").get<{status:string}>(id))?.status,'SUCCEEDED');
});

test('subscription lifecycle credits each checkout once, preserves paid time on cancel, ignores foreign subscriptions', async () => {
  const actor = await platformActor(), payer = await office(), fake = fakeAbacate();
  process.env.ABACATEPAY_WEBHOOK_SECRET='test-secret';
  fake.client.createSubscription=fake.client.createCheckout;
  fake.client.getSubscriptionCheckout=fake.client.getCheckout;
  const first = await createClientCheckout(actor,payer.officeId,payer.userId,true,fake.client);
  assert.equal((await createClientCheckout(actor,payer.officeId,payer.userId,true,fake.client)).url,first.url);
  const id=first.url.split('/').pop()!;
  const sub = { id: `subs_${randomUUID()}`,checkoutId:id,status:'ACTIVE' as 'ACTIVE'|'CANCELLED',amount:19900,devMode:true,updatedAt:new Date().toISOString() };
  fake.client.getSubscription=async ()=>sub;
  fake.client.listCheckoutSubscriptions=async ()=>[sub];
  const payload = { id:randomUUID(),event:'subscription.completed',data:{subscription:{id:sub.id,updatedAt:sub.updatedAt},checkout:{id,status:'PAID',amount:19900}} };
  await settleCheckout(id,'PAID'); // Return-page reconciliation can precede the webhook.
  const initial = await paidUntil(payer.officeId);
  await Promise.all([handleSubscriptionWebhook(payload,fake.client),handleSubscriptionWebhook(payload,fake.client)]);
  assert.equal(await paidUntil(payer.officeId),initial);
  await assert.rejects(createClientCheckout(actor,payer.officeId,payer.userId,true,fake.client), /já tem uma assinatura/);
  const renewalId=`bill_${randomUUID()}`;
  const renewal={...payload,id:randomUUID(),event:'subscription.renewed',data:{...payload.data,checkout:{id:renewalId,status:'PAID',amount:19900}}};
  await handleSubscriptionWebhook(renewal,fake.client);
  await handleSubscriptionWebhook({...renewal,id:randomUUID()},fake.client);
  const renewed=await paidUntil(payer.officeId);
  assert.ok(new Date(renewed!).getTime()>new Date(initial!).getTime());
  assert.equal((await billingOverview(payer.officeId)).checkouts.length,2);
  await assert.rejects(clientBillingAction(actor,payer.officeId,renewalId,'refund',fake.client), /Somente pagamentos avulsos/);
  fake.client.cancelSubscription=async ()=>{sub.status='CANCELLED';return sub;};
  await clientBillingAction(actor,payer.officeId,sub.id,'cancel',fake.client);
  assert.equal(await paidUntil(payer.officeId),renewed);
  await handleSubscriptionWebhook({...payload,id:randomUUID()},fake.client);
  assert.equal((await subscriptionsForOffice(payer.officeId))[0].status,'CANCELLED');
  fake.client.getSubscription=async ()=>({...sub,id:'subs_foreign',checkoutId:'bill_foreign'});
  assert.equal(await handleSubscriptionWebhook({...payload,id:randomUUID(),data:{...payload.data,subscription:{id:'subs_foreign'}}},fake.client),'ignored');
});

test('financial totals separate sandbox from production and apply filters to all matching payments', async () => {
  const payer = await office(), fake = fakeAbacate();
  await testDb.prepare('UPDATE office SET name=? WHERE id=?').run(`Finance ${payer.officeId}`,payer.officeId);
  const id=(await startPlanCheckout(payer,fake.client)).url.split('/').pop()!;
  await settleCheckout(id,'PAID');
  const filters={sandbox:true,days:30 as const,status:'',query:payer.officeId,page:1};
  assert.equal((await platformFinance(filters)).summary.received,19900);
  assert.equal((await platformFinance({...filters,sandbox:false})).summary.received,0);
  await settleCheckout(id,'REFUNDED');
  const result=await platformFinance(filters);
  assert.equal(result.summary.refunded,19900);
  assert.equal(result.summary.received-result.summary.refunded,0);
  assert.equal((await platformFinance({...filters,status:'PAID'})).payments.length,0);
});

test('subscriptions created from a shared checkout each credit their own payment without duplicating retries', async () => {
  const payer=await office(),fake=fakeAbacate();
  fake.client.createSubscription=fake.client.createCheckout;
  const checkoutId=(await startPlanCheckout(payer,fake.client,{recurring:true})).url.split('/').pop()!;
  let providerId=`subs_${randomUUID()}`;
  fake.client.getSubscription=async ()=>({id:providerId,checkoutId,status:'ACTIVE',amount:19900,devMode:true,updatedAt:new Date().toISOString()});
  function payload() { return {id:randomUUID(),event:'subscription.completed',data:{subscription:{id:providerId},checkout:{id:checkoutId,status:'PAID',amount:19900},payment:{id:`char_${providerId}`}}}; }
  await handleSubscriptionWebhook(payload(),fake.client);
  const first=await paidUntil(payer.officeId);
  providerId=`subs_${randomUUID()}`;
  await handleSubscriptionWebhook(payload(),fake.client);
  const second=await paidUntil(payer.officeId);
  await handleSubscriptionWebhook(payload(),fake.client);
  assert.equal(await paidUntil(payer.officeId),second);
  assert.ok(new Date(second!).getTime()>new Date(first!).getTime());
  assert.equal((await subscriptionsForOffice(payer.officeId)).length,2);
  assert.equal((await billingOverview(payer.officeId)).checkouts.length,2);
});

test('the v2 client uses subscription checkout endpoints separately from subscription management', async () => {
  const seen: {url:string;body:unknown}[]=[];
  const client=abacatePayClient('fake',async(url,init)=>{
    seen.push({url,body:init.body ? JSON.parse(String(init.body)):null});
    return Response.json({success:true,data:{id:'test'}});
  });
  await client.getSubscriptionCheckout('bill_one');
  await client.listCheckoutSubscriptions('bill_one');
  await client.getSubscription('subs_one');
  await client.cancelSubscription('subs_one');
  await client.createSubscription({items:[{id:'prod_one',quantity:1}]});
  assert.deepEqual(seen.map(item=>new URL(item.url).pathname),['/v2/subscriptions/checkouts/get','/v2/subscriptions/list','/v2/subscriptions/get','/v2/subscriptions/cancel','/v2/subscriptions/create']);
  assert.equal(new URL(seen[1].url).searchParams.get('checkoutId'),'bill_one');
  assert.deepEqual(seen[3].body,{id:'subs_one'});
  assert.deepEqual((seen[4].body as {methods:string[]}).methods,['CARD']);
});

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

test('concurrent checkout requests for one office open a single payment', async () => {
  const payer = await office();
  const abacate = fakeAbacate();
  const results = await Promise.allSettled(Array.from({ length: 4 }, () => startPlanCheckout(payer, abacate.client)));
  const urls = results.flatMap(result => result.status === 'fulfilled' ? [result.value.url] : []);
  assert.equal(new Set(urls).size, 1);
  for (const result of results) if (result.status === 'rejected') assert.equal(result.reason.status,409);
  assert.equal(abacate.calls.filter(call => call.name === 'createCheckout').length, 1);
  assert.equal(abacate.calls.filter(call => call.name === 'createCustomer').length, 1);
});

test('a provider outage while reading the product never attempts to create it', async () => {
  const payer = await office();
  const abacate = fakeAbacate();
  abacate.client.getProduct = async () => { throw new AbacatePayError(503, 'Unavailable'); };
  await assert.rejects(startPlanCheckout(payer, abacate.client));
  assert.equal(abacate.calls.length, 0);
});

test('checkout creation releases the office transaction before provider calls and fences expired owners', async () => {
  const payer = await office(), fake = fakeAbacate();
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const paused = new Promise<void>(resolve => { release = resolve; });
  const createCustomer = fake.client.createCustomer;
  fake.client.createCustomer = async input => { entered(); await paused; return createCustomer(input); };
  const opening = startPlanCheckout(payer,fake.client);
  const rejected = assert.rejects(opening, /cobrança está sendo preparada/);
  await started;
  try {
    const unlocked = await withTransaction(tx => tx.prepare('SELECT pg_try_advisory_xact_lock(hashtextextended(?,0)) AS acquired').get<{acquired:boolean}>(`billing-checkout:${payer.officeId}`));
    assert.equal(unlocked?.acquired,true);
    await assert.rejects(startPlanCheckout(payer,fake.client), /cobrança está sendo preparada/);
    await testDb.prepare("UPDATE billing_checkout_reservation SET lease_until=CURRENT_TIMESTAMP - interval '1 second' WHERE office_id=?").run(payer.officeId);
    fake.client.createCustomer = createCustomer;
    await startPlanCheckout(payer,fake.client);
  } finally { release(); }
  await rejected;
  assert.equal(fake.calls.filter(call => call.name==='createCheckout').length,1);
});

for (const recurring of [false,true]) test(`a failed local attachment recovers the ${recurring ? 'subscription' : 'one-time'} checkout by its durable externalId`, async t => {
  const payer = await office(), fake = fakeAbacate();
  fake.client.createSubscription = fake.client.createCheckout;
  const suffix = randomUUID().replaceAll('-','');
  const fault = `billing_fault_${suffix}`;
  await testDb.exec(`CREATE FUNCTION ${fault}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.office_id = '${payer.officeId}' THEN RAISE EXCEPTION 'injected attachment failure'; END IF;
    RETURN NEW; END $$;
    CREATE TRIGGER ${fault} BEFORE INSERT ON billing_checkout FOR EACH ROW EXECUTE FUNCTION ${fault}();`);
  t.after(async () => { await testDb.exec(`DROP TRIGGER IF EXISTS ${fault} ON billing_checkout; DROP FUNCTION IF EXISTS ${fault}();`); });
  await assert.rejects(startPlanCheckout(payer,fake.client,{recurring}), /injected attachment failure/);
  assert.ok(await testDb.prepare('SELECT customer_id FROM office_billing WHERE office_id=? AND customer_id IS NOT NULL').get(payer.officeId));
  assert.equal((await billingOverview(payer.officeId)).checkouts.length,0);
  assert.equal((await testDb.prepare('SELECT state FROM billing_checkout_reservation WHERE office_id=?').get<{state:string}>(payer.officeId))?.state,'CREATING');
  const checkout = [...fake.checkouts.values()][0];
  checkout.status = 'PAID';
  await testDb.exec(`DROP TRIGGER ${fault} ON billing_checkout`);
  if (recurring) {
    const sub = {id:`subs_${randomUUID()}`,checkoutId:checkout.id,status:'ACTIVE' as const,amount:19900,devMode:true,updatedAt:new Date().toISOString()};
    fake.client.getSubscription = async () => sub;
    await handleSubscriptionWebhook({id:randomUUID(),event:'subscription.completed',data:{subscription:{id:sub.id},checkout}},fake.client);
  } else {
    await handleBillingWebhook({id:randomUUID(),event:'checkout.completed',data:{checkout}},testDb,fake.client);
  }
  const until = await paidUntil(payer.officeId);
  assert.ok(until);
  await syncPendingCheckouts(payer.officeId,fake.client);
  assert.equal(await paidUntil(payer.officeId),until);
  assert.equal((await billingOverview(payer.officeId)).checkouts[0].id,checkout.id);
  assert.equal(fake.calls.filter(call => call.name==='createCheckout').length,1);
  assert.equal(fake.calls.filter(call => call.name==='createCustomer').length,1);
  if (recurring) assert.equal((await subscriptionsForOffice(payer.officeId)).length,1);
});

test('a lost checkout response is recovered without a second POST and a missing result stays uncertain', async () => {
  const payer = await office(), fake = fakeAbacate();
  const create = fake.client.createCheckout;
  fake.client.createCheckout = async input => { await create(input); throw new AbacatePayError(0,'connection lost'); };
  await assert.rejects(startPlanCheckout(payer,fake.client), /Não foi possível abrir/);
  const find = fake.client.getCheckoutByExternalId;
  fake.client.getCheckoutByExternalId = async () => { throw new AbacatePayError(404,'Billing not found'); };
  await assert.rejects(startPlanCheckout(payer,fake.client), /cobrança está sendo preparada/);
  fake.client.getCheckoutByExternalId = find;
  const recovered = await startPlanCheckout(payer,fake.client);
  assert.equal(recovered.url,[...fake.checkouts.values()][0].url);
  assert.equal(fake.calls.filter(call=>call.name==='createCheckout').length,1);
});

test('old subscription links are reused only until the provider confirms expiration or cancellation', async () => {
  for (const terminal of ['EXPIRED','CANCELLED'] as const) {
    const payer = await office(), fake = fakeAbacate();
    fake.client.createSubscription = fake.client.createCheckout;
    const original = await startPlanCheckout(payer,fake.client,{recurring:true});
    const id = original.url.split('/').pop()!;
    await testDb.prepare("UPDATE billing_checkout SET created_at=CURRENT_TIMESTAMP - interval '30 days' WHERE id=?").run(id);
    assert.equal((await startPlanCheckout(payer,fake.client,{recurring:true})).url,original.url);
    fake.checkouts.get(id)!.status = terminal;
    assert.notEqual((await startPlanCheckout(payer,fake.client,{recurring:true})).url,original.url);
    assert.equal((await subscriptionsForOffice(payer.officeId)).find(row=>row.checkoutId===id)?.status,terminal);
  }
});

test('refresh reconciles later actions after a provider failure but surfaces unexpected errors', async () => {
  const actor = await platformActor(), payer = await office(), fake = fakeAbacate();
  const first = (await startPlanCheckout(payer,fake.client)).url.split('/').pop()!;
  await settleCheckout(first,'PAID');
  const second = (await startPlanCheckout(payer,fake.client)).url.split('/').pop()!;
  await settleCheckout(second,'PAID');
  for (const id of [first,second]) await testDb.prepare("INSERT INTO billing_action(id,office_id,actor_user_id,target_id,action,status) VALUES(?,?,?,?,'refund','UNCERTAIN')").run(randomUUID(),payer.officeId,actor,id);
  const get = fake.client.getCheckout;
  const queried: string[] = [];
  fake.client.getCheckout = async id => {
    queried.push(id);
    if (id===first) throw new AbacatePayError(503,'Unavailable');
    return {...await get(id),status:'REFUNDED'};
  };
  await refreshClientBilling(actor,payer.officeId,fake.client);
  assert.deepEqual(new Set(queried),new Set([first,second]));
  assert.equal((await testDb.prepare('SELECT status FROM billing_action WHERE target_id=?').get<{status:string}>(second))?.status,'SUCCEEDED');
  assert.equal((await testDb.prepare('SELECT status FROM billing_action WHERE target_id=?').get<{status:string}>(first))?.status,'UNCERTAIN');
  fake.client.getCheckout = async () => { throw new Error('unexpected failure'); };
  await assert.rejects(refreshClientBilling(actor,payer.officeId,fake.client), /unexpected failure/);
});

test('a request interrupted before dispatch is resumed once by refresh', async t => {
  const actor = await platformActor(), payer = await office(), fake = fakeAbacate();
  const id = (await startPlanCheckout(payer,fake.client)).url.split('/').pop()!;
  await settleCheckout(id,'PAID');
  let refunds = 0;
  fake.client.refundCheckout = async () => { refunds++; fake.checkouts.get(id)!.status='REFUNDED'; return {id:'refund_1',status:'COMPLETE'}; };
  const fault = `dispatch_fault_${randomUUID().replaceAll('-','')}`;
  await testDb.exec(`CREATE FUNCTION ${fault}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.target_id = '${id}' AND NEW.dispatched_at IS NOT NULL THEN RAISE EXCEPTION 'injected dispatch failure'; END IF;
    RETURN NEW; END $$;
    CREATE TRIGGER ${fault} BEFORE UPDATE ON billing_action FOR EACH ROW EXECUTE FUNCTION ${fault}();`);
  t.after(async () => { await testDb.exec(`DROP TRIGGER IF EXISTS ${fault} ON billing_action; DROP FUNCTION IF EXISTS ${fault}();`); });
  await assert.rejects(clientBillingAction(actor,payer.officeId,id,'refund',fake.client), /injected dispatch failure/);
  assert.equal(refunds,0);
  assert.equal((await testDb.prepare('SELECT status FROM billing_action WHERE target_id=?').get<{status:string}>(id))?.status,'REQUESTED');
  await testDb.exec(`DROP TRIGGER ${fault} ON billing_action`);
  await Promise.all([refreshClientBilling(actor,payer.officeId,fake.client),refreshClientBilling(actor,payer.officeId,fake.client)]);
  assert.equal(refunds,1);
  assert.equal((await testDb.prepare('SELECT status FROM billing_action WHERE target_id=?').get<{status:string}>(id))?.status,'SUCCEEDED');
});

test('refunding a month that starts on the 31st restores the exact prior expiry', async () => {
  const payer = await office();
  const abacate = fakeAbacate();
  const id = (await startPlanCheckout(payer, abacate.client)).url.split('/').pop()!;
  const original = '2030-01-31T12:00:00.000Z';
  await testDb.prepare('UPDATE office_billing SET paid_until = ? WHERE office_id = ?').run(original, payer.officeId);
  await settleCheckout(id, 'PAID');
  assert.equal(new Date((await paidUntil(payer.officeId))!).toISOString(), '2030-02-28T12:00:00.000Z');
  await settleCheckout(id, 'REFUNDED');
  assert.equal(new Date((await paidUntil(payer.officeId))!).toISOString(), original);
});

test('the client rejects an unsuccessful or empty success envelope', async () => {
  for (const envelope of [{ success: false, data: {} }, { success: true, data: null }]) {
    const client = abacatePayClient('test', async () => Response.json(envelope));
    await assert.rejects(client.getCheckout('bill_1'), AbacatePayError);
  }
});

test('webhook route authenticates raw deliveries and credits once, even concurrently', async (t) => {
  const previousSecret = process.env.ABACATEPAY_WEBHOOK_SECRET;
  process.env.ABACATEPAY_WEBHOOK_SECRET = 'local-test-secret';
  t.after(() => {
    if (previousSecret === undefined) delete process.env.ABACATEPAY_WEBHOOK_SECRET;
    else process.env.ABACATEPAY_WEBHOOK_SECRET = previousSecret;
  });
  const payer = await office();
  const other = await office();
  const abacate = fakeAbacate();
  const id = (await startPlanCheckout(payer, abacate.client)).url.split('/').pop()!;
  const body = JSON.stringify({ id: `log_${randomUUID()}`, event: 'checkout.completed', data: { checkout: { id } } });
  const request = (raw = body, signature = signWebhookBody(raw), secret = 'local-test-secret') => new Request(`https://tises.example.test/api/billing/webhook?webhookSecret=${secret}`, {
    method: 'POST', headers: { 'x-webhook-signature': signature }, body: raw,
  });
  assert.equal((await webhookPost(request(body, 'invalid'))).status, 401);
  assert.equal((await webhookPost(request(body, signWebhookBody(body), 'wrong'))).status, 401);
  assert.equal(await paidUntil(payer.officeId), null);
  for (const raw of ['null', '[]', '123', '{']) assert.equal((await webhookPost(request(raw))).status, 400);
  const responses = await Promise.all(Array.from({ length: 4 }, () => webhookPost(request())));
  assert.ok(responses.every(response => response.status === 204));
  const expiry = new Date((await paidUntil(payer.officeId))!);
  assert.ok(Math.abs(expiry.getTime() - monthFrom(new Date()).getTime()) < 60_000);
  assert.equal(await paidUntil(other.officeId), null);
});
