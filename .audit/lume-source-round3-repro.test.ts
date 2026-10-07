import '../apps/web/tests/test-setup';
import { testDb } from '../apps/web/tests/test-setup';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { WorkspaceContext } from '../apps/web/src/lib/application/context';
import { getResearchCaseProfile, saveResearchCaseProfile } from '../apps/web/src/lib/research/case-profile';
import { assessResearchCaseMaterial, getResearchCaseAssessment, processNextResearchAssessment } from '../apps/web/src/lib/research/case-assessment';
import { materialSnapshot } from '../apps/web/src/lib/research/case-material';
import { addResearchCaseReference, listResearchCaseReferences, removeResearchCaseReference, updateResearchCaseReference } from '../apps/web/src/lib/research/case-references';
import { selectedPinnedResearchSources, selectedResearchSources, resolveArtifactResearchSource } from '../apps/web/src/lib/ai-sources';
import { citationCandidates } from '../apps/web/src/lib/ai-policy';
import { runCapability } from '../apps/web/src/lib/agent-tools';
import { contextForCase } from '../apps/web/src/lib/collaboration/access';
import { createVaultFolder } from '../apps/web/src/lib/vault';

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
import { composeResearchAssessment, researchAssessmentQuestions } from '../apps/web/src/lib/research/case-assessment-contracts';
import { rerankResearchResults } from '../apps/web/src/lib/typesafe/research-rerank';
import { saveConnection, connectionView } from '../apps/web/src/lib/typesafe/config';
import { connectionSettings } from '../apps/web/src/lib/typesafe/contracts';
import type { DecisionTransport } from '../apps/web/src/lib/typesafe/client';

async function fixture() {
  const officeId = randomUUID(), userId = randomUUID(), caseId = randomUUID(), documentId = randomUUID(), chunkId = randomUUID();
  (await testDb.prepare('INSERT INTO office(id,name) VALUES(?,?)').run(officeId, 'Escritório de teste'));
  (await testDb.prepare('INSERT INTO user(id,email,name) VALUES(?,?,?)').run(userId, `${userId}@example.test`, 'Advogada'));
  (await testDb.prepare('INSERT INTO office_member(id,office_id,user_id) VALUES(?,?,?)').run(randomUUID(), officeId, userId));
  (await testDb.prepare('INSERT INTO vault_case(id,office_id,name,created_by) VALUES(?,?,?,?)').run(caseId, officeId, 'Caso da cliente', userId));
  (await testDb.prepare(`INSERT INTO vault_document(id,office_id,case_id,scope,original_name,stored_name,mime_type,byte_size,sha256,status,created_by)
    VALUES(?,?,?,'case','relato.txt',?,'text/plain',100,?,'ready',?)`)
    .run(documentId, officeId, caseId, randomUUID(), randomUUID().replaceAll('-', ''), userId));
  await testDb.prepare(`INSERT INTO vault_document_version(id,office_id,document_id,version,original_name,stored_name,mime_type,byte_size,sha256,created_by,is_active)
    SELECT ?,office_id,id,1,original_name,stored_name,mime_type,byte_size,sha256,created_by,1 FROM vault_document WHERE id=?`).run(randomUUID(), documentId);
  (await testDb.prepare('INSERT INTO vault_document_chunk(id,document_id,office_id,ordinal,stable_reference,content) VALUES(?,?,?,?,?,?)')
    .run(chunkId, documentId, officeId, 0, 'linha:1', 'A avó cuida da criança desde janeiro, conforme o relatório anexado.'));
  return { context: { officeId, userId } as WorkspaceContext, caseId, documentId, chunkId };
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

async function participant(f: Awaited<ReturnType<typeof fixture>>) {
  const guest = await fixture();
  await testDb.prepare('INSERT INTO office_associate(office_id,user_id,created_by) VALUES(?,?,?),(?,?,?)')
    .run(f.context.officeId, guest.context.userId, f.context.userId, guest.context.officeId, f.context.userId, f.context.userId);
  await testDb.prepare('INSERT INTO case_participant(office_id,case_id,user_id,invited_by) VALUES(?,?,?,?)')
    .run(f.context.officeId, f.caseId, guest.context.userId, f.context.userId);
  return guest;
}

async function enableResearch(f: Awaited<ReturnType<typeof fixture>>) {
  await testDb.prepare('INSERT INTO platform_admin(user_id) VALUES(?)').run(f.context.userId);
  await saveConnection(f.context.userId, connectionSettings.parse({ apiKey: 'synthetic-key-not-secret', enabled: true,
    research: 'enabled', version: (await connectionView()).version }));
}



test('keyed reference replay suppresses revoked nested assessment excerpts', async () => {
  const a = await fixture(), guest = await participant(a), material = await publicMaterial();
  await saveResearchCaseProfile(a.context, profileInput(a));
  await enableResearch(a);
  const assessment = await assessResearchCaseMaterial(a.context, { caseId: a.caseId, materialVersionId: material.versionId });
  await processNextResearchAssessment({ send: sendOpposes });
  const input = { caseId: a.caseId, materialVersionId: material.versionId, purpose: 'foundation', assessmentId: assessment.id, idempotencyKey: randomUUID() };
  const first = await runCapability(a.context, 'k5_research_add_reference', input);
  assert.match(JSON.stringify(first), /A avó cuida da criança desde janeiro/);
  const folder = await createVaultFolder(a.context.officeId, guest.context.userId, a.caseId, 'Reservado', null, { visibility: 'private' }, await contextForCase(guest.context, a.caseId));
  await runCapability(guest.context, 'k5_vault_update_document', { documentId: a.documentId, folderId: folder.id });
  assert.equal((await getResearchCaseAssessment(a.context, assessment.id)).result, null);
  let replay: unknown, caught: unknown;
  try { replay = await runCapability(a.context, 'k5_research_add_reference', input); } catch (error) { caught = error; }
  const leaked = JSON.stringify(replay ?? null).includes('A avó cuida da criança desde janeiro');
  console.log(JSON.stringify({ finding: 'A1', leaked, error: (caught as { code?: string } | undefined)?.code }));
  assert.equal(leaked, false);
});

test('private planner profile text never reaches an independent case participant', async () => {
  const a = await fixture(), guest = await participant(a);
  const { createConversation } = await import('../apps/web/src/lib/ai-store');
  const { id: conversationId } = await createConversation(testDb, a.context);
  const input = { ...profileInput(a), allegedFacts: ['PRIVATE_PLANNER_PROFILE_BYTES'], documentedFacts: [], documentIds: [] };
  let caught: unknown;
  try {
    await runCapability({ ...a.context, invocation: 'agent', conversationId, generationId: randomUUID() }, 'k5_research_save_profile', input);
  } catch (error) { caught = error; }
  const profile = await getResearchCaseProfile(await contextForCase(guest.context, a.caseId), a.caseId);
  const leaked = JSON.stringify(profile).includes('PRIVATE_PLANNER_PROFILE_BYTES');
  console.log(JSON.stringify({ finding: 'A2', leaked, error: (caught as { code?: string } | undefined)?.code }));
  assert.equal(leaked, false);
});

test('assessment tool suppresses catalog excerpts after AI permission revocation', async () => {
  const a = await fixture(), material = await publicMaterial();
  await saveResearchCaseProfile(a.context, profileInput(a));
  await enableResearch(a);
  const assessment = await assessResearchCaseMaterial(a.context, { caseId: a.caseId, materialVersionId: material.versionId });
  await processNextResearchAssessment({ send: sendOpposes });
  assert.match(JSON.stringify(await getResearchCaseAssessment(a.context, assessment.id)), /Acórdão sobre guarda/);
  await testDb.prepare("UPDATE judicial_source_installation SET permission_ai='proibido' WHERE id=?").run(material.installationId);
  let read: unknown, caught: unknown;
  try { read = await runCapability({ ...a.context, invocation: 'agent' }, 'k5_research_get_assessment', { assessmentId: assessment.id }); }
  catch (error) { caught = error; }
  const leaked = JSON.stringify(read ?? null).includes(material.text);
  console.log(JSON.stringify({ finding: 'A3', leaked, error: (caught as { code?: string } | undefined)?.code }));
  assert.equal(leaked, false);
});

