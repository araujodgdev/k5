import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { database, withTransaction, type Transaction } from '@/lib/database';
import { assertCapabilityAllowed, type WorkspaceContext } from '@/lib/application/context';
import { CapabilityError } from '@/lib/capabilities/errors';
import { getCalculation } from '@/lib/calc/service';
import { feeQuoteDto, feeQuoteListDto, getFeeQuoteInput, saveFeeQuoteInput, billFeeQuoteInput, priceFees, type FeePricing } from './pricing';

async function authorize(context: WorkspaceContext) {
  if (context.caseScope) throw new CapabilityError('FORBIDDEN', 'Propostas exigem o escritório pessoal.');
  await assertCapabilityAllowed(context, 'k5_honorarios_quote_list');
}
async function detail(tx: Transaction, context: WorkspaceContext, id: string, version?: number) {
  const row = await tx.prepare('SELECT id,title,client_id AS clientId,case_id AS caseId,version,version AS latestVersion,pricing,created_at AS createdAt FROM fee_quote WHERE office_id=? AND created_by=? AND id=?').get(context.officeId, context.userId, id);
  if (!row) throw new CapabilityError('NOT_FOUND', 'Proposta não encontrada.');
  if (version !== undefined && version !== row.version) {
    const historical = await tx.prepare('SELECT snapshot,created_at AS createdAt FROM fee_quote_version WHERE office_id=? AND quote_id=? AND version=?').get(context.officeId, id, version);
    if (!historical) throw new CapabilityError('NOT_FOUND', 'Versão da proposta não encontrada.');
    const snapshot = z.object({ title: z.string(), clientId: z.string(), caseId: z.string().nullable(), pricing: feeQuoteDto.shape.pricing }).parse(historical.snapshot);
    return feeQuoteDto.parse({ ...snapshot, id, version, latestVersion: row.version, createdAt: historical.createdAt, billed: [] });
  }
  const billed = await tx.prepare('SELECT component,agreement_id AS agreementId,amount_cents AS amountCents,evidence FROM fee_quote_billing WHERE office_id=? AND quote_id=? ORDER BY component').all(context.officeId, id);
  return feeQuoteDto.parse({ ...row, billed });
}
export async function getFeeQuote(context: WorkspaceContext, raw: z.input<typeof getFeeQuoteInput>) {
  await authorize(context);
  const input = getFeeQuoteInput.parse(raw);
  return detail(database, context, input.id, input.version);
}
export async function listFeeQuotes(context: WorkspaceContext) {
  await authorize(context);
  const rows = await database.prepare('SELECT id FROM fee_quote WHERE office_id=? AND created_by=? ORDER BY updated_at DESC LIMIT 100').all(context.officeId, context.userId);
  const items = await Promise.all(rows.map(row => detail(database, context, z.string().parse(row.id))));
  return feeQuoteListDto.parse({ items });
}
async function mutation(context: WorkspaceContext, operation: string, input: { idempotencyKey: string }, action: (tx: Transaction) => Promise<string>) {
  const hash = createHash('sha256').update(JSON.stringify([operation, input])).digest('hex');
  return withTransaction(async tx => {
    await tx.prepare('INSERT INTO fee_quote_mutation(office_id,user_id,idempotency_key,input_hash) VALUES(?,?,?,?) ON CONFLICT DO NOTHING').run(context.officeId, context.userId, input.idempotencyKey, hash);
    const claim = await tx.prepare('SELECT input_hash,response FROM fee_quote_mutation WHERE office_id=? AND user_id=? AND idempotency_key=? FOR UPDATE').get(context.officeId, context.userId, input.idempotencyKey);
    if (claim?.input_hash !== hash) throw new CapabilityError('CONFLICT', 'A tentativa já foi utilizada com outros dados.');
    if (claim.response) return feeQuoteDto.parse(claim.response);
    const id = await action(tx);
    const response = await detail(tx, context, id);
    await tx.prepare('UPDATE fee_quote_mutation SET response=?::jsonb WHERE office_id=? AND user_id=? AND idempotency_key=?').run(JSON.stringify(response), context.officeId, context.userId, input.idempotencyKey);
    return response;
  });
}
export async function saveFeeQuote(context: WorkspaceContext, raw: z.input<typeof saveFeeQuoteInput>) {
  await authorize(context);
  const input = saveFeeQuoteInput.parse(raw);
  if (input.terms.calculation) await getCalculation(context, input.terms.calculation);
  let pricing: FeePricing;
  try { pricing = priceFees(input.terms); } catch (error) { throw new CapabilityError('INVALID', error instanceof Error ? error.message : 'Confira a proposta.'); }
  return mutation(context, 'save', input, async tx => {
    if (!await tx.prepare('SELECT 1 FROM crm_client WHERE office_id=? AND id=? FOR KEY SHARE').get(context.officeId, input.clientId)) throw new CapabilityError('NOT_FOUND', 'Cliente não encontrado.');
    if (input.caseId && !await tx.prepare('SELECT 1 FROM vault_case WHERE office_id=? AND id=? AND deleted_at IS NULL FOR SHARE').get(context.officeId, input.caseId)) throw new CapabilityError('NOT_FOUND', 'Selecione um caso próprio.');
    const id = input.id ?? randomUUID();
    let version = 1;
    if (input.id) {
      const current = await tx.prepare('SELECT version FROM fee_quote WHERE office_id=? AND created_by=? AND id=? FOR UPDATE').get(context.officeId, context.userId, id);
      if (!current) throw new CapabilityError('NOT_FOUND', 'Proposta não encontrada.');
      if (current.version !== input.expectedVersion) throw new CapabilityError('CONFLICT', 'A proposta mudou. Abra a versão atual.');
      if (await tx.prepare('SELECT 1 FROM fee_quote_billing WHERE office_id=? AND quote_id=?').get(context.officeId, id)) throw new CapabilityError('CONFLICT', 'Esta proposta já gerou parcelas. Preserve-a e crie um aditivo como nova proposta.');
      version = input.expectedVersion + 1;
      await tx.prepare('UPDATE fee_quote SET title=?,client_id=?,case_id=?,version=?,pricing=?::jsonb,updated_at=CURRENT_TIMESTAMP WHERE office_id=? AND id=?').run(input.title, input.clientId, input.caseId, version, JSON.stringify(pricing), context.officeId, id);
    } else {
      if (input.expectedVersion !== 0) throw new CapabilityError('CONFLICT', 'Uma proposta nova começa na versão zero.');
      await tx.prepare('INSERT INTO fee_quote(id,office_id,created_by,title,client_id,case_id,version,pricing) VALUES(?,?,?,?,?,?,1,?::jsonb)').run(id, context.officeId, context.userId, input.title, input.clientId, input.caseId, JSON.stringify(pricing));
    }
    await tx.prepare('INSERT INTO fee_quote_version(office_id,quote_id,version,snapshot) VALUES(?,?,?,?::jsonb)').run(context.officeId, id, version, JSON.stringify({ title: input.title, clientId: input.clientId, caseId: input.caseId, pricing }));
    return id;
  });
}
export async function billFeeQuote(context: WorkspaceContext, raw: z.input<typeof billFeeQuoteInput>) {
  await authorize(context);
  const input = billFeeQuoteInput.parse(raw);
  return mutation(context, 'bill', input, async tx => {
    const lock = await tx.prepare('SELECT version FROM fee_quote WHERE office_id=? AND created_by=? AND id=? FOR UPDATE').get(context.officeId, context.userId, input.id);
    if (!lock) throw new CapabilityError('NOT_FOUND', 'Proposta não encontrada.');
    if (lock.version !== input.version) throw new CapabilityError('CONFLICT', 'A proposta mudou. Abra a versão atual.');
    const quote = await detail(tx, context, input.id);
    if (quote.billed.some(item => item.component === input.component)) throw new CapabilityError('CONFLICT', 'Este componente já gerou parcelas.');
    const component = quote.pricing.terms.components[input.component];
    if (!component) throw new CapabilityError('INVALID', 'Componente não encontrado.');
    if (component.due === 'success' && component.kind === 'percentage' && !input.realizedBaseCents) throw new CapabilityError('INVALID', 'Informe a base efetivamente obtida no êxito.');
    const realized = component.kind === 'percentage' && component.due === 'success' ? { ...component, baseCents: input.realizedBaseCents ?? component.baseCents } : component;
    const pricing = priceFees({ ...quote.pricing.terms, components: [realized] });
    const total = pricing.totalCents;
    if (total < input.count) throw new CapabilityError('INVALID', 'A quantidade de parcelas deve preservar pelo menos um centavo em cada uma.');
    if (!await tx.prepare('SELECT 1 FROM crm_client WHERE office_id=? AND id=? FOR KEY SHARE').get(context.officeId, quote.clientId)) throw new CapabilityError('NOT_FOUND', 'Cliente não encontrado.');
    if (quote.caseId && !await tx.prepare('SELECT 1 FROM vault_case WHERE office_id=? AND id=? AND deleted_at IS NULL FOR SHARE').get(context.officeId, quote.caseId)) throw new CapabilityError('NOT_FOUND', 'O caso vinculado não está mais disponível.');
    const agreementId = randomUUID();
    await tx.prepare('INSERT INTO honorario_agreement(id,office_id,client_id,case_id,case_office_id,title,notes,created_by,pricing) VALUES(?,?,?,?,?,?,?,?,?::jsonb)').run(agreementId, context.officeId, quote.clientId, quote.caseId, quote.caseId ? context.officeId : null, `${quote.title}: ${component.label}`.slice(0, 180), `Proposta ${quote.id}, versão ${quote.version}.`, context.userId, JSON.stringify(pricing));
    const first = new Date(`${input.firstDueOn}T00:00:00Z`);
    for (let index = 0; index < input.count; index++) {
      const due = new Date(first); due.setUTCDate(1); due.setUTCMonth(due.getUTCMonth() + index);
      const end = new Date(due); end.setUTCMonth(end.getUTCMonth() + 1); end.setUTCDate(0);
      due.setUTCDate(Math.min(first.getUTCDate(), end.getUTCDate()));
      const amount = Math.floor(total / input.count) + (index === input.count - 1 ? total % input.count : 0);
      await tx.prepare('INSERT INTO honorario_installment(id,office_id,agreement_id,number,due_on,amount_cents) VALUES(?,?,?,?,?,?)').run(randomUUID(), context.officeId, agreementId, index + 1, due.toISOString().slice(0, 10), amount);
    }
    await tx.prepare('INSERT INTO fee_quote_billing(office_id,quote_id,component,agreement_id,amount_cents,evidence) VALUES(?,?,?,?,?,?)').run(context.officeId, quote.id, input.component, agreementId, total, input.evidence);
    return quote.id;
  });
}
