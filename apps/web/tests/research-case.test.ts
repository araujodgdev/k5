import './test-setup';
import { testDb } from './test-setup';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { WorkspaceContext } from '../src/lib/application/context';
import { getResearchCaseProfile, saveResearchCaseProfile } from '../src/lib/research/case-profile';
import { assessResearchCaseMaterial, getResearchCaseAssessment, processNextResearchAssessment } from '../src/lib/research/case-assessment';
import { materialSnapshot } from '../src/lib/research/case-material';
import { addResearchCaseReference, listResearchCaseReferences, removeResearchCaseReference, updateResearchCaseReference } from '../src/lib/research/case-references';
import { selectedPinnedResearchSources, selectedResearchSources, resolveArtifactResearchSource } from '../src/lib/ai-sources';
import { citationCandidates } from '../src/lib/ai-policy';

test('trecho de jurisprudência selecionado pode ser citado sem palavra-chave no texto', () => {
  const text = 'Os cuidados cotidianos da avó asseguraram estabilidade à criança.';
  const research = citationCandidates([{ id: 'chunk-r', sourceType: 'research', text, sourceLabel: 'Ementa oficial',
    materialVersionId: 'version-r', researchChunkId: 'chunk-r' }]);
  assert.equal(research.length, 1);
  assert.equal(research[0].text, text);
  assert.equal(research[0].id, citationCandidates([{ id: 'chunk-r', sourceType: 'research', text,
    sourceLabel: 'Ementa oficial' }])[0].id);
  assert.equal(citationCandidates([{ id: 'chunk-v', sourceType: 'vault', text, sourceLabel: 'Cofre' }]).length, 0);
});
import { composeResearchAssessment, researchAssessmentQuestions } from '../src/lib/research/case-assessment-contracts';
import { rerankResearchResults } from '../src/lib/typesafe/research-rerank';
import { saveConnection, connectionView } from '../src/lib/typesafe/config';
import { connectionSettings } from '../src/lib/typesafe/contracts';
import type { DecisionTransport } from '../src/lib/typesafe/client';

async function fixture(role: WorkspaceContext['role'] = 'lawyer') {
  const officeId = randomUUID(), userId = randomUUID(), caseId = randomUUID(), documentId = randomUUID(), chunkId = randomUUID();
  (await testDb.prepare('INSERT INTO office(id,name) VALUES(?,?)').run(officeId, 'Escritório de teste'));
  (await testDb.prepare('INSERT INTO user(id,email,name) VALUES(?,?,?)').run(userId, `${userId}@example.test`, 'Advogada'));
  (await testDb.prepare('INSERT INTO office_member(id,office_id,user_id,role) VALUES(?,?,?,?)').run(randomUUID(), officeId, userId, role));
  (await testDb.prepare('INSERT INTO vault_case(id,office_id,name,created_by) VALUES(?,?,?,?)').run(caseId, officeId, 'Caso da cliente', userId));
  (await testDb.prepare(`INSERT INTO vault_document(id,office_id,case_id,scope,original_name,stored_name,mime_type,byte_size,sha256,status,created_by)
    VALUES(?,?,?,'case','relato.txt',?,'text/plain',100,?,'ready',?)`)
    .run(documentId, officeId, caseId, randomUUID(), randomUUID().replaceAll('-', ''), userId));
  (await testDb.prepare('INSERT INTO vault_document_chunk(id,document_id,office_id,ordinal,stable_reference,content) VALUES(?,?,?,?,?,?)')
    .run(chunkId, documentId, officeId, 0, 'linha:1', 'A avó cuida da criança desde janeiro, conforme o relatório anexado.'));
  return { context: { officeId, userId, role }, caseId, documentId, chunkId };
}

async function publicMaterial() {
  const installationId = randomUUID(), judgmentId = randomUUID(), materialId = randomUUID(), versionId = randomUUID(), chunkId = randomUUID();
  (await testDb.prepare(`INSERT INTO judicial_source_installation(id,kind,court_code,court_name,degree,system,purpose,auth_kind,discovery_status,
    permission_query,permission_cache,permission_documents,permission_redistribution,permission_ai,enabled)
    VALUES(?,'jurisprudence_api',?,'Tribunal de Justiça','second','proprietary','jurisprudence','none','pilot',
    'permitido','permitido','permitido','permitido','permitido',1)`).run(installationId, `TJ${installationId.slice(0, 6)}`));
  (await testDb.prepare(`INSERT INTO research_judgment(id,installation_id,source_judgment_id,tribunal,title,metadata_hash,collected_at,status)
    VALUES(?,?,?,?,?,?,?,'active')`).run(judgmentId, installationId, randomUUID(), 'TJDFT', 'Guarda pela avó', 'abc', '2026-09-01'));
  (await testDb.prepare(`INSERT INTO research_material(id,judgment_id,kind,status,current_version_id) VALUES(?,?,'ementa','ready',?)`)
    .run(materialId, judgmentId, versionId));
  const text = 'Acórdão sobre guarda da criança pela avó em situação de cuidado continuado.';
  (await testDb.prepare(`INSERT INTO research_material_version(id,material_id,sha256,mime_type,byte_size,text_content,parser_version,citation_metadata_json,
    metadata_revision,collected_at,published_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
    .run(versionId, materialId, randomUUID().replaceAll('-', ''), 'text/plain', text.length, text, 'v1',
      JSON.stringify({ tribunal: 'TJDFT', title: 'Guarda pela avó', courtUnit: null, caseNumber: '0001', decisionDate: '2026-01-02', sourceUrl: 'https://example.test/julgado' }),
      1, '2026-09-01', '2026-09-01'));
  (await testDb.prepare('INSERT INTO research_chunk(id,material_version_id,ordinal,text_content,reference) VALUES(?,?,0,?,?)')
    .run(chunkId, versionId, text, 'ementa:1'));
  return { installationId, judgmentId, materialId, versionId, chunkId, text };
}

const profileInput = (f: Awaited<Awaited<ReturnType<typeof fixture>>>) => ({ caseId: f.caseId, expectedVersion: 0,
  legalQuestion: 'Quando a guarda pode ser atribuída à avó?', objective: 'Avaliar pedido de guarda.',
  thesis: 'A guarda deve permanecer com a avó.',
  documentedFacts: [{ text: 'A avó cuida da criança desde janeiro.', documentIds: [f.documentId], chunkIds: [f.chunkId] }],
  allegedFacts: ['O pai está ausente.'], gaps: ['Falta comprovar a rotina escolar.'], documentIds: [f.documentId] });

const sendOpposes: DecisionTransport = async (_key, request) => ({ model: request.model, usage: { input_tokens: 100, output_tokens: 20 },
  answers: Object.fromEntries(Object.entries(request.questions).map(([name, question]) => {
    if (question.type === 'score') {
      const score = name === 'factual' ? 3 : 4;
      return [name, { type: 'score', score, confidence: 0.8,
        probabilities: Object.fromEntries(question.criteria.map((_, i) => [String(i), Number(i === score)])) }];
    }
    const choice = name === 'stance' ? 'opposes' : 'adequate';
    return [name, { type: 'choice', choice, confidence: 0.8,
      probabilities: Object.fromEntries(Object.keys(question.criteria ?? {}).map(key => [key, Number(key === choice)])) }];
  })) });

test('profile versions, per-fact evidence, reviewer and office isolation', async () => {
  const a = (await fixture()), b = (await fixture()), reviewer = (await fixture('reviewer'));
  assert.equal(await getResearchCaseProfile(a.context, a.caseId), null);
  await assert.rejects(saveResearchCaseProfile(a.context, { ...profileInput(a), documentedFacts: [{ text: 'Fato externo', documentIds: [b.documentId], chunkIds: [] }] }), { code: 'INVALID' });
  const saved = await saveResearchCaseProfile(a.context, profileInput(a));
  assert.equal(saved.version, 1); assert.deepEqual(saved.documentedFacts[0].chunkIds, [a.chunkId]);
  await assert.rejects(saveResearchCaseProfile(a.context, profileInput(a)), { code: 'CONFLICT' });
  await assert.rejects(getResearchCaseProfile(b.context, a.caseId), { code: 'NOT_FOUND' });
  await assert.rejects(saveResearchCaseProfile(reviewer.context, profileInput(reviewer)), { code: 'FORBIDDEN' });
  assert.equal((await testDb.prepare('SELECT count(*) AS n FROM research_case_profile_revision WHERE case_id=?').get(a.caseId))!.n, 1);
});

test('queued assessment keeps stance apart from relevance and invalidates changed evidence', async () => {
  const a = (await fixture()), material = (await publicMaterial());
  await saveResearchCaseProfile(a.context, profileInput(a));
  (await testDb.prepare('INSERT INTO platform_admin(user_id) VALUES(?)').run(a.context.userId));
  await saveConnection(a.context.userId, connectionSettings.parse({ apiKey: 'synthetic-key-not-secret', enabled: true,
    research: 'enabled', version: (await connectionView()).version }));
  const queued = await assessResearchCaseMaterial(a.context, { caseId: a.caseId, materialVersionId: material.versionId });
  assert.equal(queued.status, 'queued');
  assert.equal(await processNextResearchAssessment({ send: sendOpposes }), true);
  const evaluated = await getResearchCaseAssessment(a.context, queued.id);
  assert.equal(evaluated.status, 'evaluated'); assert.equal(evaluated.result?.answers.stance.type, 'choice');
  assert.equal(evaluated.result?.answers.stance.type === 'choice' && evaluated.result.answers.stance.choice, 'opposes');
  assert.equal(evaluated.result?.composite, 0.9);
  assert.equal(evaluated.result?.excerpts.some(item => item.source === 'vault' && item.id === a.chunkId), true);
  const link = await addResearchCaseReference(a.context, { caseId: a.caseId, materialVersionId: material.versionId,
    purpose: 'counterpoint', assessmentId: evaluated.id });
  assert.equal(link.purpose, 'counterpoint');
  (await testDb.prepare('UPDATE vault_document SET sha256=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(randomUUID(), a.documentId));
  assert.equal((await getResearchCaseAssessment(a.context, queued.id)).status, 'stale');
  await assert.rejects(addResearchCaseReference(a.context, { caseId: a.caseId, materialVersionId: material.versionId,
    purpose: 'foundation', assessmentId: evaluated.id }), { code: 'CONFLICT' });
});

test('explicit bypass, idempotent link, pinned historical citation and office boundaries', async () => {
  const a = (await fixture()), b = (await fixture()), material = (await publicMaterial());
  await saveResearchCaseProfile(a.context, profileInput(a));
  // The platform connection is shared by every test in this file; research starts switched off here.
  (await testDb.prepare("UPDATE typesafe_platform_connection SET research_mode='off' WHERE id=1").run());
  const disabled = await assessResearchCaseMaterial(a.context, { caseId: a.caseId, materialVersionId: material.versionId });
  assert.equal(disabled.status, 'disabled');
  await assert.rejects(addResearchCaseReference(a.context, { caseId: a.caseId, materialVersionId: material.versionId,
    purpose: 'context', assessmentId: disabled.id }), { code: 'APPROVAL_REQUIRED' });
  const first = await addResearchCaseReference(a.context, { caseId: a.caseId, materialVersionId: material.versionId,
    purpose: 'context', assessmentId: disabled.id, bypassEvaluation: true });
  const same = await addResearchCaseReference(a.context, { caseId: a.caseId, materialVersionId: material.versionId,
    purpose: 'counterpoint', assessmentId: disabled.id, bypassEvaluation: true });
  assert.equal(first.id, same.id); assert.equal(same.purpose, 'context');
  await assert.rejects(listResearchCaseReferences(b.context, a.caseId), { code: 'NOT_FOUND' });
  await assert.rejects(selectedResearchSources(b.context, a.caseId, [first.id]), { code: 'NOT_FOUND' });
  const pinned = [{ referenceId: first.id, materialVersionId: material.versionId }];
  const source = (await selectedPinnedResearchSources(a.context, a.caseId, pinned))[0];
  (await testDb.prepare("UPDATE research_judgment SET court_unit='Unidade nova',source_url='https://example.test/novo',title='Título novo' WHERE id=?")
    .run(material.judgmentId));
  const historical = await materialSnapshot(material.versionId);
  assert.ok(historical);
  assert.equal(historical.courtUnit, null);
  assert.equal(historical.sourceUrl, 'https://example.test/julgado');
  assert.equal(historical.title, 'Guarda pela avó');
  const candidate = citationCandidates([source]).find(item => item.sourceType === 'research');
  assert.ok(candidate); assert.equal(candidate.materialVersionId, material.versionId);
  const updated = await updateResearchCaseReference(a.context, { referenceId: first.id, expectedVersion: first.version, notes: 'Anotação privada.' });
  assert.equal(updated.notes, 'Anotação privada.');
  await assert.rejects(updateResearchCaseReference(a.context, { referenceId: first.id, expectedVersion: first.version, notes: 'Conflito.' }), { code: 'CONFLICT' });
  const runId = randomUUID(), artifactId = randomUUID();
  (await testDb.prepare("INSERT INTO ai_run(id,office_id,user_id,kind,input) VALUES(?,?,?,'draft','{}')")
    .run(runId, a.context.officeId, a.context.userId));
  (await testDb.prepare("INSERT INTO ai_artifact(id,office_id,user_id,run_id,title,content,source_refs) VALUES(?,?,?,?,'Minuta','Texto',?)")
    .run(artifactId, a.context.officeId, a.context.userId, runId, JSON.stringify([{ id: candidate.id, sourceType: 'research',
      materialVersionId: material.versionId, researchChunkId: material.chunkId }])));
  await removeResearchCaseReference(a.context, first.id, updated.version);
  assert.equal((await listResearchCaseReferences(a.context, a.caseId)).length, 0);
  assert.equal((await selectedPinnedResearchSources(a.context, a.caseId, pinned))[0].text, material.text);
  assert.equal((await resolveArtifactResearchSource(a.context, artifactId, candidate.id)).text, material.text);
  await assert.rejects(resolveArtifactResearchSource(b.context, artifactId, candidate.id), { code: 'NOT_FOUND' });
  assert.equal((await testDb.prepare('SELECT count(*) AS n FROM research_material_version WHERE id=?').get(material.versionId))!.n, 1);
});

test('composition requires adequate evidence and never rewards thesis position', () => {
  assert.equal(Object.keys(researchAssessmentQuestions(false)).includes('stance'), false);
  const scores = { legal: { type: 'score', score: 4, confidence: 1, probabilities: {} },
    factual: { type: 'score', score: 4, confidence: 1, probabilities: {} },
    procedural: { type: 'score', score: 4, confidence: 1, probabilities: {} },
    stance: { type: 'choice', choice: 'opposes', confidence: 1, probabilities: {} },
    adequacy: { type: 'choice', choice: 'adequate', confidence: 1, probabilities: {} } } as Parameters<typeof composeResearchAssessment>[0];
  assert.equal(composeResearchAssessment(scores), 1);
  assert.equal(composeResearchAssessment({ ...scores, adequacy: { type: 'choice', choice: 'insufficient', confidence: 1, probabilities: {} } }), null);
});

test('research rerank uses its own mode and private versioned cache', async () => {
  const a = (await fixture()), b = (await fixture());
  (await testDb.prepare('INSERT INTO platform_admin(user_id) VALUES(?)').run(a.context.userId));
  await saveConnection(a.context.userId, connectionSettings.parse({ apiKey: 'synthetic-key-not-secret', enabled: true,
    rag: 'off', research: 'shadow', version: (await connectionView()).version }));
  const candidates = [{ id: 'a', text: 'Pouco útil.', versionFingerprint: 'v1' }, { id: 'b', text: 'Diretamente útil.', versionFingerprint: 'v1' }];
  let calls = 0;
  const send: DecisionTransport = async (_key, request) => {
    calls++;
    return { model: request.model, usage: { input_tokens: 20, output_tokens: 10 }, answers: Object.fromEntries(
      Object.entries(request.questions).map(([name, question]) => {
        const score = name.endsWith('_0') ? 0 : 4;
        return [name, { type: 'score', score, confidence: 1,
          probabilities: Object.fromEntries((question.type === 'score' ? question.criteria : []).map((_, i) => [String(i), Number(i === score)])) }];
      })) };
  };
  const first = await rerankResearchResults(a.context, 'guarda à avó', candidates, { send });
  assert.equal(first.applied, false); assert.deepEqual(first.candidates, candidates);
  assert.equal((await rerankResearchResults(a.context, 'guarda à avó', candidates, { send })).status, 'evaluated');
  assert.equal(calls, 1);
  await saveConnection(a.context.userId, connectionSettings.parse({ apiKey: 'synthetic-key-not-secret', enabled: true,
    rag: 'off', research: 'enabled', version: (await connectionView()).version }));
  const enabled = await rerankResearchResults(a.context, 'guarda à avó', candidates, { send });
  assert.equal(enabled.applied, true); assert.deepEqual(enabled.candidates.map(item => item.id), ['b', 'a']);
  assert.equal(calls, 2);
  // Same platform connection, but the cache stays private to each office.
  assert.equal((await rerankResearchResults(b.context, 'guarda à avó', candidates, { send })).status, 'evaluated');
  assert.equal(calls, 3);
  const changed = await rerankResearchResults(a.context, 'guarda à avó', [{ ...candidates[0], versionFingerprint: 'v2' }, candidates[1]], { send });
  assert.equal(changed.status, 'evaluated'); assert.equal(calls, 4);
});

test('reference update changes only its pinned version; exhausted leases terminate', async () => {
  const a = (await fixture()), material = (await publicMaterial());
  await saveResearchCaseProfile(a.context, profileInput(a));
  const oldAssessment = await assessResearchCaseMaterial(a.context, { caseId: a.caseId, materialVersionId: material.versionId });
  const oldLink = await addResearchCaseReference(a.context, { caseId: a.caseId, materialVersionId: material.versionId,
    purpose: 'foundation', assessmentId: oldAssessment.id, bypassEvaluation: true });
  const newVersionId = randomUUID(), newChunkId = randomUUID(), newText = 'Acórdão atualizado: guarda provisória pela avó.';
  (await testDb.prepare(`INSERT INTO research_material_version(id,material_id,sha256,mime_type,byte_size,text_content,parser_version,citation_metadata_json,
    metadata_revision,collected_at,published_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
    .run(newVersionId, material.materialId, randomUUID().replaceAll('-', ''), 'text/plain', newText.length, newText,
      'v1', JSON.stringify({ title: 'Guarda provisória', tribunal: 'TJDFT' }), 2, '2026-09-02', '2026-09-02'));
  (await testDb.prepare('INSERT INTO research_chunk(id,material_version_id,ordinal,text_content,reference) VALUES(?,?,0,?,?)')
    .run(newChunkId, newVersionId, newText, 'ementa:1'));
  (await testDb.prepare('UPDATE research_material SET current_version_id=? WHERE id=?').run(newVersionId, material.materialId));
  const newAssessment = await assessResearchCaseMaterial(a.context, { caseId: a.caseId, materialVersionId: newVersionId });
  await assert.rejects(updateResearchCaseReference(a.context, { referenceId: oldLink.id, expectedVersion: oldLink.version,
    materialVersionId: newVersionId }), { code: 'APPROVAL_REQUIRED' });
  const updated = await updateResearchCaseReference(a.context, { referenceId: oldLink.id, expectedVersion: oldLink.version,
    materialVersionId: newVersionId, assessmentId: newAssessment.id, bypassEvaluation: true });
  assert.equal(updated.materialVersionId, newVersionId);
  assert.equal((await selectedResearchSources(a.context, a.caseId, [oldLink.id]))[0].text, newText);
  assert.equal((await selectedPinnedResearchSources(a.context, a.caseId,
    [{ referenceId: oldLink.id, materialVersionId: material.versionId }]))[0].text, material.text);
  const exhaustedId = randomUUID();
  (await testDb.prepare(`INSERT INTO research_case_assessment(id,office_id,case_id,material_version_id,requested_by,input_fingerprint,status,mode,question_version,
    attempts,lease_until) VALUES(?,?,?,?,?,?,'running','enabled','test',5,0)`).run(exhaustedId, a.context.officeId, a.caseId, newVersionId,
      a.context.userId, randomUUID()));
  assert.equal(await processNextResearchAssessment(), true);
  assert.equal((await testDb.prepare('SELECT status FROM research_case_assessment WHERE id=?').get(exhaustedId))!.status, 'unavailable');
});

test('case assessment in shadow mode is kept for comparison but neither shown nor accepted as evaluated', async () => {
  const a = (await fixture()), material = (await publicMaterial());
  await saveResearchCaseProfile(a.context, profileInput(a));
  (await testDb.prepare('INSERT INTO platform_admin(user_id) VALUES(?)').run(a.context.userId));
  await saveConnection(a.context.userId, connectionSettings.parse({ apiKey: 'synthetic-key-not-secret', enabled: true,
    research: 'shadow', version: (await connectionView()).version }));
  const queued = await assessResearchCaseMaterial(a.context, { caseId: a.caseId, materialVersionId: material.versionId });
  while (await processNextResearchAssessment({ send: sendOpposes }));
  const stored = await testDb.prepare('SELECT status,mode,result_json FROM research_case_assessment WHERE id=?').get<{ status: string; mode: string; result_json: string | null }>(queued.id);
  assert.equal(stored?.status, 'evaluated'); assert.equal(stored?.mode, 'shadow'); assert.ok(stored?.result_json, 'Jev’s answer stays on record');
  const shown = await getResearchCaseAssessment(a.context, queued.id);
  assert.equal(shown.status, 'disabled'); assert.equal(shown.result, null);
  // Nor does the reason the shadow answer produced.
  await testDb.prepare("UPDATE research_case_assessment SET status='incomplete',reason='evidence_insufficient' WHERE id=?").run(queued.id);
  const hidden = await getResearchCaseAssessment(a.context, queued.id);
  assert.equal(hidden.status, 'disabled'); assert.equal(hidden.reason, null);
  await testDb.prepare("UPDATE research_case_assessment SET status='evaluated',reason=NULL WHERE id=?").run(queued.id);
  // A case that stopped before any evaluation still says what is missing.
  const bare = await fixture();
  const missing = await assessResearchCaseMaterial(bare.context, { caseId: bare.caseId, materialVersionId: material.versionId });
  assert.equal(missing.status, 'incomplete'); assert.equal(missing.reason, 'profile_missing');
  await assert.rejects(addResearchCaseReference(a.context, { caseId: a.caseId, materialVersionId: material.versionId,
    purpose: 'foundation', assessmentId: queued.id }), { code: 'APPROVAL_REQUIRED' });
  const bypassed = await addResearchCaseReference(a.context, { caseId: a.caseId, materialVersionId: material.versionId,
    purpose: 'foundation', assessmentId: queued.id, bypassEvaluation: true });
  assert.equal(bypassed.purpose, 'foundation');
});
