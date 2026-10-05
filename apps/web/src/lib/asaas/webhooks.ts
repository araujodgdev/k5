import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { database, withTransaction, type Transaction } from '@/lib/database';
import { asaasReference } from './charges';
import { asaasWebhookTokenHash } from './service';

const todayInSaoPaulo = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish();
const envelope = z.object({
  id: z.string().min(1).max(200), event: z.string().min(1).max(80),
  payment: z.object({
    id: z.string().min(1).max(100), status: z.string().max(60), value: z.number().nonnegative(), billingType: z.string().max(40).nullish(),
    externalReference: z.string().max(200).nullish(), invoiceUrl: z.string().max(500).nullish(), dueDate: date,
    clientPaymentDate: date, paymentDate: date, confirmedDate: date,
  }).nullish(),
});
type Payment = NonNullable<z.infer<typeof envelope>['payment']>;
type Row = { id: string; installment_id: string; state: string; receipt_id: string | null; amount_cents: number };

const methods: Record<string, 'pix' | 'boleto' | 'card'> = { PIX: 'pix', BOLETO: 'boleto', CREDIT_CARD: 'card', DEBIT_CARD: 'card' };
const undo: Record<string, string> = {
  PAYMENT_REFUNDED: 'Pagamento estornado no Asaas.',
  PAYMENT_CHARGEBACK_REQUESTED: 'Contestação (chargeback) aberta no Asaas.',
  PAYMENT_RECEIVED_IN_CASH_UNDONE: 'Recebimento desfeito no Asaas.',
};
const currency = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Records a confirmed payment as the installment's receipt, once, within the open balance. */
async function paid(tx: Transaction, officeId: string, row: Row, payment: Payment) {
  // A refund or chargeback already arrived: a confirmation delivered later must not record the payment again.
  if (row.receipt_id || row.state === 'refunded') return;
  const agreement = await tx.prepare(`SELECT a.id,a.created_by,a.title,(a.cancelled_at IS NOT NULL) AS cancelled,
    (i.amount_cents-COALESCE((SELECT SUM(r.amount_cents) FROM honorario_receipt r WHERE r.office_id=i.office_id AND r.installment_id=i.id
      AND NOT EXISTS (SELECT 1 FROM honorario_receipt_reversal v WHERE v.office_id=r.office_id AND v.receipt_id=r.id)),0))::bigint AS pending
    FROM honorario_installment i JOIN honorario_agreement a ON a.office_id=i.office_id AND a.id=i.agreement_id
    WHERE i.office_id=? AND i.id=? FOR UPDATE OF a`).get<{ id: string; created_by: string; title: string; cancelled: boolean; pending: number | string }>(officeId, row.installment_id);
  if (!agreement) return;
  const paidCents = Math.round(payment.value * 100);
  const pending = Number(agreement.pending);
  const amount = agreement.cancelled ? 0 : Math.min(paidCents, pending);
  const review = agreement.cancelled ? 'O honorário estava cancelado; o pagamento não foi lançado como recebimento.'
    : amount < paidCents ? `O Asaas confirmou ${currency(paidCents)}, acima do saldo de ${currency(pending)}; só o saldo foi lançado. Confira no Asaas.` : null;
  let receiptId: string | null = null;
  if (amount > 0) {
    receiptId = randomUUID();
    const today = todayInSaoPaulo();
    const day = payment.clientPaymentDate ?? payment.paymentDate ?? payment.confirmedDate ?? today;
    await tx.prepare('INSERT INTO honorario_receipt(id,office_id,installment_id,amount_cents,received_on,method,notes,created_by) VALUES(?,?,?,?,?,?,?,?)')
      .run(receiptId, officeId, row.installment_id, amount, day > today ? today : day, methods[payment.billingType ?? ''] ?? 'other',
        `Pagamento confirmado pelo Asaas (${payment.id}).`, agreement.created_by);
    await tx.prepare(`INSERT INTO notification_event(id,office_id,event_type,payload_version,source_kind,source_id,intended_recipients_json,data_json,dedupe_key,created_at,expires_at)
      VALUES(?,?,'honorarios.charge.paid',1,'honorario',?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP+INTERVAL '7 days') ON CONFLICT(office_id,dedupe_key) DO NOTHING`)
      .run(randomUUID(), officeId, row.installment_id, JSON.stringify([agreement.created_by]), JSON.stringify({ title: agreement.title, amountCents: amount }), `asaas-paid:${row.id}`);
  }
  await tx.prepare(`UPDATE asaas_payment SET state='paid',receipt_id=?,review=? WHERE office_id=? AND id=?`).run(receiptId, review, officeId, row.id);
}

async function reversed(tx: Transaction, officeId: string, row: Row, reason: string) {
  if (row.receipt_id && !await tx.prepare('SELECT 1 FROM honorario_receipt_reversal WHERE office_id=? AND receipt_id=?').get(officeId, row.receipt_id)) {
    const owner = await tx.prepare(`SELECT a.created_by FROM honorario_installment i JOIN honorario_agreement a ON a.office_id=i.office_id AND a.id=i.agreement_id
      WHERE i.office_id=? AND i.id=? FOR UPDATE OF a`).get<{ created_by: string }>(officeId, row.installment_id);
    if (owner) await tx.prepare('INSERT INTO honorario_receipt_reversal(office_id,receipt_id,reason,created_by) VALUES(?,?,?,?)').run(officeId, row.receipt_id, reason, owner.created_by);
  }
  await tx.prepare(`UPDATE asaas_payment SET state='refunded' WHERE office_id=? AND id=?`).run(officeId, row.id);
}

/**
 * Applies one Asaas notification. Returns false when the token belongs to no connected office (401);
 * everything else is acknowledged, so a payment the Lume did not issue never stalls the account's queue.
 * Throws only when the database fails, letting Asaas retry the same event.
 */
export async function handleAsaasWebhook(token: string | null, body: unknown): Promise<boolean> {
  if (!token || token.length < 32 || token.length > 255) return false;
  const connection = await database.prepare('SELECT office_id FROM asaas_connection WHERE webhook_token_hash=?').get<{ office_id: string }>(asaasWebhookTokenHash(token));
  if (!connection) return false;
  const parsed = envelope.safeParse(body);
  if (!parsed.success || !parsed.data.payment) return true;
  const { id: eventId, event, payment } = parsed.data;
  const officeId = connection.office_id;
  await withTransaction(async tx => {
    let row = await tx.prepare(`SELECT id,installment_id,state,receipt_id,amount_cents::int AS amount_cents FROM asaas_payment
      WHERE office_id=? AND provider_payment_id=? FOR UPDATE`).get<Row>(officeId, payment.id);
    // A creation whose answer was lost: Asaas has it, under the reference the Lume chose.
    const reference = payment.externalReference?.startsWith('lume:') ? payment.externalReference.slice(5) : null;
    if (!row && reference && payment.invoiceUrl?.startsWith('https://')) {
      row = await tx.prepare(`UPDATE asaas_payment SET state='open',provider_payment_id=?,provider_status=?,invoice_url=?,lease_until=NULL,updated_at=CURRENT_TIMESTAMP
        WHERE office_id=? AND id=? AND state='creating' RETURNING id,installment_id,state,receipt_id,amount_cents::int AS amount_cents`)
        .get<Row>(payment.id, payment.status, payment.invoiceUrl, officeId, reference);
    }
    if (!row || (payment.externalReference && payment.externalReference !== asaasReference(row.id))) return;
    const fresh = await tx.prepare('INSERT INTO asaas_webhook_event(office_id,id,event,provider_payment_id) VALUES(?,?,?,?) ON CONFLICT DO NOTHING RETURNING id')
      .get(officeId, eventId, event, payment.id);
    if (!fresh) return;
    await tx.prepare('UPDATE asaas_payment SET provider_status=?,updated_at=CURRENT_TIMESTAMP WHERE office_id=? AND id=?').run(payment.status, officeId, row.id);
    if (event === 'PAYMENT_CONFIRMED' || event === 'PAYMENT_RECEIVED') await paid(tx, officeId, row, payment);
    else if (undo[event]) await reversed(tx, officeId, row, undo[event]);
    else if (event === 'PAYMENT_DELETED' && row.state === 'open') await tx.prepare(`UPDATE asaas_payment SET state='cancelled' WHERE office_id=? AND id=?`).run(officeId, row.id);
    else if (event === 'PAYMENT_RESTORED' && row.state === 'cancelled') {
      // Restored only while the installment has no other active charge.
      await tx.prepare(`UPDATE asaas_payment SET state='open' WHERE office_id=? AND id=? AND NOT EXISTS (
        SELECT 1 FROM asaas_payment o WHERE o.office_id=asaas_payment.office_id AND o.installment_id=asaas_payment.installment_id AND o.state IN ('creating','open'))`).run(officeId, row.id);
    } else if (event === 'PAYMENT_UPDATED' && row.state === 'open' && payment.dueDate) {
      await tx.prepare('UPDATE asaas_payment SET due_on=?,amount_cents=? WHERE office_id=? AND id=?').run(payment.dueDate, Math.max(1, Math.round(payment.value * 100)), officeId, row.id);
    }
  });
  return true;
}
