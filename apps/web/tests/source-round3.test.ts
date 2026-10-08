import { fixtureSession } from './session-fixture';
import './test-setup';
import { testDb } from './test-setup';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { WorkspaceContext } from '../src/lib/application/context';
import { getResearchCaseProfile, saveResearchCaseProfile } from '../src/lib/research/case-profile';
import { assessResearchCaseMaterial, getResearchCaseAssessment, processNextResearchAssessment } from '../src/lib/research/case-assessment';
import { addResearchCaseReference, getResearchCaseReference } from '../src/lib/research/case-references';
import { selectedResearchSources } from '../src/lib/ai-sources';
import { citationCandidates } from '../src/lib/ai-policy';
import { runCapability } from '../src/lib/agent-tools';
import { contextForCase } from '../src/lib/collaboration/access';
import { createVaultFolder, updateVaultFolderAccess } from '../src/lib/vault';
import { exposedPolicies } from '../src/lib/content-policy';

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
import { saveConnection, connectionView } from '../src/lib/typesafe/config';
import { connectionSettings } from '../src/lib/typesafe/contracts';
import type { DecisionTransport } from '../src/lib/typesafe/client';

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
  await testDb.prepare('UPDATE vault_document SET extracted_version=1,extracted_sha256=sha256 WHERE id=?').run(documentId);
  return { context: { officeId, userId, sessionId: await fixtureSession(userId) } as WorkspaceContext, caseId, documentId, chunkId };
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
  await testDb.prepare('UPDATE vault_document SET created_by=? WHERE id=?').run(guest.context.userId, a.documentId);
  await runCapability(guest.context, 'k5_vault_update_document', { documentId: a.documentId, folderId: folder.id });
  await assert.rejects(getResearchCaseAssessment(a.context, assessment.id),{ code: 'NOT_FOUND' });
  let replay: unknown, caught: unknown;
  try { replay = await runCapability(a.context, 'k5_research_add_reference', input); } catch (error) { caught = error; }
  const leaked = JSON.stringify(replay ?? null).includes('A avó cuida da criança desde janeiro');
  console.log(JSON.stringify({ finding: 'A1', leaked, error: (caught as { code?: string } | undefined)?.code }));
  assert.equal(leaked, false);
});

test('private planner profile text never reaches an independent case participant', async () => {
  const a = await fixture(), guest = await participant(a);
  const { createConversation } = await import('../src/lib/ai-store');
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

test('profile IDs preserve reordering, category moves and hidden parts without binding unrelated new entries', async () => {
  const a = await fixture(), guest = await participant(a);
  const first = await saveResearchCaseProfile(a.context,{ ...profileInput(a), allegedFacts:['Primeiro fato alegado.','Segundo fato alegado.'] });
  assert.equal(first.kind,'complete');
  const moveId = first.entryIds.documentedFacts[0];
  const moved = await saveResearchCaseProfile(a.context,{ ...profileInput(a), expectedVersion:first.version,readToken:first.readToken,
    documentedFacts:[], documentIds:[], allegedFacts:[first.documentedFacts[0].text,...first.allegedFacts.toReversed()],
    entryIds:{documentedFacts:[],allegedFacts:[moveId,...first.entryIds.allegedFacts.toReversed()],gaps:first.entryIds.gaps} });
  assert.equal(moved.entryIds.allegedFacts[0],moveId);
  await assert.rejects(saveResearchCaseProfile(a.context,{ ...profileInput(a),expectedVersion:moved.version,readToken:moved.readToken,
    documentedFacts:[],documentIds:[],allegedFacts:moved.allegedFacts,
    entryIds:{documentedFacts:[],allegedFacts:moved.entryIds.allegedFacts.map(() => null),gaps:moved.entryIds.gaps} }),{code:'CONFLICT'});
  const folder = await createVaultFolder(a.context.officeId,guest.context.userId,a.caseId,'Reservado',null,{visibility:'private'},await contextForCase(guest.context,a.caseId));
  await testDb.prepare('UPDATE vault_document SET created_by=? WHERE id=?').run(guest.context.userId,a.documentId);
  await runCapability(guest.context,'k5_vault_update_document',{documentId:a.documentId,folderId:folder.id});
  const partial = (await getResearchCaseProfile(a.context,a.caseId))!;
  assert.equal(partial.kind,'restricted');
  assert.deepEqual(partial.allegedFacts,['Segundo fato alegado.','Primeiro fato alegado.']);
  const edited = await saveResearchCaseProfile(a.context,{caseId:a.caseId,expectedVersion:partial.version,readToken:partial.readToken,
    documentedFacts:[],documentIds:[],allegedFacts:[...partial.allegedFacts,'Nova contribuição independente.'],gaps:partial.gaps,
    entryIds:{...partial.entryIds,allegedFacts:[...partial.entryIds.allegedFacts,null]} });
  assert.equal(edited.kind,'restricted');
  assert.doesNotMatch(JSON.stringify(edited),/A avó cuida da criança/);
  const restored = (await getResearchCaseProfile(await contextForCase(guest.context,a.caseId),a.caseId))!;
  assert.ok(restored.allegedFacts.includes('A avó cuida da criança desde janeiro.'));
  const stored = await testDb.prepare('SELECT content_parts FROM research_case_profile WHERE case_id=?').get<{content_parts:Array<{value:unknown;policy:{guards:unknown[]}}> }>(a.caseId);
  assert.deepEqual(stored!.content_parts.find(part => part.value==='Nova contribuição independente.')!.policy.guards,[]);
  await assert.rejects(saveResearchCaseProfile(a.context,{caseId:a.caseId,expectedVersion:partial.version,readToken:partial.readToken,
    documentedFacts:[],allegedFacts:partial.allegedFacts,gaps:partial.gaps,documentIds:[],entryIds:partial.entryIds}),{code:'CONFLICT'});
});

test('legacy latest editor is not invented as author and unknown profile text stays withheld',async () => {
  const a=await fixture();await saveResearchCaseProfile(a.context,profileInput(a));
  await testDb.prepare('UPDATE research_case_profile SET content_parts=NULL WHERE case_id=?').run(a.caseId);
  const profile=(await getResearchCaseProfile(a.context,a.caseId))!;
  assert.equal(profile.kind,'restricted');
  assert.doesNotMatch(JSON.stringify(profile),/Quando a guarda|O pai está ausente|Falta comprovar/);
});

test('assessment retries retain original authority while later sessions get independent execution identity',async () => {
  const a=await fixture(),material=await publicMaterial();await saveResearchCaseProfile(a.context,profileInput(a));await enableResearch(a);
  const input={caseId:a.caseId,materialVersionId:material.versionId,idempotencyKey:randomUUID()};
  const first=await assessResearchCaseMaterial(a.context,input),retry=await assessResearchCaseMaterial(a.context,input);
  assert.equal(first.id,retry.id);
  await testDb.prepare('UPDATE session SET "expiresAt"=CURRENT_TIMESTAMP-interval \'1 second\' WHERE id=?').run(a.context.sessionId);
  let calls=0;await processNextResearchAssessment({send:async(...args)=>{calls++;return sendOpposes(...args);}});
  assert.equal(calls,0);
  const stopped=await testDb.prepare('SELECT reason,authority_json FROM research_case_assessment WHERE id=?').get<{reason:string;authority_json:WorkspaceContext}>(first.id);
  assert.equal(stopped!.reason,'authority_expired');assert.equal(stopped!.authority_json.sessionId,a.context.sessionId);
  const current={...a.context,sessionId:await fixtureSession(a.context.userId)};
  const later=await assessResearchCaseMaterial(current,input);assert.notEqual(later.id,first.id);
  await processNextResearchAssessment({send:sendOpposes});assert.ok((await getResearchCaseAssessment(current,later.id)).result);
});

test('selected research chunks, citation identity and policies remain paired with V1 after pointer advances',async () => {
  const a=await fixture(),m=await publicMaterial();await saveResearchCaseProfile(a.context,profileInput(a));
  const assessment=await assessResearchCaseMaterial(a.context,{caseId:a.caseId,materialVersionId:m.versionId});
  const reference=await addResearchCaseReference(a.context,{caseId:a.caseId,materialVersionId:m.versionId,purpose:'context',assessmentId:assessment.id,bypassEvaluation:true});
  const selected=await selectedResearchSources(a.context,a.caseId,[reference.id]);
  const next=randomUUID();await testDb.prepare(`INSERT INTO research_material_version(id,material_id,sha256,mime_type,byte_size,text_content,parser_version,citation_metadata_json,metadata_revision,collected_at,published_at)
    SELECT ?,material_id,'v2-sha',mime_type,20,'V2_NEW_BYTES',parser_version,citation_metadata_json,metadata_revision+1,collected_at,published_at FROM research_material_version WHERE id=?`).run(next,m.versionId);
  await testDb.prepare('UPDATE research_material SET current_version_id=? WHERE id=?').run(next,m.materialId);
  for(const chunk of citationCandidates(selected)) {
    assert.equal(chunk.materialVersionId,m.versionId);assert.doesNotMatch(chunk.text,/V2_NEW_BYTES/);
    assert.ok(exposedPolicies(chunk)?.some(policy=>policy.observed.some(pin=>pin.version===m.versionId)));
  }
  const after=await selectedResearchSources(a.context,a.caseId,[reference.id]);assert.deepEqual(after.map(chunk=>chunk.text),selected.map(chunk=>chunk.text));
});

test('agent profile prepares once from actual submission, reviews exact content and consumes that stored proposal',async t => {
  const a=await fixture(),guest=await participant(a);
  const {createConversation}=await import('../src/lib/ai-store');
  const {createPage}=await import('../src/lib/case-pages/service');
  const {authorizeMessageScope}=await import('../src/lib/chat-scope-server');
  const {recordPersonRequest}=await import('../src/lib/documents/shared-writing');
  const {recordingWriter}=await import('./shared-writing-fixture');
  const {approveProposal}=await import('../src/lib/application/approvals-service');
  const {researchApprovalPreview}=await import('../src/lib/research/case-content');
  const conversation=await createConversation(testDb,a.context);
  const folder=await createVaultFolder(a.context.officeId,guest.context.userId,a.caseId,'Fonte',null,{visibility:'public'},await contextForCase(guest.context,a.caseId));
  const page=(await createPage(a.context,{caseId:a.caseId,folderId:folder.id,title:'Pedido original',content:'ONLY_ADMITTED_PERSON_SOURCE'})).page;
  const scope=await authorizeMessageScope(a.context,{caseId:a.caseId,document:{kind:'case-page',id:page.id,caseId:a.caseId},documentIds:[],researchReferenceIds:[]});
  const submissionId=await recordPersonRequest(a.context,conversation.id,randomUUID(),'Prepare um perfil conforme a página selecionada.',scope,[]);
  const context={...a.context,invocation:'agent' as const,conversationId:conversation.id,submissionId,generationId:randomUUID()};
  const output={...profileInput(a),documentedFacts:[],documentIds:[]};
  const wire=await recordingWriter(t,a.context.userId,[output]);
  let approvalId='';
  await assert.rejects(runCapability(context,'k5_research_save_profile',{caseId:a.caseId,expectedVersion:0,change:{kind:'request'}}),error=>{
    approvalId=(error as Error).message.match(/\[id: ([\w-]+)\]/)?.[1]??'';return (error as {code?:string}).code==='APPROVAL_REQUIRED'&&!!approvalId;
  });
  assert.equal(wire.length,1);assert.match(JSON.stringify(wire),/ONLY_ADMITTED_PERSON_SOURCE/);
  assert.equal(await getResearchCaseProfile(a.context,a.caseId),null);
  const preview=await researchApprovalPreview(a.context,approvalId);assert.match(preview.content,/Quando a guarda/);
  await approveProposal(a.context,approvalId);
  const row=await testDb.prepare('SELECT normalized_input FROM capability_approval WHERE id=?').get<{normalized_input:string}>(approvalId);
  const confirmed={...JSON.parse(row!.normalized_input),approvalId};
  const saved=await runCapability(context,'k5_research_save_profile',confirmed);
  assert.match(JSON.stringify(saved),/Quando a guarda/);assert.equal(wire.length,1);
  assert.deepEqual(await runCapability(context,'k5_research_save_profile',confirmed),saved);
  await updateVaultFolderAccess(a.context.officeId,folder.id,guest.context.userId,{visibility:'private'},await contextForCase(guest.context,a.caseId));
  const hidden=await getResearchCaseProfile(a.context,a.caseId);assert.equal(hidden?.kind,'restricted');assert.doesNotMatch(JSON.stringify(hidden),/Quando a guarda|O pai está ausente/);
  await assert.rejects(runCapability(context,'k5_research_save_profile',confirmed),{code:'NOT_FOUND'});assert.equal(wire.length,1);
});

test('notes preparation reviews one stored output, purpose changes retain it, and revocation withholds replay',async t=>{
  const a=await fixture(),guest=await participant(a),material=await publicMaterial();await saveResearchCaseProfile(a.context,profileInput(a));
  const assessment=await assessResearchCaseMaterial(a.context,{caseId:a.caseId,materialVersionId:material.versionId});
  const reference=await addResearchCaseReference(a.context,{caseId:a.caseId,materialVersionId:material.versionId,purpose:'context',assessmentId:assessment.id,bypassEvaluation:true,notes:'Anotação inicial independente.'});
  const {createConversation}=await import('../src/lib/ai-store');const {createPage}=await import('../src/lib/case-pages/service');
  const {authorizeMessageScope}=await import('../src/lib/chat-scope-server');const {recordPersonRequest}=await import('../src/lib/documents/shared-writing');
  const {recordingWriter}=await import('./shared-writing-fixture');const {decideAgentApproval}=await import('../src/lib/application/agent-approvals');
  const {researchApprovalPreview}=await import('../src/lib/research/case-content');
  const conversation=await createConversation(testDb,a.context);
  const folder=await createVaultFolder(a.context.officeId,guest.context.userId,a.caseId,'Fonte das notas',null,{visibility:'public'},await contextForCase(guest.context,a.caseId));
  const page=(await createPage(a.context,{caseId:a.caseId,folderId:folder.id,title:'Fonte',content:'NOTES_EXACT_SOURCE'})).page;
  const submissionId=await recordPersonRequest(a.context,conversation.id,randomUUID(),'Prepare uma anotação usando a página selecionada.',await authorizeMessageScope(a.context,{caseId:a.caseId,document:{kind:'case-page',id:page.id,caseId:a.caseId},documentIds:[],researchReferenceIds:[]}),[]);
  const context={...a.context,invocation:'agent' as const,conversationId:conversation.id,submissionId,generationId:randomUUID()};
  const wire=await recordingWriter(t,a.context.userId,[{notes:'Anotação preparada com a fonte admitida.'}]);
  let approvalId='';await assert.rejects(runCapability(context,'k5_research_update_reference',{referenceId:reference.id,expectedVersion:reference.version,change:{kind:'request'}}),error=>{approvalId=(error as Error).message.match(/\[id: ([\w-]+)\]/)?.[1]??'';return (error as {code:string}).code==='APPROVAL_REQUIRED'&&!!approvalId;});
  assert.equal((await getResearchCaseReference(a.context,reference.id)).notes,'Anotação inicial independente.');
  assert.equal((await researchApprovalPreview(a.context,approvalId)).content,'Anotação preparada com a fonte admitida.');
  assert.equal((await decideAgentApproval(a.context,approvalId,'confirm')).state,'confirmed');assert.equal(wire.length,1);
  const saved=await getResearchCaseReference(a.context,reference.id);assert.equal(saved.notes,'Anotação preparada com a fonte admitida.');
  const changed=await runCapability({...context,generationId:randomUUID()},'k5_research_update_reference',{referenceId:reference.id,expectedVersion:saved.version,purpose:'counterpoint'}).catch(error=>error);
  assert.equal((changed as {code?:string}).code,'APPROVAL_REQUIRED');assert.equal(wire.length,1);
  const purposeApproval=(changed as Error).message.match(/\[id: ([\w-]+)\]/)?.[1];assert.ok(purposeApproval);
  assert.equal((await decideAgentApproval(a.context,purposeApproval,'confirm')).state,'confirmed');
  assert.equal((await getResearchCaseReference(a.context,reference.id)).notes,saved.notes);assert.equal(wire.length,1);
  const beforeRevocation=await getResearchCaseReference(a.context,reference.id);
  const keyed={referenceId:reference.id,expectedVersion:beforeRevocation.version,purpose:'foundation',idempotencyKey:randomUUID()};
  await runCapability(a.context,'k5_research_update_reference',keyed);
  await updateVaultFolderAccess(a.context.officeId,folder.id,guest.context.userId,{visibility:'private'},await contextForCase(guest.context,a.caseId));
  const hidden=await getResearchCaseReference(a.context,reference.id);assert.equal(hidden.notesState,'withheld');assert.equal(hidden.notes,'');
  const stored=await testDb.prepare('SELECT notes FROM research_case_reference WHERE id=?').get<{notes:string}>(reference.id);assert.equal(stored!.notes,saved.notes);
  await assert.rejects(runCapability(a.context,'k5_research_update_reference',keyed),{code:'NOT_FOUND'});
  const replay=await decideAgentApproval(a.context,approvalId,'confirm');
  assert.equal(replay.state,'failed');
  assert.ok(!JSON.stringify(replay).includes('NOTES_EXACT_SOURCE'));
  assert.ok(!JSON.stringify(replay).includes(saved.notes));
  assert.equal(wire.length,1);
});
