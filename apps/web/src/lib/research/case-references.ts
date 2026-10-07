import { contentResult, mapContentResult, payloadDigest } from '@/lib/content-result';
import { assertPolicyAccess, combinePolicy, contentDigest, parsePolicy, personPolicy, type ContentPolicy } from '@/lib/content-policy';
import { researchTextChange, prepareResearchChange, consumedResearchResult, consumeResearchChange } from './case-content';
import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { database, type Transaction } from '@/lib/database';
import { aclTransaction } from '@/lib/acl-transaction';
import type { WorkspaceContext } from '@/lib/application/context';
import { CapabilityError } from '@/lib/capabilities/errors';
import { assertResearchCaseAccess } from './case-profile';
import { materialSnapshot, requireMaterialSnapshot, type MaterialSnapshot } from './case-material';
import { getResearchCaseAssessment } from './case-assessment';
import type { ResearchCaseAssessment } from './case-assessment-contracts';

export const researchReferencePurpose = z.enum(['foundation', 'counterpoint', 'context']);
export const addResearchCaseReferenceInput = z.object({
  caseId: z.uuid(), materialVersionId: z.uuid(), purpose: researchReferencePurpose,
  assessmentId: z.uuid(), bypassEvaluation: z.boolean().default(false),
  notes: z.string().trim().max(4000).optional(), change: researchTextChange.optional(), approvalId: z.uuid().optional(), readToken: z.uuid().optional(),
});
export const updateResearchCaseReferenceInput = z.object({
  referenceId: z.uuid(), expectedVersion: z.number().int().positive(),
  purpose: researchReferencePurpose.optional(), notes: z.string().trim().max(4000).optional(), change: researchTextChange.optional(), approvalId: z.uuid().optional(), readToken: z.uuid().optional(),
  materialVersionId: z.uuid().optional(), assessmentId: z.uuid().optional(), bypassEvaluation: z.boolean().optional(),
});
export type AddResearchCaseReferenceInput = z.input<typeof addResearchCaseReferenceInput>;
export type UpdateResearchCaseReferenceInput = z.input<typeof updateResearchCaseReferenceInput>;
type ReferenceRow = {
  id: string; office_id: string; case_id: string; material_version_id: string;
  purpose: z.infer<typeof researchReferencePurpose>; notes: string; assessment_id: string | null;
  bypass_evaluation: number; version: number; created_by: string; updated_by: string;
  created_at: string; updated_at: string; deleted_at: string | null; notes_policy: unknown; notes_receipt: unknown;
};
export type ResearchCaseReference = {
  id: string; caseId: string; materialVersionId: string; purpose: z.infer<typeof researchReferencePurpose>;
  notes: string; notesState: 'visible' | 'withheld'; readToken: string | null; assessmentId: string | null; assessment: ResearchCaseAssessment | null;
  bypassEvaluation: boolean; version: number; createdAt: string; updatedAt: string;
  material: Pick<MaterialSnapshot, 'materialId' | 'kind' | 'materialStatus' | 'judgmentStatus' | 'title' | 'tribunal' | 'courtUnit' |
    'caseNumber' | 'decisionDate' | 'sourceUrl' | 'judgmentId' | 'currentVersionId' | 'localAllowed'> | null;
};

async function referenceView(context: WorkspaceContext, row: ReferenceRow, db: Transaction = database): Promise<ResearchCaseReference> {
  const material = await materialSnapshot(row.material_version_id, db);
  let assessment: ResearchCaseAssessment | null = null;
  if (row.assessment_id) {
    try { assessment = await getResearchCaseAssessment(context, row.assessment_id, db); }
    catch (error) { if (!(error instanceof CapabilityError)) throw error; }
  }
  const policies: ContentPolicy[] = [{ ...personPolicy('', ''), guards: [{ kind: 'case', id: row.case_id }, { kind: 'research', id: row.id, caseId: row.case_id }] }];
  let notes = '', notesState: 'visible' | 'withheld' = 'withheld', readToken: string | null = null;
  if (row.notes_policy) {
    const policy = parsePolicy(row.notes_policy, contentDigest('', row.notes));
    try {
      await assertPolicyAccess(context.userId, policy, db); notes = row.notes; notesState = 'visible'; policies.push(policy);
      readToken = randomUUID();
      const scope = { referenceId: row.id, caseId: row.case_id, version: row.version, notesDigest: policy.digest };
      await db.prepare("INSERT INTO content_seed(id,office_id,user_id,purpose,scope,digest,content_policy) VALUES(?,?,?,'research-notes',?::jsonb,?,?::jsonb)")
        .run(readToken,context.officeId,context.userId,JSON.stringify(scope),payloadDigest(scope),JSON.stringify(policy));
    } catch (error) { if (!(error instanceof CapabilityError)) throw error; }
  }
  if (material?.aiAllowed) policies.push({ ...personPolicy(material.title,material.text ?? ''), guards: [{ kind: 'research-material', id: material.versionId }],
    observed: [{ kind: 'research', id: row.id, version: material.versionId, digest: material.sha256 }] });
  return mapContentResult(contentResult({ id: row.id, caseId: row.case_id, materialVersionId: row.material_version_id, purpose: row.purpose,
    notes, notesState, readToken, assessmentId: row.assessment_id, assessment, bypassEvaluation: !!row.bypass_evaluation,
    version: row.version, createdAt: row.created_at, updatedAt: row.updated_at,
    material: material?.aiAllowed ? { materialId: material.materialId, kind: material.kind, materialStatus: material.materialStatus,
      judgmentStatus: material.judgmentStatus, title: material.title, tribunal: material.tribunal,
      courtUnit: material.courtUnit, caseNumber: material.caseNumber, decisionDate: material.decisionDate,
      sourceUrl: material.sourceUrl, judgmentId: material.judgmentId, currentVersionId: material.currentVersionId,
      localAllowed: material.localAllowed } : null }, policies, [{ kind: 'research-reference', id: row.id, version: row.version, digest: payloadDigest([row.material_version_id,row.purpose,notes]) }]), assessment);
}

export async function listResearchCaseReferences(context: WorkspaceContext, caseId: string): Promise<ResearchCaseReference[]> {
  await assertResearchCaseAccess(context, caseId);
  const rows = await database.prepare(`SELECT * FROM research_case_reference WHERE office_id=? AND case_id=? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 200`)
    .all<ReferenceRow>(context.officeId, caseId);
  const references = await Promise.all(rows.map(row => referenceView(context, row)));
  return mapContentResult(references, ...references, contentResult({}, [{ ...personPolicy('', ''), guards: [{ kind: 'case', id: caseId }] }]));
}

export async function getResearchCaseReference(context: WorkspaceContext, referenceId: string): Promise<ResearchCaseReference> {
  const row = await database.prepare('SELECT * FROM research_case_reference WHERE id=? AND office_id=? AND deleted_at IS NULL')
    .get<ReferenceRow>(referenceId, context.officeId);
  if (!row) throw new CapabilityError('NOT_FOUND', 'Referência não encontrada.');
  await assertResearchCaseAccess(context, row.case_id);
  return referenceView(context, row);
}

export async function addResearchCaseReference(context: WorkspaceContext, raw: AddResearchCaseReferenceInput): Promise<ResearchCaseReference> {
  const input = addResearchCaseReferenceInput.parse(raw);
  if (context.invocation && input.notes !== undefined) throw new CapabilityError('FORBIDDEN', 'A anotação deve vir do pedido registrado.');
  const target = { caseId: input.caseId, materialVersionId: input.materialVersionId, purpose: input.purpose, assessmentId: input.assessmentId, bypassEvaluation: input.bypassEvaluation };
  const prepared = context.invocation && input.change ? await prepareResearchChange(context,'k5_research_add_reference',target,
    { kind: 'notes', caseId: input.caseId, expectedVersion: 0 },input.approvalId,input.change) : undefined;
  const notes = prepared ? (prepared.receipt.output as { notes: string }).notes : input.notes ?? '';
  const notesPolicy = prepared ? combinePolicy('',notes,[prepared.receipt.fieldPolicy],'generated',prepared.receipt.generationAttemptId) : personPolicy('',notes);
  return aclTransaction(async tx => {
  if (prepared) { const replay = await consumedResearchResult(context,prepared.approval,tx); if (replay) return replay as ResearchCaseReference; }
  await assertResearchCaseAccess(context, input.caseId, tx);
  await requireMaterialSnapshot(input.materialVersionId, tx);
  const assessment = await getResearchCaseAssessment(context, input.assessmentId, tx);
  if (!assessment.current || assessment.caseId !== input.caseId || assessment.materialVersionId !== input.materialVersionId)
    throw new CapabilityError('CONFLICT', 'A avaliação não corresponde aos insumos atuais. Tente novamente.');
  if (!input.bypassEvaluation && assessment.status !== 'evaluated')
    throw new CapabilityError('APPROVAL_REQUIRED', 'A avaliação não foi concluída. Escolha adicionar sem avaliação após revisar o estado.');
  const id = randomUUID();
  await tx.prepare(`INSERT INTO research_case_reference(id,office_id,case_id,material_version_id,purpose,notes,notes_policy,notes_receipt,assessment_id,bypass_evaluation,created_by,updated_by)
    VALUES(?,?,?,?,?,?,?::jsonb,?::jsonb,?,?,?,?) ON CONFLICT(office_id,case_id,material_version_id) DO UPDATE SET
      purpose=excluded.purpose,notes=excluded.notes,notes_policy=excluded.notes_policy,notes_receipt=excluded.notes_receipt,assessment_id=excluded.assessment_id,bypass_evaluation=excluded.bypass_evaluation,
      version=research_case_reference.version+1,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP,deleted_at=NULL
      WHERE research_case_reference.deleted_at IS NOT NULL`).run(id, context.officeId, input.caseId, input.materialVersionId,
      input.purpose, notes, JSON.stringify(notesPolicy), JSON.stringify(prepared?.receipt ?? { kind: 'person', receipt: notesPolicy.receipt }), input.assessmentId ?? null, Number(input.bypassEvaluation), context.userId, context.userId);
  const row = (await tx.prepare(`SELECT * FROM research_case_reference WHERE office_id=? AND case_id=? AND material_version_id=? AND deleted_at IS NULL`)
    .get<ReferenceRow>(context.officeId, input.caseId, input.materialVersionId))!;
  const result = await referenceView(context, row, tx);
  if (prepared) await consumeResearchChange(prepared.approval,result,tx);
  return result;
  });
}

export async function updateResearchCaseReference(context: WorkspaceContext, raw: UpdateResearchCaseReferenceInput): Promise<ResearchCaseReference> {
  const input = updateResearchCaseReferenceInput.parse(raw);
  if (context.invocation && input.notes !== undefined) throw new CapabilityError('FORBIDDEN', 'A anotação deve vir do pedido registrado.');
  const base = await database.prepare('SELECT case_id FROM research_case_reference WHERE id=? AND office_id=? AND deleted_at IS NULL').get<{ case_id: string }>(input.referenceId,context.officeId);
  if (!base) throw new CapabilityError('NOT_FOUND', 'Referência não encontrada.');
  const target = { referenceId: input.referenceId, expectedVersion: input.expectedVersion, ...(input.purpose ? { purpose: input.purpose } : {}), ...(input.materialVersionId ? { materialVersionId: input.materialVersionId, assessmentId: input.assessmentId, bypassEvaluation: input.bypassEvaluation } : {}) };
  const prepared = context.invocation && input.change ? await prepareResearchChange(context,'k5_research_update_reference',target,
    { kind: 'notes', caseId: base.case_id, referenceId: input.referenceId, expectedVersion: input.expectedVersion },input.approvalId,input.change) : undefined;
  return aclTransaction(async tx => {
  if (prepared) { const replay = await consumedResearchResult(context,prepared.approval,tx); if (replay) return replay as ResearchCaseReference; }
  const row = await tx.prepare('SELECT * FROM research_case_reference WHERE id=? AND office_id=? AND deleted_at IS NULL')
    .get<ReferenceRow>(input.referenceId, context.officeId);
  if (!row) throw new CapabilityError('NOT_FOUND', 'Referência não encontrada.');
  await assertResearchCaseAccess(context, row.case_id, tx);
  if (input.materialVersionId && input.materialVersionId !== row.material_version_id) {
    const [previous, next] = await Promise.all([materialSnapshot(row.material_version_id, tx), requireMaterialSnapshot(input.materialVersionId, tx)]);
    if (!previous || previous.materialId !== next.materialId)
      throw new CapabilityError('INVALID', 'A nova versão precisa ser do mesmo material do julgado.');
    if (!input.assessmentId) throw new CapabilityError('APPROVAL_REQUIRED', 'Avalie a nova versão antes de substituir a referência.');
    const assessment = await getResearchCaseAssessment(context, input.assessmentId, tx);
    if (!assessment.current || assessment.caseId !== row.case_id || assessment.materialVersionId !== input.materialVersionId)
      throw new CapabilityError('CONFLICT', 'A avaliação da nova versão está desatualizada.');
    if (!input.bypassEvaluation && assessment.status !== 'evaluated')
      throw new CapabilityError('APPROVAL_REQUIRED', 'Escolha adicionar sem avaliação para usar uma versão sem avaliação concluída.');
  }
  const notes = prepared ? (prepared.receipt.output as { notes: string }).notes : input.notes ?? row.notes;
  let notesPolicy = row.notes_policy;
  let notesReceipt = row.notes_receipt;
  if (prepared) {
    notesPolicy = combinePolicy('',notes,[prepared.receipt.fieldPolicy],'generated',prepared.receipt.generationAttemptId); notesReceipt = prepared.receipt;
  } else if (input.notes !== undefined && input.notes !== row.notes) {
    if (!input.readToken) throw new CapabilityError('CONFLICT', 'Reabra a anotação antes de salvar.');
    const seed = await tx.prepare("SELECT scope,digest,content_policy FROM content_seed WHERE id=? AND office_id=? AND user_id=? AND purpose='research-notes'")
      .get<{ scope: { referenceId: string; version: number; notesDigest: string }; digest: string; content_policy: unknown }>(input.readToken,context.officeId,context.userId);
    if (!seed || seed.scope.referenceId !== row.id || seed.scope.version !== row.version || seed.digest !== payloadDigest(seed.scope) || seed.scope.notesDigest !== contentDigest('',row.notes))
      throw new CapabilityError('CONFLICT', 'A anotação mudou. Reabra antes de salvar.');
    const policy = parsePolicy(seed.content_policy); await assertPolicyAccess(context.userId,policy,tx);
    notesPolicy = combinePolicy('',notes,[policy],'person'); notesReceipt = { kind: 'person', readToken: input.readToken, receipt: (notesPolicy as ContentPolicy).receipt };
  }
  const result = await tx.prepare(`UPDATE research_case_reference SET purpose=?,notes=?,notes_policy=?::jsonb,notes_receipt=?::jsonb,material_version_id=?,assessment_id=?,bypass_evaluation=?,version=version+1,updated_by=?,updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND office_id=? AND deleted_at IS NULL AND version=?`)
    .run(input.purpose ?? row.purpose, notes, notesPolicy ? JSON.stringify(notesPolicy) : null, notesReceipt ? JSON.stringify(notesReceipt) : null, input.materialVersionId ?? row.material_version_id,
      input.materialVersionId && input.materialVersionId !== row.material_version_id ? input.assessmentId ?? null : row.assessment_id,
      input.materialVersionId && input.materialVersionId !== row.material_version_id ? Number(input.bypassEvaluation ?? false) : row.bypass_evaluation,
      context.userId, row.id, context.officeId, input.expectedVersion);
  if (!result.changes) throw new CapabilityError('CONFLICT', 'A referência mudou. Atualize antes de salvar.');
  const updated = await tx.prepare('SELECT * FROM research_case_reference WHERE id=?').get<ReferenceRow>(row.id);
  const view = await referenceView(context, updated!, tx);
  if (prepared) await consumeResearchChange(prepared.approval,view,tx);
  return view;
  });
}

export async function removeResearchCaseReference(context: WorkspaceContext, referenceId: string, expectedVersion: number): Promise<void> {
  return aclTransaction(async tx => {
  const row = await tx.prepare('SELECT * FROM research_case_reference WHERE id=? AND office_id=? AND deleted_at IS NULL')
    .get<ReferenceRow>(referenceId, context.officeId);
  if (!row) throw new CapabilityError('NOT_FOUND', 'Referência não encontrada.');
  await assertResearchCaseAccess(context, row.case_id, tx);
  const result = await tx.prepare(`UPDATE research_case_reference SET deleted_at=CURRENT_TIMESTAMP,version=version+1,updated_by=?,updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND office_id=? AND version=? AND deleted_at IS NULL`).run(context.userId, referenceId, context.officeId, expectedVersion);
  if (!result.changes) throw new CapabilityError('CONFLICT', 'A referência mudou. Atualize antes de remover.');
  });
}
