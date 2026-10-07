import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { withTransaction, type Transaction } from '@/lib/database';
import { assertCapabilityAllowed, type WorkspaceContext } from '@/lib/application/context';
import { CapabilityError } from '@/lib/capabilities/errors';
import * as contract from './charges-contract';
import { openAsaasInvoiceUrl } from '@/lib/asaas/charges';

const missing = () => new CapabilityError('NOT_FOUND', 'Cobrança não encontrada.');
const conflict = (message: string) => new CapabilityError('CONFLICT', message);
const currency = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const ASAAS_LINE = 'Pague pelo link (PIX, boleto ou cartão): ';

/** Puts the installment's open Asaas link in the message, replacing any earlier one, so a replay never shows a stale link. */
async function withAsaasLink(tx: Transaction, context: WorkspaceContext, installmentId: string, message: string) {
  const url = await openAsaasInvoiceUrl(tx, context.officeId, installmentId);
  const lines = message.split('\n').filter(line => !line.startsWith(ASAAS_LINE));
  if (url) {
    const beneficiary = lines.findIndex(line => line.startsWith('Beneficiário informado: '));
    lines.splice(beneficiary + 1, 0, `${ASAAS_LINE}${url}`);
  }
  return lines.join('\n');
}

async function owner(tx: Transaction, context: WorkspaceContext, installmentId: string, lock = false) {
  const row = await tx.prepare(`SELECT a.id,a.cancelled_at,o.name AS office_name,u.name AS beneficiary_name
    FROM honorario_installment i JOIN honorario_agreement a ON a.office_id=i.office_id AND a.id=i.agreement_id
    JOIN office o ON o.id=a.office_id JOIN "user" u ON u.id=a.created_by
    WHERE i.office_id=? AND i.id=? AND a.created_by=? ${lock ? 'FOR UPDATE OF a' : ''}`)
    .get<{ id: string; cancelled_at: string | null; office_name: string; beneficiary_name: string }>(context.officeId, installmentId, context.userId);
  if (!row) throw missing();
  return row;
}

async function view(tx: Transaction, context: WorkspaceContext, installmentId: string) {
  const row = await owner(tx, context, installmentId);
  // This read shares the transaction through the explicit installment aggregate below, keeping the balance current.
  const installment = await tx.prepare(`SELECT i.id,i.agreement_id AS agreementId,i.number,
    (SELECT COUNT(*) FROM honorario_installment n WHERE n.office_id=i.office_id AND n.agreement_id=i.agreement_id) AS installmentCount,
    a.title,a.client_id AS clientId,c.name AS clientName,a.case_id AS caseId,k.name AS caseName,
    i.due_on AS dueOn,i.amount_cents AS amountCents,COALESCE(r.cents,0)::bigint AS receivedCents,
    (i.amount_cents-COALESCE(r.cents,0))::bigint AS pendingCents,
    CASE WHEN a.cancelled_at IS NOT NULL THEN 'cancelled' WHEN COALESCE(r.cents,0)=i.amount_cents THEN 'received'
      WHEN COALESCE(r.cents,0)>0 THEN 'partial' ELSE 'pending' END AS status,
    (a.cancelled_at IS NULL AND i.due_on<(CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date AND COALESCE(r.cents,0)<i.amount_cents) AS overdue,
    TRUE AS canManage
    FROM honorario_installment i JOIN honorario_agreement a ON a.office_id=i.office_id AND a.id=i.agreement_id
    JOIN crm_client c ON c.office_id=a.office_id AND c.id=a.client_id
    LEFT JOIN vault_case k ON k.office_id=a.case_office_id AND k.id=a.case_id
    LEFT JOIN LATERAL (SELECT SUM(p.amount_cents) AS cents FROM honorario_receipt p
      WHERE p.office_id=i.office_id AND p.installment_id=i.id AND NOT EXISTS(SELECT 1 FROM honorario_receipt_reversal v WHERE v.office_id=p.office_id AND v.receipt_id=p.id)) r ON true
    WHERE i.office_id=? AND i.id=?`).get(context.officeId, installmentId);
  const settings = await tx.prepare(`SELECT ch.version,ch.pix_key AS "pixKey",ch.instructions,ch.reminders_enabled AS "remindersEnabled",
    CASE WHEN d.id IS NULL THEN NULL ELSE json_build_object('id',d.id,'name',d.original_name) END AS boleto
    FROM honorario_charge ch LEFT JOIN vault_document d ON d.office_id=ch.office_id AND d.id=ch.boleto_document_id AND d.deleted_at IS NULL AND lume_vault_visible(d.id, ?)
    WHERE ch.office_id=? AND ch.installment_id=?`).get(context.userId, context.officeId, installmentId);
  const history = await tx.prepare(`SELECT e.id,e.operation,e.channel,e.notes,e.created_at AS createdAt,u.name AS createdByName
    FROM honorario_charge_event e JOIN "user" u ON u.id=e.user_id WHERE e.office_id=? AND e.installment_id=? AND e.response IS NOT NULL
    ORDER BY e.created_at DESC,e.id DESC LIMIT 50`).all(context.officeId, installmentId);
  const publication = await tx.prepare('SELECT 1 FROM client_portal_charge WHERE office_id=? AND installment_id=?').get(context.officeId, installmentId);
  const result = contract.chargeDto.parse({ installment, officeName: row.office_name, beneficiaryName: row.beneficiary_name,
    version: 0, pixKey: '', instructions: '', boleto: null, remindersEnabled: true, ...settings, history, portalPublished: Boolean(publication), message: '', pdfUrl: null });
  const i = result.installment;
  result.message = [result.officeName, `Olá, ${i.clientName}.`, `${i.title} — parcela ${i.number} de ${i.installmentCount}`,
    `Saldo a pagar: ${currency(i.pendingCents)}`, `Vencimento: ${i.dueOn.split('-').reverse().join('/')}`,
    `Beneficiário informado: ${result.beneficiaryName}`, result.pixKey ? `Chave PIX: ${result.pixKey}` : '', result.instructions,
    result.boleto ? 'Boleto anexado separadamente.' : '', 'Após pagar, envie o comprovante para conferência.'].filter(Boolean).join('\n');
  result.message = await withAsaasLink(tx, context, installmentId, result.message);
  result.pdfUrl = result.version > 0 && i.status !== 'cancelled' && i.pendingCents > 0 ? `/api/honorarios/charges/${encodeURIComponent(installmentId)}/pdf?version=${result.version}` : null;
  return result;
}

export async function getCharge(context: WorkspaceContext, raw: z.input<typeof contract.getChargeInput>) {
  context = await assertCapabilityAllowed(context, 'k5_honorarios_charge_get');
  if (context.caseScope) throw missing();
  const input = contract.getChargeInput.parse(raw);
  return withTransaction(async tx => { await tx.prepare('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY').run(); return view(tx, context, input.installmentId); });
}

async function mutate(context: WorkspaceContext, operation: 'prepare' | 'sent', input: z.output<typeof contract.prepareChargeInput> | z.output<typeof contract.sentChargeInput>) {
  const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  return withTransaction(async tx => {
    const agreement = await owner(tx, context, input.installmentId, true);
    await tx.prepare(`INSERT INTO honorario_charge_event(id,office_id,installment_id,user_id,idempotency_key,operation,input_hash,channel,notes)
      VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(office_id,user_id,idempotency_key) DO NOTHING`)
      .run(randomUUID(), context.officeId, input.installmentId, context.userId, input.idempotencyKey, operation, hash,
        'channel' in input ? input.channel : null, 'notes' in input ? input.notes : '');
    const claim = z.object({ input_hash: z.string(), operation: z.string(), response: z.unknown() }).parse(await tx.prepare(`SELECT input_hash,operation,response FROM honorario_charge_event
      WHERE office_id=? AND user_id=? AND idempotency_key=? FOR UPDATE`).get(context.officeId, context.userId, input.idempotencyKey));
    if (claim.input_hash !== hash || claim.operation !== operation) throw conflict('Esta chave já foi usada com outros dados.');
    if (claim.response !== null) {
      const saved = contract.chargeDto.parse(claim.response);
      const response = { ...saved, message: await withAsaasLink(tx, context, input.installmentId, saved.message) };
      if (response.boleto && !await tx.prepare('SELECT 1 FROM vault_document WHERE id=? AND office_id=? AND deleted_at IS NULL AND lume_vault_visible(id, ?)')
        .get(response.boleto.id, context.officeId, context.userId))
        return { ...response, boleto: null, message: response.message.split('\n').filter(line => line !== 'Boleto anexado separadamente.').join('\n') };
      return response;
    }
    const current = await view(tx, context, input.installmentId);
    if (agreement.cancelled_at || current.installment.pendingCents === 0) throw conflict('Esta parcela foi quitada ou cancelada.');
    if (current.version !== input.version) throw conflict('A cobrança mudou. Reabra a versão atual antes de continuar.');
    if (operation === 'prepare' && 'pixKey' in input) {
      if (input.boletoDocumentId && !await tx.prepare(`SELECT 1 FROM vault_document WHERE office_id=? AND id=? AND mime_type='application/pdf' AND byte_size<=10000000 AND deleted_at IS NULL AND lume_vault_visible(id, ?) FOR SHARE`)
        .get(context.officeId, input.boletoDocumentId, context.userId)) throw new CapabilityError('INVALID', 'Escolha um boleto em PDF do Cofre deste escritório, de até 10 MB.');
      await tx.prepare(`INSERT INTO honorario_charge(office_id,installment_id,version,pix_key,instructions,boleto_document_id,reminders_enabled,updated_by)
        VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(office_id,installment_id) DO UPDATE SET version=EXCLUDED.version,pix_key=EXCLUDED.pix_key,instructions=EXCLUDED.instructions,
        boleto_document_id=EXCLUDED.boleto_document_id,reminders_enabled=EXCLUDED.reminders_enabled,updated_by=EXCLUDED.updated_by,updated_at=CURRENT_TIMESTAMP`)
        .run(context.officeId, input.installmentId, input.version + 1, input.pixKey, input.instructions, input.boletoDocumentId, input.remindersEnabled, context.userId);
      await tx.prepare('INSERT INTO notification_rollout(office_id) VALUES(?) ON CONFLICT DO NOTHING').run(context.officeId);
    }
    // Include this committed event in its replayable response without exposing an incomplete event to other transactions.
    await tx.prepare(`UPDATE honorario_charge_event SET response='{}'::jsonb WHERE office_id=? AND user_id=? AND idempotency_key=?`).run(context.officeId, context.userId, input.idempotencyKey);
    const response = await view(tx, context, input.installmentId);
    await tx.prepare('UPDATE honorario_charge_event SET response=?::jsonb WHERE office_id=? AND user_id=? AND idempotency_key=?')
      .run(JSON.stringify(response), context.officeId, context.userId, input.idempotencyKey);
    return response;
  });
}

export async function prepareCharge(context: WorkspaceContext, raw: z.input<typeof contract.prepareChargeInput>) {
  context = await assertCapabilityAllowed(context, 'k5_honorarios_charge_prepare');
  return mutate(context, 'prepare', contract.prepareChargeInput.parse(raw));
}
export async function recordChargeSent(context: WorkspaceContext, raw: z.input<typeof contract.sentChargeInput>) {
  context = await assertCapabilityAllowed(context, 'k5_honorarios_charge_sent');
  return mutate(context, 'sent', contract.sentChargeInput.parse(raw));
}

