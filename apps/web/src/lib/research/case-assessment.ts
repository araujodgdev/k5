import 'server-only';
import { randomUUID } from 'node:crypto';
import { database } from '@/lib/database';
import type { WorkspaceContext } from '@/lib/application/context';
import { CapabilityError } from '@/lib/capabilities/errors';
import { evaluate, fingerprint, type DecisionTransport } from '@/lib/typesafe/client';
import { getConnection } from '@/lib/typesafe/config';
import type { DecisionMode } from '@/lib/typesafe/contracts';
import { assertResearchCaseAccess, researchCaseSnapshot } from './case-profile';
import { materialSnapshot } from './case-material';
import { assertResearchWritableRuntime } from './runtime';
import { ResearchError } from './contracts';
import { composeResearchAssessment, researchAssessmentCompositionVersion, researchAssessmentQuestions, researchAssessmentQuestionVersion,
  type ResearchCaseAssessment, type ResearchAssessmentResult, type ResearchAssessmentStatus } from './case-assessment-contracts';

type AssessmentRow = {
  id: string; office_id: string; case_id: string; material_version_id: string; requested_by: string;
  profile_version: number | null; input_fingerprint: string; status: ResearchAssessmentStatus;
  mode: DecisionMode; model: string | null; question_version: string; config_version: number | null;
  result_json: string | null; reason: string | null; typesafe_evaluation_id: string | null;
  attempts: number; lease_token: string | null; lease_until: number; created_at: string; updated_at: string;
};
/** A bounded source set, with coverage declared. The source text is untrusted data for Jev. */
async function assessmentInput(officeId: string, caseId: string, materialVersionId: string) {
  const [caseState, material, config] = await Promise.all([
    researchCaseSnapshot(officeId, caseId), materialSnapshot(materialVersionId), getConnection(),
  ]);
  const profile = caseState?.profile ?? null;
  const selectedChunkIds = [...new Set(profile?.documentedFacts.flatMap(fact => fact.chunkIds) ?? [])];
  const selectedChunks = selectedChunkIds.length ? await database.prepare(`SELECT c.id,c.document_id,c.stable_reference,c.content
    FROM vault_document_chunk c JOIN vault_document d ON d.id=c.document_id AND d.office_id=c.office_id
    WHERE c.office_id=? AND d.case_id=? AND d.deleted_at IS NULL AND d.status='ready' AND c.id IN (${selectedChunkIds.map(() => '?').join(',')})`)
    .all<{ id: string; document_id: string; stable_reference: string; content: string }>(officeId, caseId, ...selectedChunkIds) : [];
  // A documented fact can cite the document alone. Use one bounded chunk per selected document when no span was selected.
  const fallback = !selectedChunkIds.length && profile?.documentIds.length ? await database.prepare(`SELECT c.id,c.document_id,c.stable_reference,c.content
    FROM vault_document_chunk c JOIN vault_document d ON d.id=c.document_id AND d.office_id=c.office_id
    WHERE c.office_id=? AND d.case_id=? AND d.deleted_at IS NULL AND d.status='ready' AND c.ordinal=0
      AND c.document_id IN (${profile.documentIds.map(() => '?').join(',')}) ORDER BY c.document_id LIMIT 12`)
    .all<{ id: string; document_id: string; stable_reference: string; content: string }>(officeId, caseId, ...profile.documentIds) : [];
  const caseChunks = (selectedChunkIds.length ? selectedChunks : fallback).slice(0, 6);
  const sourceChunks = material?.chunks.slice(0, 6) ?? [];
  const materialChunksAvailable = material ? Number((await database.prepare('SELECT count(*) AS n FROM research_chunk WHERE material_version_id=?').get<{ n: number }>(materialVersionId))?.n ?? 0) : 0;
  const questions = researchAssessmentQuestions(Boolean(profile?.thesis));
  const currentFingerprint = fingerprint({ officeId, caseId, case: caseState?.caseRow ?? null,
    profile, docs: caseState?.docs ?? [], caseChunks: caseChunks.map(c => [c.id,c.document_id,fingerprint(c.content)]),
    material: material && { versionId: material.versionId, sha256: material.sha256, parserVersion: material.parserVersion,
      metadataRevision: material.metadataRevision, judgmentMetadataRevision: material.judgmentMetadataRevision,
      citationMetadata: material.citationMetadata, judgmentStatus: material.judgmentStatus,
      materialStatus: material.materialStatus, currentVersionId: material.currentVersionId, policy: material.installationFingerprint,
      chunks: sourceChunks.map(c => [c.id,fingerprint(c.text)]), materialChunksAvailable },
    model: config?.model ?? null, configVersion: config?.version ?? 0, mode: config?.research_mode ?? 'off',
    questionVersion: researchAssessmentQuestionVersion, questions,
  });
  const missingDocs = !!profile && (caseState?.docs.length !== profile.documentIds.length || caseState.docs.some(doc => doc.deleted_at || doc.status !== 'ready'));
  const missingChunks = selectedChunkIds.length > 0 && selectedChunks.length !== selectedChunkIds.length;
  const noFacts = !profile || (!profile.documentedFacts.length && !profile.allegedFacts.length);
  const reason = !caseState ? 'case_unavailable' : !profile ? 'profile_missing' : noFacts ? 'facts_missing'
    : missingDocs || missingChunks ? 'case_evidence_changed' : !material ? 'material_missing'
    : !material.localAllowed ? 'source_unavailable' : !material.aiAllowed ? 'source_ai_not_permitted'
    : !sourceChunks.length ? 'material_text_missing' : null;
  const documentedFacts = profile?.documentedFacts.slice(0, 8).map(fact => ({ text: fact.text.slice(0, 350), documentIds: fact.documentIds })) ?? [];
  const allegedFacts = profile?.allegedFacts.slice(0, 6).map(fact => fact.slice(0, 250)) ?? [];
  const gaps = profile?.gaps.slice(0, 6).map(gap => gap.slice(0, 200)) ?? [];
  const coverage = { caseChunksUsed: caseChunks.length, materialChunksUsed: sourceChunks.length,
    materialChunksAvailable, partial: materialChunksAvailable > sourceChunks.length ||
      (profile?.documentIds.length ?? 0) > caseChunks.length || selectedChunks.length > caseChunks.length ||
      (profile?.documentedFacts.length ?? 0) > documentedFacts.length ||
      (profile?.allegedFacts.length ?? 0) > allegedFacts.length || (profile?.gaps.length ?? 0) > gaps.length ||
      !!profile?.documentedFacts.some(fact => fact.text.length > 350) ||
      !!profile?.allegedFacts.some(fact => fact.length > 250) || !!profile?.gaps.some(gap => gap.length > 200) ||
      !!caseChunks.find(chunk => chunk.content.length > 400) || !!sourceChunks.find(chunk => chunk.text.length > 650) ||
      !!profile && (profile.legalQuestion.length > 600 || profile.objective.length > 600) };
  const excerpts: ResearchAssessmentResult['excerpts'] = [
    ...caseChunks.map(c => ({ source: 'vault' as const, id: c.id, reference: c.stable_reference, excerpt: c.content.slice(0, 400) })),
    ...sourceChunks.map(c => ({ source: 'research' as const, id: c.id, reference: c.reference, excerpt: c.text.slice(0, 650) })),
  ];
  const state = profile && material ? {
    profile: { legalQuestion: profile.legalQuestion.slice(0, 600), objective: profile.objective.slice(0, 600), thesis: profile.thesis?.slice(0, 600) ?? null,
      documentedFacts, allegedFacts, gaps,
      evidence: caseChunks.map(chunk => ({ id: chunk.id, documentId: chunk.document_id, reference: chunk.stable_reference, text: chunk.content.slice(0, 400) })) },
    judgment: { title: material.title, tribunal: material.tribunal, courtUnit: material.courtUnit,
      caseNumber: material.caseNumber, decisionDate: material.decisionDate, materialKind: material.kind,
      materialVersionId: material.versionId, excerpts: sourceChunks.map(chunk => ({ id: chunk.id, reference: chunk.reference, text: chunk.text.slice(0, 650) })) },
    coverage,
  } : null;
  return { caseState, material, config, profile, questions, currentFingerprint, reason, state, coverage, excerpts };
}

// A shadow-mode result stays in the row for evaluation, but is shown and gated like a disabled one.
const shownStatus = (row: AssessmentRow): ResearchAssessmentStatus =>
  row.mode === 'shadow' && (row.status === 'evaluated' || row.status === 'incomplete') ? 'disabled' : row.status;

const rowView = (row: AssessmentRow, current: boolean): ResearchCaseAssessment => ({
  id: row.id, caseId: row.case_id, materialVersionId: row.material_version_id, profileVersion: row.profile_version,
  status: current ? shownStatus(row) : 'stale', current, mode: row.mode, model: row.model, reason: current ? row.reason : 'inputs_changed',
  result: row.result_json && row.mode !== 'shadow' ? (() => {
    const saved = JSON.parse(row.result_json) as ResearchAssessmentResult;
    return saved.compositionVersion === researchAssessmentCompositionVersion ? saved :
      { ...saved, composite: composeResearchAssessment(saved.answers), compositionVersion: researchAssessmentCompositionVersion };
  })() : null,
  createdAt: row.created_at, updatedAt: row.updated_at,
});

export async function getResearchCaseAssessment(context: WorkspaceContext, assessmentId: string): Promise<ResearchCaseAssessment> {
  const row = await database.prepare('SELECT * FROM research_case_assessment WHERE id=? AND office_id=?')
    .get<AssessmentRow>(assessmentId, context.officeId);
  if (!row) throw new CapabilityError('NOT_FOUND', 'Avaliação não encontrada.');
  await assertResearchCaseAccess(context, row.case_id);
  const current = (await assessmentInput(context.officeId, row.case_id, row.material_version_id)).currentFingerprint === row.input_fingerprint;
  return rowView(row, current);
}

export async function assessResearchCaseMaterial(context: WorkspaceContext, input: { caseId: string; materialVersionId: string }): Promise<ResearchCaseAssessment> {
  await assertResearchCaseAccess(context, input.caseId, true);
  const snapshot = await assessmentInput(context.officeId, input.caseId, input.materialVersionId);
  if (!snapshot.material) throw new CapabilityError('NOT_FOUND', 'Material não encontrado.');
  const mode: DecisionMode = snapshot.config?.research_mode ?? 'off';
  const status: ResearchAssessmentStatus = snapshot.reason === 'profile_missing' || snapshot.reason === 'facts_missing' ||
    snapshot.reason === 'case_evidence_changed' || snapshot.reason === 'material_text_missing' ? 'incomplete'
    : snapshot.reason ? 'unavailable' : !snapshot.config?.enabled || !snapshot.config.encrypted_api_key || mode === 'off' ? 'disabled' : 'queued';
  if (status === 'queued') {
    try { await assertResearchWritableRuntime(); }
    catch (error) {
      if (error instanceof ResearchError && error.code === 'unsupported')
        throw new CapabilityError('NOT_READY', error.message);
      throw error;
    }
  }
  const id = randomUUID();
  await database.prepare(`INSERT INTO research_case_assessment(id,office_id,case_id,material_version_id,requested_by,profile_version,input_fingerprint,status,mode,model,question_version,config_version,reason)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(office_id,case_id,material_version_id,input_fingerprint) DO NOTHING`).run(
      id, context.officeId, input.caseId, input.materialVersionId, context.userId, snapshot.profile?.version ?? null,
      snapshot.currentFingerprint, status, mode, snapshot.config?.model ?? null, researchAssessmentQuestionVersion,
      snapshot.config?.version ?? null, snapshot.reason,
    );
  const row = (await database.prepare(`SELECT * FROM research_case_assessment WHERE office_id=? AND case_id=? AND material_version_id=? AND input_fingerprint=?`)
    .get<AssessmentRow>(context.officeId, input.caseId, input.materialVersionId, snapshot.currentFingerprint))!;
  if (row.status === 'unavailable' || row.status === 'budget_exceeded') {
    await database.prepare("UPDATE research_case_assessment SET status='queued',reason=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('unavailable','budget_exceeded') AND attempts<5 AND ?='queued'")
      .run(row.id, status);
  }
  return getResearchCaseAssessment(context, row.id);
}

/** One leased assessment per call. The document worker invokes this independently of OCR/drafts. */
export async function processNextResearchAssessment(options: { send?: DecisionTransport } = {}): Promise<boolean> {
  const now = Date.now();
  const exhausted = await database.prepare(`UPDATE research_case_assessment SET status='unavailable',reason='attempts_exhausted',lease_until=0,updated_at=CURRENT_TIMESTAMP
    WHERE attempts>=5 AND (status='queued' OR (status='running' AND lease_until<?))`).run(now);
  if (exhausted.changes) return true;
  const token = randomUUID();
  const row = await database.prepare(`UPDATE research_case_assessment SET status='running',lease_token=?,lease_until=?,attempts=attempts+1,updated_at=CURRENT_TIMESTAMP
    WHERE id=(SELECT id FROM research_case_assessment WHERE (status='queued' OR (status='running' AND lease_until<?)) AND attempts<5 ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
      AND (status='queued' OR (status='running' AND lease_until<?)) RETURNING *`)
    .get<AssessmentRow>(token, now + 30_000, now, now);
  if (!row) return false;
  try {
    const context: WorkspaceContext = { officeId: row.office_id, userId: row.requested_by, role: 'lawyer' };
    await assertResearchCaseAccess(context, row.case_id, true);
    const before = await assessmentInput(row.office_id, row.case_id, row.material_version_id);
    if (before.currentFingerprint !== row.input_fingerprint || before.reason || !before.state) {
      await database.prepare("UPDATE research_case_assessment SET status='stale',reason='inputs_changed',lease_until=0,updated_at=CURRENT_TIMESTAMP WHERE id=? AND lease_token=?")
        .run(row.id, token);
      return true;
    }
    const evaluated = await evaluate({ officeId: row.office_id, userId: row.requested_by }, 'research',
      { state: before.state, questions: before.questions, questionVersion: researchAssessmentQuestionVersion },
      { send: options.send, deadlineMs: 10_000 });
    const after = await assessmentInput(row.office_id, row.case_id, row.material_version_id);
    if (after.currentFingerprint !== row.input_fingerprint) {
      await database.prepare("UPDATE research_case_assessment SET status='stale',reason='inputs_changed',lease_until=0,updated_at=CURRENT_TIMESTAMP WHERE id=? AND lease_token=?")
        .run(row.id, token);
      return true;
    }
    const adequacy = evaluated.response?.answers.adequacy;
    const insufficient = adequacy?.type === 'choice' && adequacy.choice === 'insufficient';
    const status: ResearchAssessmentStatus = evaluated.status === 'evaluated' && insufficient ? 'incomplete' : evaluated.status;
    const result: ResearchAssessmentResult | null = evaluated.response ? {
      answers: evaluated.response.answers, composite: composeResearchAssessment(evaluated.response.answers),
      compositionVersion: researchAssessmentCompositionVersion, coverage: before.coverage, excerpts: before.excerpts,
    } : null;
    await database.prepare(`UPDATE research_case_assessment SET status=?,mode=?,model=?,result_json=?,reason=?,typesafe_evaluation_id=?,lease_until=0,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND lease_token=? AND status='running'`).run(status, evaluated.mode, before.config?.model ?? null,
        result ? JSON.stringify(result) : null, insufficient ? 'evidence_insufficient' : evaluated.reason ?? null,
        evaluated.evaluationId ?? null, row.id, token);
  } catch {
    await database.prepare(`UPDATE research_case_assessment SET status='unavailable',reason='processing_failed',lease_until=0,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND lease_token=? AND status='running'`).run(row.id, token);
  }
  return true;
}
