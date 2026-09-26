import 'server-only';
import { randomUUID } from 'node:crypto';
import { database as defaultDatabase, withTransaction, type Database, type Transaction } from '../database';
import { abacatePayClient, AbacatePayError, type AbacatePayClient, type CheckoutStatus } from './abacatepay';

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

export const PLAN_NAME = 'Plano Tises';
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
async function planProduct(client: AbacatePayClient, price: number) {
  const externalId = `tises-plano-mensal-${price}`;
  const products = client === cachedClient ? productIds : new Map<string, Promise<string>>();
  let pending = products.get(externalId);
  if (!pending) {
    pending = client.getProduct(externalId).then(product => product.id, async (error) => {
      if (error instanceof AbacatePayError && error.status === 0) throw error;
      const product = await client.createProduct({ externalId, name: PLAN_NAME, price, description: 'Um mês do Tises para o escritório.' });
      return product.id;
    });
    products.set(externalId, pending);
    pending.catch(() => products.delete(externalId));
  }
  return pending;
}

type Payer = { officeId: string; userId: string; email: string; name: string };

/** Opens (or reuses) a checkout for one month of the plan and returns the page to send the person to. */
export async function startPlanCheckout(payer: Payer, client: AbacatePayClient = billingClient(), db: Database = defaultDatabase) {
  const { price, appUrl } = billingSettings();
  const recent = await db.prepare(`
    SELECT url FROM billing_checkout
    WHERE office_id = ? AND status = 'PENDING' AND amount = ? AND created_at > CURRENT_TIMESTAMP - make_interval(mins => ?)
    ORDER BY created_at DESC LIMIT 1
  `).get<{ url: string }>(payer.officeId, price, REUSE_MINUTES);
  if (recent) return { url: recent.url };

  try {
    const productId = await planProduct(client, price);
    const billing = await db.prepare('SELECT customer_id AS "customerId" FROM office_billing WHERE office_id = ?').get<{ customerId: string | null }>(payer.officeId);
    let customerId = billing?.customerId ?? undefined;
    if (!customerId) {
      customerId = (await client.createCustomer({ email: payer.email, name: payer.name, metadata: { officeId: payer.officeId } })).id;
      await db.prepare(`
        INSERT INTO office_billing (office_id, customer_id) VALUES (?, ?)
        ON CONFLICT (office_id) DO UPDATE SET customer_id = EXCLUDED.customer_id, updated_at = CURRENT_TIMESTAMP
      `).run(payer.officeId, customerId);
    }
    const checkout = await client.createCheckout({
      items: [{ id: productId, quantity: 1 }],
      customerId,
      externalId: randomUUID(),
      returnUrl: `${appUrl}/app/billing`,
      completionUrl: `${appUrl}/app/billing?pagamento=concluido`,
      metadata: { officeId: payer.officeId },
    });
    await db.prepare(`
      INSERT INTO billing_checkout (id, office_id, user_id, product_id, amount, status, url, dev_mode)
      VALUES (?, ?, ?, ?, ?, 'PENDING', ?, ?)
    `).run(checkout.id, payer.officeId, payer.userId, productId, checkout.amount || price, checkout.url, Boolean(checkout.devMode));
    return { url: checkout.url };
  } catch (error) {
    if (error instanceof AbacatePayError) {
      console.error('[billing] AbacatePay recusou a cobrança', error.status, error.message);
      throw new BillingError(502, 'Não foi possível abrir o pagamento agora. Tente novamente em instantes.');
    }
    throw error;
  }
}

async function credit(tx: Transaction, id: string, receiptUrl: string | null) {
  const row = await tx.prepare('SELECT office_id AS "officeId", status FROM billing_checkout WHERE id = ? FOR UPDATE').get<{ officeId: string; status: CheckoutStatus }>(id);
  if (!row || row.status === 'PAID' || row.status === 'REFUNDED') return false;
  await tx.prepare('INSERT INTO office_billing (office_id) VALUES (?) ON CONFLICT (office_id) DO NOTHING').run(row.officeId);
  const billing = await tx.prepare(`
    UPDATE office_billing
    SET paid_until = GREATEST(COALESCE(paid_until, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP) + interval '1 month', updated_at = CURRENT_TIMESTAMP
    WHERE office_id = ? RETURNING paid_until AS "paidUntil"
  `).get<{ paidUntil: string }>(row.officeId);
  await tx.prepare(`
    UPDATE billing_checkout
    SET status = 'PAID', paid_at = CURRENT_TIMESTAMP, receipt_url = COALESCE(?, receipt_url),
        period_end = ?::timestamptz, period_start = ?::timestamptz - interval '1 month'
    WHERE id = ?
  `).run(receiptUrl, billing!.paidUntil, billing!.paidUntil, id);
  return true;
}

async function refund(tx: Transaction, id: string) {
  const row = await tx.prepare('SELECT office_id AS "officeId", status FROM billing_checkout WHERE id = ? FOR UPDATE').get<{ officeId: string; status: CheckoutStatus }>(id);
  if (!row || row.status === 'REFUNDED') return false;
  if (row.status === 'PAID') {
    await tx.prepare(`
      UPDATE office_billing SET paid_until = paid_until - (c.period_end - c.period_start), updated_at = CURRENT_TIMESTAMP
      FROM billing_checkout c WHERE c.id = ? AND office_billing.office_id = c.office_id AND c.period_end IS NOT NULL
    `).run(id);
  }
  await tx.prepare("UPDATE billing_checkout SET status = 'REFUNDED' WHERE id = ?").run(id);
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
  const pending = await db.prepare(`
    SELECT id FROM billing_checkout
    WHERE office_id = ? AND status = 'PENDING' AND created_at > CURRENT_TIMESTAMP - interval '7 days'
    ORDER BY created_at DESC LIMIT 5
  `).all<{ id: string }>(officeId);
  await Promise.all(pending.map(async ({ id }) => {
    try {
      const checkout = await client.getCheckout(id);
      await settleCheckout(id, checkout.status, checkout.receiptUrl ?? null, db);
    } catch (error) {
      // The webhook settles it later; the page still shows the stored status.
      if (!(error instanceof AbacatePayError)) throw error;
    }
  }));
}

type WebhookPayload = { id?: unknown; event?: unknown; data?: { checkout?: { id?: unknown; status?: unknown; receiptUrl?: unknown } } };
const webhookStatus: Record<string, CheckoutStatus> = { 'checkout.completed': 'PAID', 'checkout.refunded': 'REFUNDED' };

/**
 * Handles a verified webhook delivery. Only the fields used are read, as AbacatePay asks, so new
 * fields never break the endpoint. Events about checkouts this app did not open are ignored.
 */
export async function handleBillingWebhook(payload: WebhookPayload, db: Database = defaultDatabase) {
  const eventId = typeof payload.id === 'string' ? payload.id : null;
  const event = typeof payload.event === 'string' ? payload.event : '';
  if (eventId && await db.prepare('SELECT 1 FROM billing_event WHERE id = ?').get(eventId)) return 'duplicate' as const;
  const checkout = payload.data?.checkout;
  const status = webhookStatus[event];
  let outcome: 'applied' | 'ignored' = 'ignored';
  if (status && typeof checkout?.id === 'string') {
    const receipt = typeof checkout.receiptUrl === 'string' ? checkout.receiptUrl : null;
    if (await settleCheckout(checkout.id, status, receipt, db)) outcome = 'applied';
  }
  // Recorded after the work, so a delivery that failed halfway is processed again on retry.
  if (eventId) await db.prepare('INSERT INTO billing_event (id, event) VALUES (?, ?) ON CONFLICT (id) DO NOTHING').run(eventId, event || 'unknown');
  return outcome;
}

export type BillingCheckoutRow = {
  id: string; amount: number; status: CheckoutStatus; createdAt: string; paidAt: string | null;
  receiptUrl: string | null; url: string; periodEnd: string | null;
};

export async function billingOverview(officeId: string, db: Database = defaultDatabase) {
  const { configured, price } = billingSettings();
  const [billing, checkouts] = await Promise.all([
    db.prepare('SELECT paid_until AS "paidUntil" FROM office_billing WHERE office_id = ?').get<{ paidUntil: string | null }>(officeId),
    db.prepare(`
      SELECT id, amount, status, created_at AS "createdAt", paid_at AS "paidAt", receipt_url AS "receiptUrl", url, period_end AS "periodEnd"
      FROM billing_checkout WHERE office_id = ? ORDER BY created_at DESC LIMIT 12
    `).all<BillingCheckoutRow>(officeId),
  ]);
  const paidUntil = billing?.paidUntil ?? null;
  return { configured, price, paidUntil, active: Boolean(paidUntil && new Date(paidUntil) > new Date()), checkouts };
}
