import 'server-only';
import { randomUUID } from 'node:crypto';
import { database, withTransaction } from '../database';
import { assertPlatformAdmin } from '../platform-core';
import { AbacatePayError, type AbacatePayClient } from './abacatepay';
import { BillingError, billingClient, billingOverview, billingSettings, settleCheckout, startPlanCheckout, syncPendingCheckouts, type BillingCheckoutRow } from './office-billing';
import { subscriptionsForOffice, syncOfficeSubscriptions } from './subscriptions';

export type FinancePayment = BillingCheckoutRow & { officeId: string; officeName: string; actionStatus: string | null };
export type FinanceFilters = { sandbox: boolean; days: 30 | 90 | 0; status: string; query: string; page: number };
const paymentFields = `c.id,c.amount,c.status,c.kind,c.url,c.receipt_url AS "receiptUrl",c.dev_mode AS "devMode",c.created_at AS "createdAt",c.paid_at AS "paidAt",c.period_end AS "periodEnd",c.office_id AS "officeId",o.name AS "officeName",
  (SELECT a.status FROM billing_action a WHERE a.target_id = c.id AND a.action = 'refund' AND a.status <> 'FAILED' LIMIT 1) AS "actionStatus"`;

export async function platformFinance(filters: FinanceFilters) {
  const { sandbox, days, status, query, page } = filters;
  const period = `( ? = 0 OR COALESCE(c.paid_at,c.created_at) >= CURRENT_TIMESTAMP - make_interval(days => ?) )`;
  const params = [sandbox, days, days, `%${query}%`];
  const where = `c.dev_mode = ? AND ${period} AND o.name ILIKE ?`;
  const [summary, payments, count, recurring] = await Promise.all([
    database.prepare(`SELECT COALESCE(sum(c.amount) FILTER(WHERE c.status IN ('PAID','REFUNDED')),0)::float8 AS received,
      COALESCE(sum(c.amount) FILTER(WHERE c.status = 'REFUNDED'),0)::float8 AS refunded,
      COALESCE(sum(c.amount) FILTER(WHERE c.status = 'PENDING'),0)::float8 AS pending
      FROM billing_checkout c JOIN office o ON o.id=c.office_id WHERE ${where}`).get<{ received: number; refunded: number; pending: number }>(...params),
    database.prepare(`SELECT ${paymentFields} FROM billing_checkout c JOIN office o ON o.id=c.office_id WHERE ${where} AND (? = '' OR c.status = ?)
      ORDER BY c.created_at DESC,c.id LIMIT 25 OFFSET ?`).all<FinancePayment>(...params,status,status,(page-1)*25),
    database.prepare(`SELECT count(*)::int AS total FROM billing_checkout c JOIN office o ON o.id=c.office_id WHERE ${where} AND (? = '' OR c.status = ?)`)
      .get<{ total: number }>(...params,status,status),
    database.prepare(`SELECT count(*)::int AS count, COALESCE(sum(s.amount),0)::float8 AS amount FROM billing_subscription s JOIN office o ON o.id=s.office_id
      WHERE s.dev_mode = ? AND s.status='ACTIVE' AND o.name ILIKE ?`).get<{ count: number; amount: number }>(sandbox,`%${query}%`),
  ]);
  return { summary: summary!, payments, total: count!.total, recurring: recurring!, filters };
}

export async function platformClientBilling(officeId: string, page = 1) {
  const office = await database.prepare('SELECT id,name,created_at AS "createdAt" FROM office WHERE id = ?').get<{ id: string; name: string; createdAt: string }>(officeId);
  if (!office) throw new BillingError(404, 'Cliente não encontrado.');
  const [members, overview, subscriptions, payments, count, actions] = await Promise.all([
    database.prepare(`SELECT u.id,u.name,u.email,m.role FROM office_member m JOIN "user" u ON u.id=m.user_id WHERE m.office_id=? ORDER BY u.name`)
      .all<{ id: string; name: string; email: string; role: string }>(officeId),
    billingOverview(officeId), subscriptionsForOffice(officeId),
    database.prepare(`SELECT ${paymentFields} FROM billing_checkout c JOIN office o ON o.id=c.office_id WHERE c.office_id=? ORDER BY c.created_at DESC,c.id LIMIT 25 OFFSET ?`).all<FinancePayment>(officeId,(page-1)*25),
    database.prepare('SELECT count(*)::int AS total FROM billing_checkout WHERE office_id=?').get<{ total: number }>(officeId),
    database.prepare(`SELECT a.id,a.target_id AS "targetId",a.action,a.status,a.created_at AS "createdAt",u.name AS "actorName" FROM billing_action a LEFT JOIN "user" u ON u.id=a.actor_user_id
      WHERE a.office_id=? ORDER BY a.created_at DESC LIMIT 10`).all<{ id: string; targetId: string; action: string; status: string; createdAt: string; actorName: string | null }>(officeId),
  ]);
  return { office, members, overview, subscriptions, payments, total: count!.total, page, actions };
}
export type ClientBilling = Awaited<ReturnType<typeof platformClientBilling>>;

export async function createClientCheckout(actorId: string, officeId: string, memberId: string, recurring: boolean, client: AbacatePayClient = billingClient()) {
  await assertPlatformAdmin(database, actorId);
  const member = await database.prepare(`SELECT u.id AS "userId",u.name,u.email FROM office_member m JOIN "user" u ON u.id=m.user_id WHERE m.office_id=? AND m.user_id=? AND m.role='administrator'`)
    .get<{ userId: string; name: string; email: string }>(officeId,memberId);
  if (!member) throw new BillingError(400, 'Selecione um administrador deste cliente como responsável pela cobrança.');
  if (recurring && !billingSettings().webhookSecret) throw new BillingError(503, 'Configure o webhook de assinaturas antes de criar uma assinatura.');
  return startPlanCheckout({ ...member, officeId },client,{ recurring, actorUserId: actorId });
}

export async function clientBillingAction(actorId: string, officeId: string, targetId: string, action: 'refund' | 'cancel', client: AbacatePayClient = billingClient()) {
  await assertPlatformAdmin(database, actorId);
  const operation = await withTransaction(async tx => {
    await tx.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?,0))').get(`billing-action:${action}:${targetId}`);
    const previous = await tx.prepare(`SELECT status FROM billing_action WHERE target_id=? AND action=? AND status <> 'FAILED'`).get<{ status: string }>(targetId,action);
    const target = action === 'refund'
      ? await tx.prepare('SELECT id,status,kind FROM billing_checkout WHERE office_id=? AND id=?').get<{ id: string; status: string; kind: string }>(officeId,targetId)
      : await tx.prepare(`SELECT provider_id AS id,status,'SUBSCRIPTION' AS kind FROM billing_subscription WHERE office_id=? AND provider_id=?`).get<{ id: string; status: string; kind: string }>(officeId,targetId);
    if (!target) throw new BillingError(404, 'Cobrança ou assinatura não encontrada neste cliente.');
    if (previous?.status === 'SUCCEEDED') return null;
    if (previous) throw new BillingError(409, 'A operação já foi solicitada. Atualize os pagamentos para conferir a confirmação antes de tentar novamente.');
    if (action === 'refund' && (target.status !== 'PAID' || target.kind !== 'ONE_TIME')) throw new BillingError(409, 'Somente pagamentos avulsos confirmados podem ser reembolsados pela API.');
    if (action === 'cancel' && target.status !== 'ACTIVE') throw new BillingError(409, 'Esta assinatura não está ativa.');
    const id = randomUUID();
    await tx.prepare('INSERT INTO billing_action(id,office_id,actor_user_id,target_id,action,status) VALUES(?,?,?,?,?,?)').run(id,officeId,actorId,targetId,action,'REQUESTED');
    await tx.prepare(`INSERT INTO platform_audit_log(id,actor_user_id,office_id,action,details_json) VALUES(?,?,?,?,?)`)
      .run(randomUUID(),actorId,officeId,`billing.${action}_requested`,JSON.stringify({ targetId, operationId: id }));
    return id;
  });
  if (!operation) return;
  let accepted = false;
  try {
    if (action === 'refund') {
      await client.refundCheckout(targetId);
      accepted = true;
      const result = await client.getCheckout(targetId);
      await settleCheckout(targetId,result.status,result.receiptUrl ?? null);
      await database.prepare("UPDATE billing_action SET status=CASE WHEN status='SUCCEEDED' THEN status ELSE ? END WHERE id=?").run(result.status === 'REFUNDED' ? 'SUCCEEDED' : 'UNCERTAIN',operation);
    } else {
      await client.cancelSubscription(targetId);
      accepted = true;
      const result = await client.getSubscription(targetId);
      if (result.status === 'CANCELLED') await database.prepare("UPDATE billing_subscription SET status='CANCELLED' WHERE provider_id=? AND office_id=?").run(targetId,officeId);
      await database.prepare("UPDATE billing_action SET status=CASE WHEN status='SUCCEEDED' THEN status ELSE ? END WHERE id=?").run(result.status === 'CANCELLED' ? 'SUCCEEDED' : 'UNCERTAIN',operation);
    }
  } catch (error) {
    // A network error or provider 5xx can follow an accepted charge operation. Never resubmit it.
    const refused = !accepted && error instanceof AbacatePayError && error.status >= 400 && error.status < 500;
    await database.prepare("UPDATE billing_action SET status=CASE WHEN status='SUCCEEDED' THEN status ELSE ? END WHERE id=?").run(refused ? 'FAILED' : 'UNCERTAIN',operation);
    if (refused && error instanceof AbacatePayError && error.message === 'Insufficient permissions') {
      throw new BillingError(503, `A chave da AbacatePay não tem a permissão ${action === 'cancel' ? 'SUBSCRIPTION:DELETE' : 'REFUND:CREATE'}. Peça ao responsável pela integração para configurá-la.`);
    }
    if (refused && error instanceof AbacatePayError && /saldo insuficiente/i.test(error.message)) {
      throw new BillingError(409, 'Saldo insuficiente na AbacatePay para concluir o reembolso. O pagamento foi preservado.');
    }
    throw new BillingError(502, refused ? 'A AbacatePay recusou a operação. Atualize os pagamentos e tente novamente.' : 'A confirmação ainda não chegou. Atualize os pagamentos para consultar o resultado.');
  }
}

export async function refreshClientBilling(actorId: string, officeId: string, client: AbacatePayClient = billingClient()) {
  await assertPlatformAdmin(database,actorId);
  if (!await database.prepare('SELECT id FROM office WHERE id=?').get(officeId)) throw new BillingError(404,'Cliente não encontrado.');
  await syncPendingCheckouts(officeId,client);
  await syncOfficeSubscriptions(officeId,client);
  const operations = await database.prepare(`SELECT id,target_id AS "targetId",action FROM billing_action WHERE office_id=? AND status IN ('REQUESTED','UNCERTAIN')`).all<{ id: string; targetId: string; action: string }>(officeId);
  for (const operation of operations) {
    const result = operation.action === 'refund' ? await client.getCheckout(operation.targetId) : await client.getSubscription(operation.targetId);
    if (result.status === 'REFUNDED' || result.status === 'CANCELLED') {
      if (operation.action === 'refund') await settleCheckout(operation.targetId,'REFUNDED');
      await database.prepare("UPDATE billing_action SET status='SUCCEEDED' WHERE id=?").run(operation.id);
    }
  }
}
