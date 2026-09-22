import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { database } from '@/lib/database';
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
  notes: z.string().trim().max(4000).default(''),
});
export const updateResearchCaseReferenceInput = z.object({
  referenceId: z.uuid(), expectedVersion: z.number().int().positive(),
  purpose: researchReferencePurpose.optional(), notes: z.string().trim().max(4000).optional(),
  materialVersionId: z.uuid().optional(), assessmentId: z.uuid().optional(), bypassEvaluation: z.boolean().optional(),
});
export type AddResearchCaseReferenceInput = z.input<typeof addResearchCaseReferenceInput>;
export type UpdateResearchCaseReferenceInput = z.input<typeof updateResearchCaseReferenceInput>;
type ReferenceRow = {
  id: string; office_id: string; case_id: string; material_version_id: string;
  purpose: z.infer<typeof researchReferencePurpose>; notes: string; assessment_id: string | null;
  bypass_evaluation: number; version: number; created_by: string; updated_by: string;
  created_at: string; updated_at: string; deleted_at: string | null;
};
export type ResearchCaseReference = {
  id: string; caseId: string; materialVersionId: string; purpose: z.infer<typeof researchReferencePurpose>;
  notes: string; assessmentId: string | null; assessment: ResearchCaseAssessment | null;
  bypassEvaluation: boolean; version: number; createdAt: string; updatedAt: string;
  material: Pick<MaterialSnapshot, 'materialId' | 'kind' | 'materialStatus' | 'judgmentStatus' | 'title' | 'tribunal' | 'courtUnit' |
    'caseNumber' | 'decisionDate' | 'sourceUrl' | 'judgmentId' | 'currentVersionId' | 'localAllowed'> | null;
};

async function referenceView(context: WorkspaceContext, row: ReferenceRow): Promise<ResearchCaseReference> {
  const material = await materialSnapshot(row.material_version_id);
  const assessment = row.assessment_id ? await getResearchCaseAssessment(context, row.assessment_id) : null;
  return { id: row.id, caseId: row.case_id, materialVersionId: row.material_version_id, purpose: row.purpose,
    notes: row.notes, assessmentId: row.assessment_id, assessment, bypassEvaluation: !!row.bypass_evaluation,
    version: row.version, createdAt: row.created_at, updatedAt: row.updated_at,
    material: material ? { materialId: material.materialId, kind: material.kind, materialStatus: material.materialStatus,
      judgmentStatus: material.judgmentStatus, title: material.title, tribunal: material.tribunal,
      courtUnit: material.courtUnit, caseNumber: material.caseNumber, decisionDate: material.decisionDate,
      sourceUrl: material.sourceUrl, judgmentId: material.judgmentId, currentVersionId: material.currentVersionId,
      localAllowed: material.localAllowed } : null };
}

export async function listResearchCaseReferences(context: WorkspaceContext, caseId: string): Promise<ResearchCaseReference[]> {
  await assertResearchCaseAccess(context, caseId);
  const rows = await database.prepare(`SELECT * FROM research_case_reference WHERE office_id=? AND case_id=? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 200`)
    .all<ReferenceRow>(context.officeId, caseId);
  return Promise.all(rows.map(row => referenceView(context, row)));
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
  await assertResearchCaseAccess(context, input.caseId, true);
  await requireMaterialSnapshot(input.materialVersionId);
  const assessment = await getResearchCaseAssessment(context, input.assessmentId);
  if (!assessment.current || assessment.caseId !== input.caseId || assessment.materialVersionId !== input.materialVersionId)
    throw new CapabilityError('CONFLICT', 'A avaliação não corresponde aos insumos atuais. Tente novamente.');
  if (!input.bypassEvaluation && assessment.status !== 'evaluated')
    throw new CapabilityError('APPROVAL_REQUIRED', 'A avaliação não foi concluída. Escolha adicionar sem avaliação após revisar o estado.');
  const id = randomUUID();
  await database.prepare(`INSERT INTO research_case_reference(id,office_id,case_id,material_version_id,purpose,notes,assessment_id,bypass_evaluation,created_by,updated_by)
    VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(office_id,case_id,material_version_id) DO UPDATE SET
      purpose=excluded.purpose,notes=excluded.notes,assessment_id=excluded.assessment_id,bypass_evaluation=excluded.bypass_evaluation,
      version=research_case_reference.version+1,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP,deleted_at=NULL
      WHERE research_case_reference.deleted_at IS NOT NULL`).run(id, context.officeId, input.caseId, input.materialVersionId,
      input.purpose, input.notes, input.assessmentId ?? null, Number(input.bypassEvaluation), context.userId, context.userId);
  const row = (await database.prepare(`SELECT * FROM research_case_reference WHERE office_id=? AND case_id=? AND material_version_id=? AND deleted_at IS NULL`)
    .get<ReferenceRow>(context.officeId, input.caseId, input.materialVersionId))!;
  return referenceView(context, row);
}

export async function updateResearchCaseReference(context: WorkspaceContext, raw: UpdateResearchCaseReferenceInput): Promise<ResearchCaseReference> {
  const input = updateResearchCaseReferenceInput.parse(raw);
  const row = await database.prepare('SELECT * FROM research_case_reference WHERE id=? AND office_id=? AND deleted_at IS NULL')
    .get<ReferenceRow>(input.referenceId, context.officeId);
  if (!row) throw new CapabilityError('NOT_FOUND', 'Referência não encontrada.');
  await assertResearchCaseAccess(context, row.case_id, true);
  if (input.materialVersionId && input.materialVersionId !== row.material_version_id) {
    const [previous, next] = await Promise.all([materialSnapshot(row.material_version_id), requireMaterialSnapshot(input.materialVersionId)]);
    if (!previous || previous.materialId !== next.materialId)
      throw new CapabilityError('INVALID', 'A nova versão precisa ser do mesmo material do julgado.');
    if (!input.assessmentId) throw new CapabilityError('APPROVAL_REQUIRED', 'Avalie a nova versão antes de substituir a referência.');
    const assessment = await getResearchCaseAssessment(context, input.assessmentId);
    if (!assessment.current || assessment.caseId !== row.case_id || assessment.materialVersionId !== input.materialVersionId)
      throw new CapabilityError('CONFLICT', 'A avaliação da nova versão está desatualizada.');
    if (!input.bypassEvaluation && assessment.status !== 'evaluated')
      throw new CapabilityError('APPROVAL_REQUIRED', 'Escolha adicionar sem avaliação para usar uma versão sem avaliação concluída.');
  }
  const result = await database.prepare(`UPDATE research_case_reference SET purpose=?,notes=?,material_version_id=?,assessment_id=?,bypass_evaluation=?,version=version+1,updated_by=?,updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND office_id=? AND deleted_at IS NULL AND version=?`)
    .run(input.purpose ?? row.purpose, input.notes ?? row.notes, input.materialVersionId ?? row.material_version_id,
      input.materialVersionId && input.materialVersionId !== row.material_version_id ? input.assessmentId ?? null : row.assessment_id,
      input.materialVersionId && input.materialVersionId !== row.material_version_id ? Number(input.bypassEvaluation ?? false) : row.bypass_evaluation,
      context.userId, row.id, context.officeId, input.expectedVersion);
  if (!result.changes) throw new CapabilityError('CONFLICT', 'A referência mudou. Atualize antes de salvar.');
  return getResearchCaseReference(context, row.id);
}

export async function removeResearchCaseReference(context: WorkspaceContext, referenceId: string, expectedVersion: number): Promise<void> {
  const row = await database.prepare('SELECT * FROM research_case_reference WHERE id=? AND office_id=? AND deleted_at IS NULL')
    .get<ReferenceRow>(referenceId, context.officeId);
  if (!row) throw new CapabilityError('NOT_FOUND', 'Referência não encontrada.');
  await assertResearchCaseAccess(context, row.case_id, true);
  const result = await database.prepare(`UPDATE research_case_reference SET deleted_at=CURRENT_TIMESTAMP,version=version+1,updated_by=?,updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND office_id=? AND version=? AND deleted_at IS NULL`).run(context.userId, referenceId, context.officeId, expectedVersion);
  if (!result.changes) throw new CapabilityError('CONFLICT', 'A referência mudou. Atualize antes de remover.');
}
