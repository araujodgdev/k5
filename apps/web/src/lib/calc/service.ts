import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { database, withTransaction, type Transaction } from '@/lib/database';
import { assertCapabilityAllowed, type WorkspaceContext } from '@/lib/application/context';
import { CapabilityError } from '@/lib/capabilities/errors';
import { calculate } from './engine';
import { loadObservations } from './indices';
import * as contract from './contracts';

async function authorize(context: WorkspaceContext) {
  if (context.caseScope) throw new CapabilityError('FORBIDDEN', 'Cálculos exigem o escritório pessoal.');
  await assertCapabilityAllowed(context, 'k5_calc_list');
}
export async function calculatePreview(context: WorkspaceContext, raw: z.input<typeof contract.calculateInput>) {
  await authorize(context);
  const { input } = contract.calculateInput.parse(raw);
  const observations = await loadObservations(input);
  await authorize(context);
  try { return calculate(input, observations); }
  catch (error) { throw new CapabilityError('INVALID', error instanceof Error ? error.message : 'Confira os parâmetros do cálculo.'); }
}
export async function listCalculations(context: WorkspaceContext, raw: z.input<typeof contract.listCalculationsInput>) {
  await authorize(context);
  const input = contract.listCalculationsInput.parse(raw);
  const params = [context.officeId, context.userId, input.query];
  const predicate = 'office_id=? AND created_by=? AND strpos(lower(title),lower(?))>0';
  const items = await database.prepare(`SELECT id,title,kind,version,total_cents AS totalCents,updated_at AS updatedAt FROM legal_calculation WHERE ${predicate} ORDER BY updated_at DESC,id LIMIT ? OFFSET ?`).all(...params, input.limit, input.offset);
  const count = await database.prepare(`SELECT COUNT(*) AS total FROM legal_calculation WHERE ${predicate}`).get(...params);
  return contract.calculationsList.parse({ items, total: count?.total });
}
async function detail(tx: Transaction, context: WorkspaceContext, id: string, version?: number) {
  const found = await tx.prepare(`SELECT c.id,v.title,v.version,c.version AS latestVersion,v.client_id AS clientId,v.case_id AS caseId,v.notes,v.input,v.result,v.created_at AS createdAt
    FROM legal_calculation c JOIN legal_calculation_version v ON v.office_id=c.office_id AND v.calculation_id=c.id AND v.version=COALESCE(?,c.version)
    WHERE c.office_id=? AND c.created_by=? AND c.id=?`).get(version ?? null, context.officeId, context.userId, id);
  if (!found) throw new CapabilityError('NOT_FOUND', 'Cálculo não encontrado neste escritório.');
  return contract.savedCalculation.parse(found);
}
export async function getCalculation(context: WorkspaceContext, raw: z.input<typeof contract.getCalculationInput>) {
  await authorize(context);
  const input = contract.getCalculationInput.parse(raw);
  return detail(database, context, input.id, input.version);
}
export async function saveCalculation(context: WorkspaceContext, raw: z.input<typeof contract.saveCalculationInput>) {
  await authorize(context);
  const input = contract.saveCalculationInput.parse(raw);
  const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const previous = await database.prepare('SELECT input_hash,response FROM legal_calculation_mutation WHERE office_id=? AND user_id=? AND idempotency_key=?').get(context.officeId, context.userId, input.idempotencyKey);
  if (previous) {
    if (previous.input_hash !== hash) throw new CapabilityError('CONFLICT', 'Esta tentativa já foi usada com outros dados.');
    if (previous.response) return contract.savedCalculation.parse(previous.response);
  }
  if (input.id) await getCalculation(context, { id: input.id });
  const result = await calculatePreview(context, { input: input.input });
  await authorize(context);
  return withTransaction(async tx => {
    await tx.prepare('INSERT INTO legal_calculation_mutation(office_id,user_id,idempotency_key,input_hash) VALUES(?,?,?,?) ON CONFLICT DO NOTHING').run(context.officeId, context.userId, input.idempotencyKey, hash);
    const claim = await tx.prepare('SELECT input_hash,response FROM legal_calculation_mutation WHERE office_id=? AND user_id=? AND idempotency_key=? FOR UPDATE').get(context.officeId, context.userId, input.idempotencyKey);
    if (claim?.input_hash !== hash) throw new CapabilityError('CONFLICT', 'Esta tentativa já foi usada com outros dados.');
    if (claim.response) return contract.savedCalculation.parse(claim.response);
    if (input.clientId && !await tx.prepare('SELECT 1 FROM crm_client WHERE office_id=? AND id=? FOR KEY SHARE').get(context.officeId, input.clientId)) throw new CapabilityError('NOT_FOUND', 'Cliente não encontrado neste escritório.');
    if (input.caseId && !await tx.prepare('SELECT 1 FROM vault_case WHERE office_id=? AND id=? AND deleted_at IS NULL FOR SHARE').get(context.officeId, input.caseId)) throw new CapabilityError('NOT_FOUND', 'Selecione um caso do seu escritório.');
    let version = 1;
    const id = input.id ?? randomUUID();
    if (input.id) {
      const current = await tx.prepare('SELECT version,kind FROM legal_calculation WHERE office_id=? AND created_by=? AND id=? FOR UPDATE').get(context.officeId, context.userId, id);
      if (!current) throw new CapabilityError('NOT_FOUND', 'Cálculo não encontrado.');
      if (current.version !== input.expectedVersion) throw new CapabilityError('CONFLICT', 'O cálculo mudou. Abra a versão atual antes de salvar uma nova.');
      if (current.kind !== input.input.kind) throw new CapabilityError('INVALID', 'Crie outro cálculo para mudar de modalidade.');
      version = z.number().parse(current.version) + 1;
      await tx.prepare('UPDATE legal_calculation SET title=?,version=?,total_cents=?,updated_at=CURRENT_TIMESTAMP WHERE office_id=? AND id=?').run(input.title, version, result.totalCents, context.officeId, id);
    } else {
      if (input.expectedVersion !== 0) throw new CapabilityError('CONFLICT', 'Um cálculo novo deve começar na versão zero.');
      await tx.prepare('INSERT INTO legal_calculation(id,office_id,created_by,title,kind,version,total_cents) VALUES(?,?,?,?,?,1,?)').run(id, context.officeId, context.userId, input.title, input.input.kind, result.totalCents);
    }
    await tx.prepare('INSERT INTO legal_calculation_version(office_id,calculation_id,version,title,client_id,case_id,notes,input,result) VALUES(?,?,?,?,?,?,?,?::jsonb,?::jsonb)').run(context.officeId, id, version, input.title, input.clientId, input.caseId, input.notes, JSON.stringify(input.input), JSON.stringify(result));
    const response = await detail(tx, context, id, version);
    await tx.prepare('UPDATE legal_calculation_mutation SET response=?::jsonb WHERE office_id=? AND user_id=? AND idempotency_key=?').run(JSON.stringify(response), context.officeId, context.userId, input.idempotencyKey);
    return response;
  });
}
