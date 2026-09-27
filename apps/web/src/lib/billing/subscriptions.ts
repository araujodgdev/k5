import 'server-only';
import { randomUUID } from 'node:crypto';
import { database, withTransaction, type Transaction } from '../database';
import { billingClient, credit, type WebhookPayload } from './office-billing';
import type { AbacatePayClient, AbacateSubscription } from './abacatepay';

type Subscription = { id: string; checkoutId: string; officeId: string; providerId: string | null; status: string; amount: number; devMode: boolean; paymentFailed: boolean };
export type SubscriptionView = Subscription;
const selection = `id, checkout_id AS "checkoutId", office_id AS "officeId", provider_id AS "providerId", status, amount, dev_mode AS "devMode", payment_failed AS "paymentFailed"`;

export async function subscriptionsForOffice(officeId: string) {
  return database.prepare(`SELECT ${selection} FROM billing_subscription WHERE office_id = ? ORDER BY created_at DESC`).all<Subscription>(officeId);
}

async function bindSubscription(tx: Transaction, provider: AbacateSubscription) {
  const original = await tx.prepare(`SELECT office_id AS "officeId", amount, dev_mode AS "devMode" FROM billing_checkout WHERE id = ? AND kind = 'SUBSCRIPTION'`).get<{ officeId: string; amount: number; devMode: boolean }>(provider.checkoutId);
  if (!original || original.devMode !== provider.devMode) return null;
  let row = await tx.prepare(`SELECT ${selection} FROM billing_subscription WHERE provider_id = ?`).get<Subscription>(provider.id);
  if (row && row.checkoutId !== provider.checkoutId) throw new Error('Subscription checkout mismatch');
  if (!row) {
    const pending = await tx.prepare('SELECT id FROM billing_subscription WHERE checkout_id = ? AND provider_id IS NULL FOR UPDATE').get<{ id: string }>(provider.checkoutId);
    if (pending) await tx.prepare('UPDATE billing_subscription SET provider_id = ? WHERE id = ?').run(provider.id, pending.id);
    else await tx.prepare(`INSERT INTO billing_subscription(id, checkout_id, office_id, provider_id, amount, dev_mode) VALUES(?,?,?,?,?,?)`)
      .run(randomUUID(), provider.checkoutId, original.officeId, provider.id, original.amount, original.devMode);
    row = await tx.prepare(`SELECT ${selection} FROM billing_subscription WHERE provider_id = ?`).get<Subscription>(provider.id);
  }
  await tx.prepare('UPDATE billing_checkout SET subscription_id=COALESCE(subscription_id,?) WHERE id=?').run(provider.id,provider.checkoutId);
  return row!;
}

/** A provider ID is bound only through a checkout created by Tises, never by customer/metadata. */
export async function syncOfficeSubscriptions(officeId: string, client: AbacatePayClient = billingClient()) {
  const rows = await subscriptionsForOffice(officeId);
  for (const checkoutId of new Set(rows.map(row => row.checkoutId))) {
    const providers = await client.listCheckoutSubscriptions(checkoutId);
    for (const provider of providers) {
      if (provider.checkoutId !== checkoutId) continue;
      await withTransaction(async tx => {
        await tx.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))').get(`subscription:${provider.id}`);
        const row = await bindSubscription(tx, provider);
        if (row) await tx.prepare(`UPDATE billing_subscription SET status = CASE WHEN status = 'CANCELLED' THEN status ELSE ? END WHERE id = ?`).run(provider.status, row.id);
      });
    }
  }
}

export async function handleSubscriptionWebhook(payload: WebhookPayload, client: AbacatePayClient = billingClient()) {
  const event = payload.event;
  if (!['subscription.completed', 'subscription.renewed', 'subscription.cancelled', 'subscription.payment_failed'].includes(String(event))) return 'ignored' as const;
  const sub = payload.data?.subscription;
  if (typeof sub?.id !== 'string' || typeof payload.id !== 'string') throw new Error('Missing subscription event identity');
  const provider = await client.getSubscription(sub.id);
  return withTransaction(async tx => {
    await tx.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))').get(`subscription:${sub.id}`);
    if (await tx.prepare('SELECT 1 FROM billing_event WHERE id = ?').get(payload.id)) return 'duplicate' as const;
    const row = await bindSubscription(tx, provider);
    if (!row) return 'ignored' as const;
    const cancelled = event === 'subscription.cancelled' || provider.status === 'CANCELLED';
    const timestamp = typeof sub.updatedAt === 'string' && Number.isFinite(Date.parse(sub.updatedAt)) ? sub.updatedAt : provider.updatedAt;
    await tx.prepare(`UPDATE billing_subscription SET
      status = CASE WHEN status = 'CANCELLED' OR ? THEN 'CANCELLED' ELSE 'ACTIVE' END,
      payment_failed = ?, last_event_at = ?::timestamptz
      WHERE id = ? AND (last_event_at IS NULL OR last_event_at <= ?::timestamptz OR ?)`)
      .run(cancelled, event === 'subscription.payment_failed', timestamp, row.id, timestamp, cancelled);
    if (cancelled) await tx.prepare("UPDATE billing_action SET status='SUCCEEDED' WHERE target_id=? AND action='cancel' AND status IN ('REQUESTED','UNCERTAIN')").run(provider.id);
    if (event === 'subscription.completed' || event === 'subscription.renewed') {
      const checkout = payload.data?.checkout;
      if (typeof checkout?.id !== 'string' || checkout.status !== 'PAID' || !Number.isInteger(checkout.amount) || Number(checkout.amount) <= 0) throw new Error('Missing paid subscription checkout');
      const origin = await tx.prepare('SELECT product_id AS "productId", url, subscription_id AS "subscriptionId" FROM billing_checkout WHERE id = ?').get<{ productId: string; url: string; subscriptionId: string }>(row.checkoutId);
      const paymentId = typeof payload.data?.payment?.id === 'string' ? payload.data.payment.id : null;
      const anotherInitialPayment = checkout.id === row.checkoutId && origin!.subscriptionId !== provider.id;
      if (anotherInitialPayment && !paymentId) throw new Error('Missing shared checkout payment identity');
      const targetId = anotherInitialPayment ? paymentId! : checkout.id;
      await tx.prepare(`INSERT INTO billing_checkout(id,office_id,product_id,amount,status,url,dev_mode,kind,subscription_checkout_id,subscription_id,payment_id)
        VALUES(?,?,?,?,'PENDING',?,?,'SUBSCRIPTION',?,?,?) ON CONFLICT DO NOTHING`)
        .run(targetId, row.officeId, origin!.productId, checkout.amount, typeof checkout.url === 'string' ? checkout.url : origin!.url, row.devMode, row.checkoutId,provider.id,paymentId);
      const target = await tx.prepare('SELECT office_id AS "officeId", kind,subscription_id AS "subscriptionId" FROM billing_checkout WHERE id = ?').get<{ officeId: string; kind: string; subscriptionId: string | null }>(targetId);
      if (target?.officeId !== row.officeId || target.kind !== 'SUBSCRIPTION' || (target.subscriptionId && target.subscriptionId !== provider.id)) throw new Error('Subscription payment mismatch');
      await tx.prepare('UPDATE billing_checkout SET subscription_id=?,payment_id=COALESCE(payment_id,?) WHERE id=?').run(provider.id,paymentId,targetId);
      await credit(tx, targetId, typeof checkout.receiptUrl === 'string' ? checkout.receiptUrl : null);
    }
    await tx.prepare('INSERT INTO billing_event(id,event) VALUES(?,?) ON CONFLICT DO NOTHING').run(payload.id, event);
    return 'applied' as const;
  });
}
