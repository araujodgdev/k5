import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { withTransaction, type Transaction } from '@/lib/database';
import { assertCapabilityAllowed, type WorkspaceContext } from '@/lib/application/context';
import { CapabilityError } from '@/lib/capabilities/errors';
import { caseAccess } from '@/lib/collaboration/access';
import * as contract from './contracts';

const missing = () => new CapabilityError('NOT_FOUND', 'Registro não encontrado neste escritório.');
const conflict = (message: string) => new CapabilityError('CONFLICT', message);
const todayInSaoPaulo = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

async function authorize(context: WorkspaceContext, write = false) {
  if (context.invocation || context.caseScope) throw new CapabilityError('FORBIDDEN', 'Honorários devem ser acessados pela interface do escritório.');
  return assertCapabilityAllowed(context, write ? 'k5_honorarios_create' : 'k5_honorarios_list');
}

const accessibleAgreements = `WITH visible_agreements AS (
  SELECT a.*, (a.office_id=? AND a.created_by=? AND ?::boolean) AS canManage FROM honorario_agreement a
  WHERE (a.office_id=? AND a.created_by=?) OR EXISTS (
    SELECT 1 FROM vault_case c WHERE c.office_id=a.case_office_id AND c.id=a.case_id AND c.deleted_at IS NULL
    AND (EXISTS (SELECT 1 FROM case_participant p WHERE p.office_id=c.office_id AND p.case_id=c.id AND p.user_id=? AND p.revoked_at IS NULL)
      OR (c.created_by=? AND EXISTS (SELECT 1 FROM office_member m WHERE m.office_id=c.office_id AND m.user_id=c.created_by)))
  )
)`;
const accessParams = (context: WorkspaceContext) => [context.officeId, context.userId, context.role !== 'reviewer', context.officeId, context.userId, context.userId, context.userId];
const installmentRows = `${accessibleAgreements}, received AS (
  SELECT r.office_id, r.installment_id, SUM(r.amount_cents)::bigint AS cents
  FROM honorario_receipt r LEFT JOIN honorario_receipt_reversal v ON v.office_id=r.office_id AND v.receipt_id=r.id
  JOIN honorario_installment i ON i.office_id=r.office_id AND i.id=r.installment_id
  JOIN visible_agreements a ON a.office_id=i.office_id AND a.id=i.agreement_id
  WHERE v.receipt_id IS NULL GROUP BY r.office_id, r.installment_id
), installments AS (
  SELECT i.id, i.agreement_id AS agreementId, i.number,
    COUNT(*) OVER (PARTITION BY i.office_id,i.agreement_id) AS installmentCount,
    a.title, a.client_id AS clientId, c.name AS clientName, a.case_id AS caseId, k.name AS caseName, a.canManage,
    i.due_on AS dueOn, i.amount_cents AS amountCents, COALESCE(r.cents,0)::bigint AS receivedCents,
    (i.amount_cents-COALESCE(r.cents,0))::bigint AS pendingCents,
    CASE WHEN a.cancelled_at IS NOT NULL THEN 'cancelled' WHEN COALESCE(r.cents,0)=i.amount_cents THEN 'received'
      WHEN COALESCE(r.cents,0)>0 THEN 'partial' ELSE 'pending' END AS status,
    (a.cancelled_at IS NULL AND i.due_on<?::date AND COALESCE(r.cents,0)<i.amount_cents) AS overdue
  FROM honorario_installment i JOIN visible_agreements a ON a.office_id=i.office_id AND a.id=i.agreement_id
  JOIN crm_client c ON c.office_id=a.office_id AND c.id=a.client_id
  LEFT JOIN vault_case k ON k.office_id=a.case_office_id AND k.id=a.case_id
  LEFT JOIN received r ON r.office_id=i.office_id AND r.installment_id=i.id
)`;

async function detail(tx: Transaction, context: WorkspaceContext, agreementId: string) {
  const agreement = await tx.prepare(`${accessibleAgreements} SELECT a.id,a.office_id,a.canManage,a.title,a.notes,a.client_id AS clientId,c.name AS clientName,
    a.case_id AS caseId,k.name AS caseName,a.created_at AS createdAt,a.cancelled_at AS cancelledAt,a.cancel_reason AS cancelReason,
    CASE WHEN a.cancelled_at IS NULL THEN 'active' ELSE 'cancelled' END AS status
    FROM visible_agreements a JOIN crm_client c ON c.office_id=a.office_id AND c.id=a.client_id
    LEFT JOIN vault_case k ON k.office_id=a.case_office_id AND k.id=a.case_id WHERE a.id=?`).get(...accessParams(context), agreementId);
  if (!agreement) throw missing();
  const installments = contract.honorarioInstallmentDto.array().parse(await tx.prepare(`${installmentRows} SELECT * FROM installments WHERE agreementId=? ORDER BY number`)
    .all(...accessParams(context), todayInSaoPaulo(), agreementId));
  const receipts = await tx.prepare(`SELECT r.id,r.installment_id AS installmentId,r.amount_cents AS amountCents,
    r.received_on AS receivedOn,r.method,r.notes,r.created_at AS createdAt,u.name AS createdByName,
    CASE WHEN v.receipt_id IS NULL THEN NULL ELSE json_build_object('reason',v.reason,'createdAt',
      to_char(v.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'createdByName',vu.name) END AS reversal
    FROM honorario_receipt r JOIN honorario_installment i ON i.office_id=r.office_id AND i.id=r.installment_id
    JOIN user u ON u.id=r.created_by LEFT JOIN honorario_receipt_reversal v ON v.office_id=r.office_id AND v.receipt_id=r.id
    LEFT JOIN user vu ON vu.id=v.created_by WHERE r.office_id=? AND i.agreement_id=? ORDER BY r.created_at,r.id`).all(agreement.office_id, agreementId);
  const totalCents = installments.reduce((sum, i) => sum + i.amountCents, 0);
  const receivedCents = installments.reduce((sum, i) => sum + i.receivedCents, 0);
  return contract.honorarioDetailDto.parse({ agreement: { ...agreement, totalCents, receivedCents, pendingCents: totalCents - receivedCents }, installments, receipts });
}

export async function getHonorario(context: WorkspaceContext, raw: z.input<typeof contract.getHonorarioInput>) {
  context = await authorize(context);
  const input = contract.getHonorarioInput.parse(raw);
  return withTransaction(async tx => {
    await tx.prepare('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY').run();
    return detail(tx, context, input.agreementId);
  });
}

export async function listHonorarios(context: WorkspaceContext, raw: z.input<typeof contract.listHonorariosInput> = {}) {
  context = await authorize(context);
  const input = contract.listHonorariosInput.parse(raw);
  const today = todayInSaoPaulo();
  return withTransaction(async tx => {
    await tx.prepare('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY').run();
    const filters = ['TRUE']; const params: unknown[] = [...accessParams(context), today];
    if (input.query) { filters.push("strpos(lower(title || ' ' || clientName || ' ' || COALESCE(caseName,'')),lower(?))>0"); params.push(input.query); }
    if (input.clientId) { filters.push('clientId=?'); params.push(input.clientId); }
    if (input.caseId) { filters.push('caseId=?'); params.push(input.caseId); }
    if (input.dueFrom) { filters.push('dueOn>=?::date'); params.push(input.dueFrom); }
    if (input.dueTo) { filters.push('dueOn<=?::date'); params.push(input.dueTo); }
    const base = `${installmentRows}, filtered AS (SELECT * FROM installments WHERE ${filters.join(' AND ')})`;
    const view = input.view === 'pending' ? "status IN ('pending','partial')" : 'status=?';
    const viewParams = input.view === 'pending' ? [] : [input.view];
    const rows = await tx.prepare(`${base} SELECT * FROM filtered WHERE ${view} ORDER BY dueOn,id LIMIT ? OFFSET ?`).all(...params, ...viewParams, input.limit, input.offset);
    const count = await tx.prepare(`${base} SELECT COUNT(*) AS total FROM filtered WHERE ${view}`).get(...params, ...viewParams);
    const summary = await tx.prepare(`${base} SELECT COALESCE(SUM(amountCents),0)::bigint AS totalCents,
      COALESCE(SUM(receivedCents),0)::bigint AS receivedCents, COALESCE(SUM(pendingCents),0)::bigint AS pendingCents,
      COALESCE(SUM(CASE WHEN overdue THEN pendingCents ELSE 0 END),0)::bigint AS overdueCents FROM filtered WHERE status<>'cancelled'`).get(...params);
    return contract.honorariosListDto.parse({ installments: rows, total: count?.total, summary, today });
  });
}

export async function honorariosOptions(context: WorkspaceContext, raw: z.input<typeof contract.honorariosOptionsInput> = {}) {
  context = await authorize(context);
  const input = contract.honorariosOptionsInput.parse(raw);
  return withTransaction(async tx => {
    await tx.prepare('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY').run();
    if (input.purpose === 'filter') {
      const clients = await tx.prepare(`${accessibleAgreements}, choices AS (
        SELECT DISTINCT c.id,c.name FROM visible_agreements a JOIN crm_client c ON c.office_id=a.office_id AND c.id=a.client_id
      ) SELECT id,name FROM choices WHERE id=? OR strpos(lower(name),lower(?))>0 ORDER BY (id=?) DESC NULLS LAST,name,id LIMIT ?`)
        .all(...accessParams(context), input.clientId ?? null, input.query ?? '', input.clientId ?? null, input.limit);
      const cases = await tx.prepare(`${accessibleAgreements}, choices AS (
        SELECT DISTINCT c.id,c.name FROM visible_agreements a JOIN vault_case c ON c.office_id=a.case_office_id AND c.id=a.case_id
      ) SELECT id,name FROM choices WHERE id=? OR strpos(lower(name),lower(?))>0 ORDER BY (id=?) DESC NULLS LAST,name,id LIMIT ?`)
        .all(...accessParams(context), input.caseId ?? null, input.query ?? '', input.caseId ?? null, input.limit);
      return contract.honorariosOptionsDto.parse({ clients, cases });
    }
    const clients = await tx.prepare(`SELECT id,name FROM crm_client WHERE office_id=? AND (id=? OR strpos(lower(name),lower(?))>0) ORDER BY (id=?) DESC NULLS LAST,name,id LIMIT ?`)
      .all(context.officeId, input.clientId ?? null, input.query ?? '', input.clientId ?? null, input.limit);
    const cases = await tx.prepare(`SELECT c.id,c.name FROM vault_case c WHERE c.deleted_at IS NULL
      AND (EXISTS (SELECT 1 FROM office_member m WHERE m.office_id=c.office_id AND m.user_id=?)
        OR EXISTS (SELECT 1 FROM case_participant p WHERE p.office_id=c.office_id AND p.case_id=c.id AND p.user_id=? AND p.revoked_at IS NULL))
      AND (c.id=? OR strpos(lower(c.name),lower(?))>0) ORDER BY (c.id=?) DESC NULLS LAST,c.name,c.id LIMIT ?`)
      .all(context.userId, context.userId, input.caseId ?? null, input.query ?? '', input.caseId ?? null, input.limit);
    return contract.honorariosOptionsDto.parse({ clients, cases });
  });
}

async function mutate(context: WorkspaceContext, operation: 'create' | 'receive' | 'reverse' | 'cancel', input: { idempotencyKey: string }, action: (tx: Transaction) => Promise<string>) {
  const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  return withTransaction(async tx => {
    await tx.prepare(`INSERT INTO honorario_mutation(office_id,user_id,idempotency_key,operation,input_hash) VALUES(?,?,?,?,?) ON CONFLICT DO NOTHING`)
      .run(context.officeId, context.userId, input.idempotencyKey, operation, hash);
    const claim = z.object({ operation: z.string(), input_hash: z.string(), response: z.unknown() }).parse(await tx.prepare(`SELECT operation,input_hash,response FROM honorario_mutation WHERE office_id=? AND user_id=? AND idempotency_key=? FOR UPDATE`)
      .get(context.officeId, context.userId, input.idempotencyKey));
    if (claim.operation !== operation || claim.input_hash !== hash) throw conflict('Esta chave já foi usada com outros dados.');
    if (claim.response !== null) return contract.honorarioDetailDto.parse(claim.response);
    const agreementId = await action(tx);
    const response = await detail(tx, context, agreementId);
    await tx.prepare('UPDATE honorario_mutation SET response=?::jsonb WHERE office_id=? AND user_id=? AND idempotency_key=?')
      .run(JSON.stringify(response), context.officeId, context.userId, input.idempotencyKey);
    return response;
  });
}

async function lockAgreement(tx: Transaction, context: WorkspaceContext, agreementId: string) {
  const row = await tx.prepare('SELECT cancelled_at FROM honorario_agreement WHERE office_id=? AND id=? AND created_by=? FOR UPDATE').get(context.officeId, agreementId, context.userId);
  if (!row) throw missing();
  if (row.cancelled_at !== null) throw conflict('Este honorário foi cancelado.');
}

export async function createHonorario(context: WorkspaceContext, raw: z.input<typeof contract.createHonorarioInput>) {
  context = await authorize(context, true);
  const input = contract.createHonorarioInput.parse(raw);
  return mutate(context, 'create', input, async tx => {
    if (!await tx.prepare('SELECT id FROM crm_client WHERE office_id=? AND id=? FOR KEY SHARE').get(context.officeId, input.clientId)) throw missing();
    const caseOfficeId = input.caseId ? (await caseAccess(context.userId, input.caseId, tx)).officeId : null;
    if (input.caseId && !await tx.prepare('SELECT id FROM vault_case WHERE office_id=? AND id=? AND deleted_at IS NULL FOR SHARE').get(caseOfficeId, input.caseId)) throw missing();
    const agreementId = randomUUID();
    await tx.prepare('INSERT INTO honorario_agreement(id,office_id,client_id,case_id,case_office_id,title,notes,created_by) VALUES(?,?,?,?,?,?,?,?)')
      .run(agreementId, context.officeId, input.clientId, input.caseId, caseOfficeId, input.title, input.notes, context.userId);
    for (const [index, row] of input.installments.entries()) await tx.prepare('INSERT INTO honorario_installment(id,office_id,agreement_id,number,due_on,amount_cents) VALUES(?,?,?,?,?,?)')
      .run(randomUUID(), context.officeId, agreementId, index + 1, row.dueOn, row.amountCents);
    return agreementId;
  });
}

export async function receiveHonorario(context: WorkspaceContext, raw: z.input<typeof contract.receiveHonorarioInput>) {
  context = await authorize(context, true);
  const input = contract.receiveHonorarioInput.parse(raw);
  if (input.receivedOn > todayInSaoPaulo()) throw new CapabilityError('INVALID', 'O recebimento não pode ter uma data futura.');
  return mutate(context, 'receive', input, async tx => {
    const row = await tx.prepare('SELECT agreement_id FROM honorario_installment WHERE office_id=? AND id=?').get(context.officeId, input.installmentId);
    if (!row) throw missing();
    const agreementId = z.string().parse(row.agreement_id);
    await lockAgreement(tx, context, agreementId);
    const current = await detail(tx, context, agreementId);
    const installment = current.installments.find(i => i.id === input.installmentId);
    if (!installment) throw missing();
    if (input.amountCents > installment.pendingCents) throw conflict('O recebimento excede o saldo desta parcela.');
    await tx.prepare('INSERT INTO honorario_receipt(id,office_id,installment_id,amount_cents,received_on,method,notes,created_by) VALUES(?,?,?,?,?,?,?,?)')
      .run(randomUUID(), context.officeId, input.installmentId, input.amountCents, input.receivedOn, input.method, input.notes, context.userId);
    return agreementId;
  });
}

export async function reverseHonorario(context: WorkspaceContext, raw: z.input<typeof contract.reverseHonorarioInput>) {
  context = await authorize(context, true);
  const input = contract.reverseHonorarioInput.parse(raw);
  return mutate(context, 'reverse', input, async tx => {
    const row = await tx.prepare(`SELECT i.agreement_id FROM honorario_receipt r JOIN honorario_installment i ON i.office_id=r.office_id AND i.id=r.installment_id WHERE r.office_id=? AND r.id=?`).get(context.officeId, input.receiptId);
    if (!row) throw missing();
    const agreementId = z.string().parse(row.agreement_id);
    await lockAgreement(tx, context, agreementId);
    if (await tx.prepare('SELECT 1 FROM honorario_receipt_reversal WHERE office_id=? AND receipt_id=?').get(context.officeId, input.receiptId)) throw conflict('Este recebimento já foi estornado.');
    await tx.prepare('INSERT INTO honorario_receipt_reversal(office_id,receipt_id,reason,created_by) VALUES(?,?,?,?)').run(context.officeId, input.receiptId, input.reason, context.userId);
    return agreementId;
  });
}

export async function cancelHonorario(context: WorkspaceContext, raw: z.input<typeof contract.cancelHonorarioInput>) {
  context = await authorize(context, true);
  const input = contract.cancelHonorarioInput.parse(raw);
  return mutate(context, 'cancel', input, async tx => {
    await lockAgreement(tx, context, input.agreementId);
    const current = await detail(tx, context, input.agreementId);
    if (current.agreement.receivedCents !== 0) throw conflict('Estorne os recebimentos antes de cancelar este honorário.');
    await tx.prepare('UPDATE honorario_agreement SET cancelled_at=CURRENT_TIMESTAMP,cancelled_by=?,cancel_reason=? WHERE office_id=? AND id=?')
      .run(context.userId, input.reason, context.officeId, input.agreementId);
    return input.agreementId;
  });
}
