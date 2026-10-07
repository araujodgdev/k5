import { aclReadTransaction } from '@/lib/acl-transaction';
import { contentAdmission } from '@/lib/content-admission';
import { assertPolicyAccess, contentDigest, combinePolicy, exposedPolicies, observeVaultFile, parsePolicy, personPolicy, type ContentPolicy } from '@/lib/content-policy';
import { contentResult } from '@/lib/content-result';
import 'server-only';
import { randomUUID } from 'node:crypto';
import { database, type Transaction } from '@/lib/database';
import type { WorkspaceContext } from '@/lib/application/context';
import { CapabilityError } from '@/lib/capabilities/errors';
import { evaluate, fingerprint, EvaluationConfigurationChanged, type DecisionTransport } from '@/lib/typesafe/client';
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
  input_snapshot: SavedInput | null; content_policy: unknown; authority_json: WorkspaceContext | null; execution_key: string | null; attempts: number; lease_token: string | null; lease_until: number; created_at: string; updated_at: string;
};
type SavedInput = { state: import('@typesafe-ai/sdk').EntryType | null; questions: ReturnType<typeof researchAssessmentQuestions>;
  coverage: ResearchAssessmentResult['coverage']; excerpts: ResearchAssessmentResult['excerpts']; model: string | null; configVersion: number | null; policy: ContentPolicy };

type AssessmentInput = { caseState: Awaited<ReturnType<typeof researchCaseSnapshot>>; material: Awaited<ReturnType<typeof materialSnapshot>>;
  config: Awaited<ReturnType<typeof getConnection>>; profile: NonNullable<Awaited<ReturnType<typeof researchCaseSnapshot>>>['profile'];
  questions: ReturnType<typeof researchAssessmentQuestions>; currentFingerprint: string; reason: string | null; state: SavedInput['state'];
  coverage: SavedInput['coverage']; excerpts: SavedInput['excerpts']; policy: ContentPolicy };
async function assessmentInput(context: WorkspaceContext, caseId: string, materialVersionId: string, db: Transaction = database): Promise<AssessmentInput> {
  if (db === database) return aclReadTransaction(tx => assessmentInput(context,caseId,materialVersionId,tx));
  await assertResearchCaseAccess(context,caseId,db);
  const { officeId, userId } = context;
  const [caseState, material, config] = await Promise.all([
    researchCaseSnapshot(context, caseId, db), materialSnapshot(materialVersionId, db), getConnection(),
  ]);
  const profile = caseState?.profile ?? null;
  const selectedChunkIds = [...new Set(profile?.documentedFacts.flatMap(fact => fact.chunkIds) ?? [])];
  const selectedChunks = selectedChunkIds.length ? await db.prepare(`SELECT c.id,c.document_id,c.stable_reference,c.content
    FROM vault_document_chunk c JOIN vault_document d ON d.id=c.document_id AND d.office_id=c.office_id
    WHERE c.office_id=? AND d.case_id=? AND d.deleted_at IS NULL AND d.status='ready' AND d.extracted_version=(SELECT v.version FROM vault_document_version v WHERE v.document_id=d.id AND v.is_active=1) AND d.extracted_sha256=d.sha256 AND lume_vault_visible(d.id, ?) AND c.id IN (${selectedChunkIds.map(() => '?').join(',')})`)
    .all<{ id: string; document_id: string; stable_reference: string; content: string }>(officeId, caseId, userId, ...selectedChunkIds) : [];

  const fallback = !selectedChunkIds.length && profile?.documentIds.length ? await db.prepare(`SELECT c.id,c.document_id,c.stable_reference,c.content
    FROM vault_document_chunk c JOIN vault_document d ON d.id=c.document_id AND d.office_id=c.office_id
    WHERE c.office_id=? AND d.case_id=? AND d.deleted_at IS NULL AND d.status='ready' AND d.extracted_version=(SELECT v.version FROM vault_document_version v WHERE v.document_id=d.id AND v.is_active=1) AND d.extracted_sha256=d.sha256 AND lume_vault_visible(d.id, ?) AND c.ordinal=0
      AND c.document_id IN (${profile.documentIds.map(() => '?').join(',')}) ORDER BY c.document_id LIMIT 12`)
    .all<{ id: string; document_id: string; stable_reference: string; content: string }>(officeId, caseId, userId, ...profile.documentIds) : [];
  const caseChunks = (selectedChunkIds.length ? selectedChunks : fallback).slice(0, 6);
  const sourceChunks = material?.chunks.slice(0, 6) ?? [];
  const materialChunksAvailable = material ? Number((await db.prepare('SELECT count(*) AS n FROM research_chunk WHERE material_version_id=?').get<{ n: number }>(materialVersionId))?.n ?? 0) : 0;
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
  const reason = !caseState ? 'case_unavailable' : caseState.restricted ? 'profile_restricted' : !profile ? 'profile_missing' : noFacts ? 'facts_missing'
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
  const policies: ContentPolicy[] = [...exposedPolicies(profile) ?? [], { ...personPolicy('', ''), guards: [{ kind: 'case', id: caseId }] }];
  for (const id of [...new Set(caseChunks.map(chunk => chunk.document_id))]) policies.push((await observeVaultFile(userId,id,db)).policy);
  if (material) policies.push({ ...personPolicy(material.title,material.text ?? ''), guards: [{ kind: 'research-material', id: material.versionId }],
    observed: [{ kind: 'research', id: material.versionId, version: material.versionId, digest: material.sha256 }] });
  const policy = combinePolicy('',JSON.stringify({ state, questions, coverage, excerpts }),policies,'generated');
  return { caseState, material, config, profile, questions, currentFingerprint, reason, state, coverage, excerpts, policy };
}

const rowView = (row: AssessmentRow, current: boolean): ResearchCaseAssessment => ({
  id: row.id, caseId: row.case_id, materialVersionId: row.material_version_id, profileVersion: row.profile_version,
  status: current ? row.status : 'stale', current, mode: row.mode, model: row.model, reason: current ? row.reason : 'inputs_changed',
  result: row.result_json ? (() => {
    const saved = JSON.parse(row.result_json) as ResearchAssessmentResult;
    return saved.compositionVersion === researchAssessmentCompositionVersion ? saved :
      { ...saved, composite: composeResearchAssessment(saved.answers), compositionVersion: researchAssessmentCompositionVersion };
  })() : null,
  createdAt: row.created_at, updatedAt: row.updated_at,
});

export async function getResearchCaseAssessment(context: WorkspaceContext, assessmentId: string, db: Transaction = database): Promise<ResearchCaseAssessment> {
  if (db === database) return aclReadTransaction(tx => getResearchCaseAssessment(context,assessmentId,tx));
  const row = await db.prepare('SELECT * FROM research_case_assessment WHERE id=? AND office_id=?')
    .get<AssessmentRow>(assessmentId, context.officeId);
  if (!row) throw new CapabilityError('NOT_FOUND', 'Avaliação não encontrada.');
  await assertResearchCaseAccess(context, row.case_id, db);
  if (!row.content_policy || !row.input_snapshot) {
    return contentResult({ ...rowView(row,false), result: null, reason: 'legacy_source_binding_missing' }, [{ ...personPolicy('', ''), guards: [{ kind: 'case', id: row.case_id }] }]);
  }
  const policy = parsePolicy(row.content_policy,row.result_json ? contentDigest('',row.result_json) : undefined);
  await assertPolicyAccess(context.userId,policy,db);
  const snapshot = await assessmentInput(context, row.case_id, row.material_version_id,db);
  const result = rowView(row, snapshot.currentFingerprint === row.input_fingerprint);
  return contentResult(result,[policy],[{ kind: 'research-assessment', id: row.id, version: row.input_fingerprint, digest: policy.digest }]);
}

export async function assessResearchCaseMaterial(context: WorkspaceContext, input: { caseId: string; materialVersionId: string; idempotencyKey?: string }): Promise<ResearchCaseAssessment> {
  await assertResearchCaseAccess(context, input.caseId);
  const snapshot = await assessmentInput(context, input.caseId, input.materialVersionId);
  if (!snapshot.material) throw new CapabilityError('NOT_FOUND', 'Material não encontrado.');
  const mode: DecisionMode = snapshot.config?.research_mode ?? 'off';
  const status: ResearchAssessmentStatus = snapshot.reason === 'profile_restricted' || snapshot.reason === 'profile_missing' || snapshot.reason === 'facts_missing' ||
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
  const authority: WorkspaceContext = { officeId: context.officeId, userId: context.userId, sessionId: context.sessionId, invocation: context.invocation,
    caseScope: context.caseScope, allowedResearchCaseId: context.allowedResearchCaseId, allowedResearchReferenceIds: context.allowedResearchReferenceIds,
    submissionId: context.submissionId, generationId: context.generationId };
  const executionKey = fingerprint({ authority, request: input.idempotencyKey ?? id, operation: 'research.assessment' });
  const saved: SavedInput = { state: snapshot.state, questions: snapshot.questions, coverage: snapshot.coverage, excerpts: snapshot.excerpts,
    model: snapshot.config?.model ?? null, configVersion: snapshot.config?.version ?? null, policy: snapshot.policy };
  await aclReadTransaction(async tx => {
    await assertResearchCaseAccess(context,input.caseId,tx);
    if (status === 'queued') {
      if (!context.sessionId) throw new CapabilityError('UNAUTHENTICATED', 'Entre novamente para solicitar esta avaliação.');
      await assertPolicyAccess(context.userId,snapshot.policy,tx);
    }
    await tx.prepare(`INSERT INTO research_case_assessment(id,office_id,case_id,material_version_id,requested_by,profile_version,input_fingerprint,status,mode,model,question_version,config_version,reason,input_snapshot,content_policy,authority_json,execution_key)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?::jsonb,?::jsonb,?::jsonb,?) ON CONFLICT(office_id,requested_by,execution_key) WHERE execution_key IS NOT NULL DO NOTHING`).run(
        id,context.officeId,input.caseId,input.materialVersionId,context.userId,snapshot.profile?.version ?? null,snapshot.currentFingerprint,status,mode,
        snapshot.config?.model ?? null,researchAssessmentQuestionVersion,snapshot.config?.version ?? null,snapshot.reason,
        JSON.stringify(saved),JSON.stringify(snapshot.policy),JSON.stringify(authority),executionKey);
  });
  const row = (await database.prepare('SELECT id FROM research_case_assessment WHERE office_id=? AND requested_by=? AND execution_key=?')
    .get<{ id: string }>(context.officeId,context.userId,executionKey))!;
  return getResearchCaseAssessment(context,row.id);
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
    const context = row.authority_json;
    if (!context?.sessionId || context.userId !== row.requested_by || context.officeId !== row.office_id || !row.input_snapshot || !row.content_policy)
      throw new CapabilityError('UNAUTHENTICATED', 'A autoridade original desta avaliação não está disponível.');
    const before = row.input_snapshot;
    const policy = parsePolicy(before.policy);
    const config = await getConnection();
    if (!before.state || config?.version !== row.config_version || config.model !== row.model) throw new EvaluationConfigurationChanged();
    const admission = contentAdmission(context,before,[policy],{ lease: async tx => {
      const current = await tx.prepare('SELECT version,model,enabled FROM typesafe_platform_connection WHERE id=1 FOR SHARE').get<{ version: number; model: string; enabled: number }>();
      if (!current?.enabled || current.version !== row.config_version || current.model !== row.model) throw new EvaluationConfigurationChanged();
      await assertResearchCaseAccess(context,row.case_id,tx);
      const owned = await tx.prepare("SELECT 1 FROM research_case_assessment WHERE id=? AND lease_token=? AND status='running' AND lease_until>?").get(row.id,token,Date.now());
      if (!owned) throw new CapabilityError('CONFLICT', 'Esta avaliação foi substituída.');
    } });
    const evaluated = await evaluate(context, 'research',
      { state: before.state, questions: before.questions, questionVersion: researchAssessmentQuestionVersion },
      { send: options.send, deadlineMs: 10_000, admission, expectedConfiguration: { version: row.config_version!, model: row.model! } });
    await admission.admit();
    const adequacy = evaluated.response?.answers.adequacy;
    const insufficient = adequacy?.type === 'choice' && adequacy.choice === 'insufficient';
    const status: ResearchAssessmentStatus = evaluated.status === 'evaluated' && insufficient ? 'incomplete' : evaluated.status;
    const result: ResearchAssessmentResult | null = evaluated.response ? {
      answers: evaluated.response.answers, composite: composeResearchAssessment(evaluated.response.answers),
      compositionVersion: researchAssessmentCompositionVersion, coverage: before.coverage, excerpts: before.excerpts,
    } : null;
    await database.prepare(`UPDATE research_case_assessment SET status=?,mode=?,model=?,result_json=?,content_policy=?::jsonb,reason=?,typesafe_evaluation_id=?,lease_until=0,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND lease_token=? AND status='running'`).run(status, evaluated.mode, before.model,
        result ? JSON.stringify(result) : null,JSON.stringify(result ? combinePolicy('',JSON.stringify(result),[policy],'generated') : policy), insufficient ? 'evidence_insufficient' : evaluated.reason ?? null,
        evaluated.evaluationId ?? null, row.id, token);
  } catch (error) {
    const reason = error instanceof EvaluationConfigurationChanged ? 'configuration_changed'
      : error instanceof CapabilityError ? error.code === 'UNAUTHENTICATED' ? 'authority_expired' : 'source_denied' : 'processing_failed';
    await database.prepare(`UPDATE research_case_assessment SET status='unavailable',reason=?,lease_until=0,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND lease_token=? AND status='running'`).run(reason,row.id, token);
  }
  return true;
}
