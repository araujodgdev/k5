import 'server-only';
import { randomUUID } from 'node:crypto';
import { database as defaultDatabase, withTransaction, type Database, type Transaction } from '../database';
import { abacatePayClient, AbacatePayError, type AbacateCheckout, type AbacatePayClient, type CheckoutStatus } from './abacatepay';
import { creditSettings, postCredits } from './credits';
import { MILLI, type CreditPackage } from './credit-pricing';

/*
 * The office's monthly plan. A payment is a one-time AbacatePay checkout for the plan product; once
 * paid it adds one month to `office_billing.paid_until`, counted from the end of the current month
 * when the plan is still active, so paying early never loses days. The status is only shown for now:
 * nothing in the app is blocked while unpaid.
 *
 * A checkout is settled from two directions, whichever arrives first: the signed webhook
 * (`checkout.completed`, `checkout.refunded`) and a read of the pending checkouts when the billing
 * page opens, which is also what makes the flow work locally, where no webhook can reach us.
 */

export const PLAN_NAME = 'Plano Lume';
const DEFAULT_PRICE = 19_900;
/** A pending checkout is reused for this long instead of opening another. */
const REUSE_MINUTES = 30;

export class BillingError extends Error {
  constructor(public status: number, message: string) { super(message); this.name = 'BillingError'; }
}

export function billingSettings() {
  const apiKey = process.env.ABACATEPAY_API_KEY?.trim() || '';
  const parsed = Number(process.env.BILLING_PLAN_PRICE_CENTS);
  const price = Number.isInteger(parsed) && parsed >= 100 ? parsed : DEFAULT_PRICE;
  return {
    configured: Boolean(apiKey),
    apiKey,
    webhookSecret: process.env.ABACATEPAY_WEBHOOK_SECRET?.trim() || '',
    price,
    appUrl: (process.env.BETTER_AUTH_URL || 'http://localhost:3000').replace(/\/+$/, ''),
  };
}

let cachedClient: AbacatePayClient | undefined;
let cachedKey = '';
export function billingClient(): AbacatePayClient {
  const { apiKey } = billingSettings();
  if (!apiKey) throw new BillingError(503, 'Os pagamentos ainda não foram configurados neste ambiente.');
  if (!cachedClient || cachedKey !== apiKey) {
    cachedClient = abacatePayClient(apiKey);
    cachedKey = apiKey;
    productIds.clear();
  }
  return cachedClient;
}

// The product is found by its externalId, which carries the price: a new price is a new product,
// and checkouts already opened keep the price they were opened with.
const productIds = new Map<string, Promise<string>>();
type ProductSpec = { externalId: string; name: string; price: number; description: string; cycle?: 'MONTHLY' };
function productFor(price: number, kind: CheckoutKind, credits: number | null): ProductSpec {
  if (kind === 'CREDITS') return { externalId: `lume-creditos-${credits}-${price}`, name: `${credits} créditos Lume`, price, description: `${credits} créditos para a IA do Lume.` };
  const recurring = kind === 'SUBSCRIPTION';
  return { externalId: `tises-${recurring ? 'assinatura' : 'plano'}-mensal-${price}`, name: PLAN_NAME, price,
    description: recurring ? 'Assinatura mensal do Lume.' : 'Um mês do Lume para o escritório.', ...(recurring ? { cycle: 'MONTHLY' as const } : {}) };
}
async function planProduct(client: AbacatePayClient, spec: ProductSpec) {
  const { externalId } = spec;
  const products = client === cachedClient ? productIds : new Map<string, Promise<string>>();
  let pending = products.get(externalId);
  if (!pending) {
    pending = client.getProduct(externalId).then(product => product.id, async (error) => {
      // v2 currently returns 400 with this message for a missing product.
      if (!(error instanceof AbacatePayError) || !(error.status === 404 || (error.status === 400 && error.message === 'Product not found'))) throw error;
      const product = await client.createProduct(spec);
      return product.id;
    });
    products.set(externalId, pending);
    pending.catch(() => products.delete(externalId));
  }
  return pending;
}

type Payer = { officeId: string; userId: string; email: string; name: string };

type CheckoutKind = 'ONE_TIME' | 'SUBSCRIPTION' | 'CREDITS';
type CheckoutReservation = { id: string; officeId: string; userId: string | null; actorUserId: string | null; kind: string; amount: number; productId: string | null; state: string; credits: number | null };
const reservationFields = `id, office_id AS "officeId", user_id AS "userId", actor_user_id AS "actorUserId", kind, amount, product_id AS "productId", state, credits`;
const creationPending = () => new BillingError(409, 'Uma cobrança está sendo preparada ou aguardando confirmação. Atualize os pagamentos antes de tentar novamente.');
const checkoutFence = (officeId: string) => `billing-checkout:${officeId}`;

/** This transaction contains only local writes; externalId survives an insert/commit failure. */
async function attachReservedCheckout(reservation: CheckoutReservation, checkout: AbacateCheckout) {
  if (!reservation.productId || checkout.externalId !== reservation.id) throw new Error('Checkout reservation mismatch');
  await withTransaction(async tx => {
    // Publish under the same office fence that decides whether to open a checkout. A caller
    // that already observed "no pending checkout" must still see this reservation as inflight.
    await tx.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))').get(checkoutFence(reservation.officeId));
    const current = await tx.prepare('SELECT state FROM billing_checkout_reservation WHERE id=? FOR UPDATE').get<{ state: string }>(reservation.id);
    if (current?.state === 'COMPLETED') return;
    if (current?.state !== 'CREATING') throw new Error('Checkout reservation is not dispatched');
    await tx.prepare(`INSERT INTO billing_checkout(id,office_id,user_id,product_id,amount,status,url,dev_mode,kind,credits)
      VALUES(?,?,?,?,?,'PENDING',?,?,?,?)`).run(checkout.id,reservation.officeId,reservation.userId,reservation.productId,checkout.amount || reservation.amount,checkout.url,checkout.devMode,reservation.kind,reservation.credits);
    if (reservation.kind === 'SUBSCRIPTION') await tx.prepare(`INSERT INTO billing_subscription(id,checkout_id,office_id,amount,dev_mode) VALUES(?,?,?,?,?)`)
      .run(randomUUID(),checkout.id,reservation.officeId,checkout.amount || reservation.amount,checkout.devMode);
    if (reservation.kind === 'SUBSCRIPTION' && ['CANCELLED','EXPIRED'].includes(checkout.status)) {
      await tx.prepare('UPDATE billing_subscription SET status=? WHERE checkout_id=?').run(checkout.status,checkout.id);
    }
    if (reservation.actorUserId) await tx.prepare(`INSERT INTO platform_audit_log(id,actor_user_id,office_id,action,details_json) VALUES(?,?,?,?,?)`)
      .run(randomUUID(),reservation.actorUserId,reservation.officeId,'billing.checkout_created',JSON.stringify({ checkoutId: checkout.id, kind: reservation.kind, amount: checkout.amount, devMode: checkout.devMode }));
    await tx.prepare("UPDATE billing_checkout_reservation SET state='COMPLETED',checkout_id=? WHERE id=?").run(checkout.id,reservation.id);
  });
  await settleCheckout(checkout.id,checkout.status,checkout.receiptUrl ?? null);
}

/** Recover a provider resource after a lost response or rolled-back attachment, without a POST. */
async function recoverCheckoutReservations(officeId: string, client: AbacatePayClient) {
  const reservations = await defaultDatabase.prepare(`SELECT ${reservationFields} FROM billing_checkout_reservation WHERE office_id=? AND state='CREATING'`).all<CheckoutReservation>(officeId);
  for (const reservation of reservations) {
    try {
      const checkout = await (reservation.kind === 'SUBSCRIPTION' ? client.getSubscriptionCheckoutByExternalId : client.getCheckoutByExternalId)(reservation.id);
      await attachReservedCheckout(reservation,checkout);
    } catch (error) {
      // Even a not-found result does not prove that an interrupted POST was never accepted.
      if (!(error instanceof AbacatePayError)) throw error;
    }
  }
}

/** Verified webhooks can restore the local association before applying a payment. */
export async function recoverReservedCheckout(id: string, recurring: boolean, client?: AbacatePayClient) {
  if (await defaultDatabase.prepare('SELECT 1 FROM billing_checkout WHERE id=?').get(id)) return;
  // One-time payments are a month or a credit package; both open a plain checkout.
  const kinds = recurring ? ['SUBSCRIPTION'] : ['ONE_TIME','CREDITS'];
  if (!await defaultDatabase.prepare("SELECT 1 FROM billing_checkout_reservation WHERE state='CREATING' AND kind = ANY(?::text[]) LIMIT 1").get(kinds)) return;
  client ??= billingClient();
  const checkout = await (recurring ? client.getSubscriptionCheckout : client.getCheckout)(id);
  if (!checkout.externalId) return;
  const reservation = await defaultDatabase.prepare(`SELECT ${reservationFields} FROM billing_checkout_reservation WHERE id=? AND kind = ANY(?::text[]) AND state='CREATING'`).get<CheckoutReservation>(checkout.externalId,kinds);
  if (reservation) await attachReservedCheckout(reservation,checkout);
}

/** Opens (or reuses) a checkout for a package of credits and returns the page to send the person to. */
export async function startCreditsCheckout(payer: Payer, credits: CreditPackage, client: AbacatePayClient = billingClient()) {
  return startPlanCheckout(payer, client, { credits });
}

/** Opens (or reuses) a checkout for one month of the plan and returns the page to send the person to. */
export async function startPlanCheckout(payer: Payer, client: AbacatePayClient = billingClient(), options: { recurring?: boolean; actorUserId?: string; credits?: CreditPackage } = {}) {
  if (options.recurring) await syncPendingCheckouts(payer.officeId,client);
  else await recoverCheckoutReservations(payer.officeId,client);
  const credits = options.credits ?? null;
  const { appUrl } = billingSettings();
  const price = credits ? credits * (await creditSettings()).creditPriceCents : billingSettings().price;
  const kind: CheckoutKind = credits ? 'CREDITS' : options.recurring ? 'SUBSCRIPTION' : 'ONE_TIME';
  const ownerToken = randomUUID();
  const selected = await withTransaction(async db => {
    await db.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))').get(checkoutFence(payer.officeId));
    if (options.recurring) {
      const existing = await db.prepare(`SELECT s.status, c.url FROM billing_subscription s JOIN billing_checkout c ON c.id = s.checkout_id
        WHERE s.office_id = ? AND s.status IN ('PENDING','ACTIVE') ORDER BY (s.status='ACTIVE') DESC,s.created_at DESC LIMIT 1`).get<{ status: string; url: string }>(payer.officeId);
      if (existing?.status === 'ACTIVE') throw new BillingError(409, 'Este cliente já tem uma assinatura ativa.');
      if (existing) return { url: existing.url };
    }
    // Only a preparation that never dispatched a checkout may expire. Its old owner
    // must still pass the token check before dispatching after a slow provider call.
    await db.prepare("UPDATE billing_checkout_reservation SET state='FAILED' WHERE office_id=? AND state='PREPARING' AND lease_until < CURRENT_TIMESTAMP").run(payer.officeId);
    // One snapshot: a checkout published by another caller commits together with the
    // reservation leaving CREATING, so the two facts cannot be observed apart.
    const gate = await db.prepare(`
      SELECT
        (SELECT url FROM billing_checkout
          WHERE office_id = ? AND kind = ? AND status = 'PENDING' AND amount = ? AND created_at > CURRENT_TIMESTAMP - make_interval(mins => ?)
          ORDER BY created_at DESC LIMIT 1) AS url,
        EXISTS (SELECT 1 FROM billing_checkout_reservation WHERE office_id = ? AND state IN ('PREPARING','CREATING')) AS inflight
    `).get<{ url: string | null; inflight: boolean }>(payer.officeId, kind, price, REUSE_MINUTES, payer.officeId);
    if (gate?.url) return { url: gate.url };
    if (gate?.inflight) throw creationPending();
    const id = randomUUID();
    await db.prepare(`INSERT INTO billing_checkout_reservation(id,office_id,user_id,actor_user_id,kind,amount,state,owner_token,lease_until,credits)
      VALUES(?,?,?,?,?,?,'PREPARING',?,CURRENT_TIMESTAMP + interval '5 minutes',?)`).run(id,payer.officeId,payer.userId,options.actorUserId ?? null,kind,price,ownerToken,credits);
    return { reservation: { id, officeId: payer.officeId, userId: payer.userId, actorUserId: options.actorUserId ?? null, kind, amount: price, productId: null, state: 'PREPARING', credits } as CheckoutReservation };
  });
  if ('url' in selected) return { url: selected.url! };
  const reservation = selected.reservation;
  let dispatched = false;
  let accepted = false;
  try {
      const productId = await planProduct(client, productFor(price, kind, credits));
      const billing = await defaultDatabase.prepare('SELECT customer_id AS "customerId" FROM office_billing WHERE office_id = ?').get<{ customerId: string | null }>(payer.officeId);
      let customerId = billing?.customerId ?? undefined;
      if (!customerId) {
        customerId = (await client.createCustomer({ email: payer.email, name: payer.name, metadata: { officeId: payer.officeId } })).id;
        await defaultDatabase.prepare(`
          INSERT INTO office_billing (office_id, customer_id) VALUES (?, ?)
          ON CONFLICT (office_id) DO UPDATE SET customer_id = COALESCE(office_billing.customer_id, EXCLUDED.customer_id), updated_at = CURRENT_TIMESTAMP
        `).run(payer.officeId, customerId);
      }
      reservation.productId = productId;
      const claimed = await defaultDatabase.prepare(`UPDATE billing_checkout_reservation SET state='CREATING',product_id=?
        WHERE id=? AND owner_token=? AND state='PREPARING' AND lease_until > CURRENT_TIMESTAMP`).run(productId,reservation.id,ownerToken);
      if (!claimed.changes) throw creationPending();
      dispatched = true;
      const checkout = await (options.recurring ? client.createSubscription : client.createCheckout)({
        items: [{ id: productId, quantity: 1 }],
        customerId,
        externalId: reservation.id,
        returnUrl: `${appUrl}/app/billing`,
        completionUrl: `${appUrl}/app/billing?pagamento=concluido`,
        metadata: { officeId: payer.officeId },
      });
      accepted = true;
      await attachReservedCheckout(reservation,checkout);
      return { url: checkout.url };
    } catch (error) {
      const refused = !accepted && error instanceof AbacatePayError && error.status >= 400 && error.status < 500;
      if (!dispatched || refused) await defaultDatabase.prepare("UPDATE billing_checkout_reservation SET state='FAILED' WHERE id=? AND owner_token=? AND state IN ('PREPARING','CREATING')").run(reservation.id,ownerToken);
      if (error instanceof AbacatePayError) {
        console.error('[billing] AbacatePay recusou a cobrança', error.status, error.message);
        throw new BillingError(502, 'Não foi possível abrir o pagamento agora. Tente novamente em instantes.');
      }
      throw error;
    }
}

export async function credit(tx: Transaction, id: string, receiptUrl: string | null) {
  const row = await tx.prepare('SELECT office_id AS "officeId", status, kind, credits, user_id AS "userId" FROM billing_checkout WHERE id = ? FOR UPDATE')
    .get<{ officeId: string; status: CheckoutStatus; kind: CheckoutKind; credits: number | null; userId: string | null }>(id);
  if (!row || row.status === 'PAID' || row.status === 'REFUNDED') return false;
  if (row.kind === 'CREDITS') {
    await tx.prepare(`UPDATE billing_checkout SET status = 'PAID', paid_at = CURRENT_TIMESTAMP, receipt_url = COALESCE(?, receipt_url) WHERE id = ?`).run(receiptUrl, id);
    await postCredits(tx, { officeId: row.officeId, userId: row.userId, kind: 'purchase', amount: row.credits! * MILLI, reference: `purchase:${id}`, description: `Pacote de ${row.credits} créditos` });
    return true;
  }
  // Every paid month, one-time or renewed, brings the plan's credits; unused credits carry over.
  const { planMonthlyCredits } = await creditSettings(tx);
  if (planMonthlyCredits) await postCredits(tx, { officeId: row.officeId, userId: row.userId, kind: 'plan', amount: planMonthlyCredits * MILLI, reference: `plan:${id}`, description: 'Créditos do mês do plano' });
  await tx.prepare('INSERT INTO office_billing (office_id) VALUES (?) ON CONFLICT (office_id) DO NOTHING').run(row.officeId);
  const period = await tx.prepare(`
    SELECT GREATEST(COALESCE(paid_until, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP) AS start
    FROM office_billing WHERE office_id = ? FOR UPDATE
  `).get<{ start: string }>(row.officeId);
  const billing = await tx.prepare(`
    UPDATE office_billing
    SET paid_until = ?::timestamptz + interval '1 month', updated_at = CURRENT_TIMESTAMP
    WHERE office_id = ? RETURNING paid_until AS "paidUntil"
  `).get<{ paidUntil: string }>(period!.start, row.officeId);
  await tx.prepare(`
    UPDATE billing_checkout
    SET status = 'PAID', paid_at = CURRENT_TIMESTAMP, receipt_url = COALESCE(?, receipt_url),
        period_end = ?::timestamptz, period_start = ?::timestamptz
    WHERE id = ?
  `).run(receiptUrl, billing!.paidUntil, period!.start, id);
  return true;
}

async function refund(tx: Transaction, id: string) {
  const row = await tx.prepare('SELECT office_id AS "officeId", status FROM billing_checkout WHERE id = ? FOR UPDATE').get<{ officeId: string; status: CheckoutStatus }>(id);
  if (!row || row.status === 'REFUNDED') return false;
  if (row.status === 'PAID') {
    // The credits the payment brought go back with it, even when that leaves the balance negative.
    const granted = await tx.prepare(`SELECT amount::float8 AS amount FROM credit_entry WHERE reference IN (?, ?)`).get<{ amount: number }>(`plan:${id}`, `purchase:${id}`);
    if (granted) await postCredits(tx, { officeId: row.officeId, kind: 'refund', amount: -granted.amount, reference: `refund:${id}`, description: 'Créditos do pagamento reembolsado' });
    await tx.prepare(`
      UPDATE office_billing SET paid_until = paid_until - (c.period_end - c.period_start), updated_at = CURRENT_TIMESTAMP
      FROM billing_checkout c WHERE c.id = ? AND office_billing.office_id = c.office_id AND c.period_end IS NOT NULL
    `).run(id);
  }
  await tx.prepare("UPDATE billing_checkout SET status = 'REFUNDED' WHERE id = ?").run(id);
  await tx.prepare("UPDATE billing_action SET status = 'SUCCEEDED' WHERE target_id = ? AND action = 'refund' AND status IN ('REQUESTED','UNCERTAIN')").run(id);
  return true;
}

/** Applies a status read from AbacatePay. Idempotent: a month is credited, or removed, once. */
export async function settleCheckout(id: string, status: CheckoutStatus, receiptUrl: string | null = null, db: Database = defaultDatabase) {
  if (status === 'PAID') return withTransaction(tx => credit(tx, id, receiptUrl));
  if (status === 'REFUNDED') return withTransaction(tx => refund(tx, id));
  if (status === 'EXPIRED' || status === 'CANCELLED') {
    return (await db.prepare("UPDATE billing_checkout SET status = ? WHERE id = ? AND status = 'PENDING'").run(status, id)).changes > 0;
  }
  return false;
}

/** Reads the office's recent pending checkouts from AbacatePay, for when the person comes back. */
export async function syncPendingCheckouts(officeId: string, client: AbacatePayClient = billingClient(), db: Database = defaultDatabase) {
  await recoverCheckoutReservations(officeId,client);
  const pending = await db.prepare(`
    SELECT id, kind FROM billing_checkout
    WHERE office_id = ? AND status = 'PENDING' AND (kind='SUBSCRIPTION' OR created_at > CURRENT_TIMESTAMP - interval '7 days')
    ORDER BY created_at DESC
  `).all<{ id: string; kind: string }>(officeId);
  await Promise.all(pending.map(async ({ id, kind }) => {
    try {
      const checkout = await (kind === 'SUBSCRIPTION' ? client.getSubscriptionCheckout(id) : client.getCheckout(id));
      await settleCheckout(id, checkout.status, checkout.receiptUrl ?? null, db);
      if (kind === 'SUBSCRIPTION' && ['EXPIRED', 'CANCELLED'].includes(checkout.status)) await db.prepare("UPDATE billing_subscription SET status = ? WHERE checkout_id = ? AND status = 'PENDING'").run(checkout.status, id);
    } catch (error) {
      // The webhook settles it later; the page still shows the stored status.
      if (!(error instanceof AbacatePayError)) throw error;
    }
  }));
}

export type WebhookPayload = { id?: unknown; event?: unknown; devMode?: unknown; data?: { subscription?: { id?: unknown; updatedAt?: unknown }; checkout?: { id?: unknown; status?: unknown; receiptUrl?: unknown; amount?: unknown; url?: unknown }; payment?: { id?: unknown; status?: unknown } } };
const webhookStatus: Record<string, CheckoutStatus> = { 'checkout.completed': 'PAID', 'checkout.refunded': 'REFUNDED' };

/**
 * Handles a verified webhook delivery. Only the fields used are read, as AbacatePay asks, so new
 * fields never break the endpoint. Events about checkouts this app did not open are ignored.
 */
export async function handleBillingWebhook(payload: WebhookPayload, db: Database = defaultDatabase, client?: AbacatePayClient) {
  const eventId = typeof payload.id === 'string' ? payload.id : null;
  const event = typeof payload.event === 'string' ? payload.event : '';
  if (eventId && await db.prepare('SELECT 1 FROM billing_event WHERE id = ?').get(eventId)) return 'duplicate' as const;
  if (event.startsWith('subscription.')) {
    const { handleSubscriptionWebhook } = await import('./subscriptions');
    return handleSubscriptionWebhook(payload);
  }
  const checkout = payload.data?.checkout;
  const status = webhookStatus[event];
  let outcome: 'applied' | 'ignored' = 'ignored';
  if (status && typeof checkout?.id === 'string') {
    await recoverReservedCheckout(checkout.id,false,client);
    const receipt = typeof checkout.receiptUrl === 'string' ? checkout.receiptUrl : null;
    if (await settleCheckout(checkout.id, status, receipt, db)) outcome = 'applied';
  }
  // Recorded after the work, so a delivery that failed halfway is processed again on retry.
  if (eventId) await db.prepare('INSERT INTO billing_event (id, event) VALUES (?, ?) ON CONFLICT (id) DO NOTHING').run(eventId, event || 'unknown');
  return outcome;
}

export type BillingCheckoutRow = {
  id: string; amount: number; status: CheckoutStatus; createdAt: string; paidAt: string | null;
  receiptUrl: string | null; url: string; periodEnd: string | null; kind: CheckoutKind; devMode: boolean; credits: number | null;
};

export async function billingOverview(officeId: string, db: Database = defaultDatabase) {
  const { configured, price } = billingSettings();
  const [billing, checkouts] = await Promise.all([
    db.prepare('SELECT paid_until AS "paidUntil" FROM office_billing WHERE office_id = ?').get<{ paidUntil: string | null }>(officeId),
    db.prepare(`
      SELECT id, amount, status, created_at AS "createdAt", paid_at AS "paidAt", receipt_url AS "receiptUrl", url, period_end AS "periodEnd", kind, dev_mode AS "devMode", credits
      FROM billing_checkout WHERE office_id = ? ORDER BY created_at DESC LIMIT 12
    `).all<BillingCheckoutRow>(officeId),
  ]);
  const paidUntil = billing?.paidUntil ?? null;
  return { configured, price, paidUntil, active: Boolean(paidUntil && new Date(paidUntil) > new Date()), checkouts };
}
