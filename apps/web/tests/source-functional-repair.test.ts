import { testDb as db } from './test-setup';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { googleFixture, installFakeGoogle, respond, setRule } from './google-fixture';
import { recordingWriter } from './shared-writing-fixture';
import { createConversation } from '../src/lib/ai-store';
import { createPage } from '../src/lib/case-pages/service';
import { observePage, uncertainPolicy, combinePolicy } from '../src/lib/content-policy';
import { recordSources, sourcesFromTool, conversationSources } from '../src/lib/citations/sources';
import { runCapability, agentTools } from '../src/lib/agent-tools';
import { saveConnection, connectionView } from '../src/lib/typesafe/config';
import { connectionSettings } from '../src/lib/typesafe/contracts';
import type { DecisionRequest } from '../src/lib/typesafe/client';
import { getResearchCaseProfile, saveResearchCaseProfile } from '../src/lib/research/case-profile';
import { getResearchJudgment, startResearchSearch, getResearchSearch } from '../src/lib/application/research-service';
import { createUploadRef } from '../src/lib/application/uploads-service';
import { createVaultDocument } from '../src/lib/vault';
import { personPolicy } from '../src/lib/content-policy';
import { saveDraft } from '../src/lib/google/gmail/service';
import { searchKnowledgeEngine } from '../src/lib/knowledge/retrieval';
import { createAiConnection } from '../src/lib/ai-connections-core';
import { updateModelAssignment } from '../src/lib/ai-assignments-core';
import { parseCredentialKeyring } from '../src/lib/platform-crypto';
import { startRun } from '../src/lib/application/runs-service';
import { processNextRun } from '../src/lib/document-workflows';
import { assessResearchCaseMaterial, processNextResearchAssessment } from '../src/lib/research/case-assessment';
import { scoreJurisprudence } from '../src/lib/research/jurisprudence-score';
import { noopObserve } from '@mastra/core/tools';

async function enabled(context: Awaited<ReturnType<typeof googleFixture>>['context']) {
  await db.prepare('INSERT INTO platform_admin(user_id) VALUES(?) ON CONFLICT DO NOTHING').run(context.userId);
  await saveConnection(context.userId, connectionSettings.parse({ apiKey: 'synthetic-functional-key', enabled: true,
    documents: 'enabled', rag: 'enabled', research: 'enabled', version: (await connectionView()).version }));
}

function decision(request: DecisionRequest) {
  return { model: request.model, usage: { input_tokens: 100, output_tokens: 20 }, answers: Object.fromEntries(Object.entries(request.questions).map(([name, question]) => {
    if (question.type === 'noul') return [name, { type: 'noul', noul: 1 }];
    const criteria = question.type === 'score' ? question.criteria.map((_, index) => String(index)) : Object.keys(question.criteria);
    const choice = name.startsWith('kind_') ? 'statute' : name.startsWith('support_') ? 'supports' : criteria[0];
    return [name, { type: question.type, ...(question.type === 'score' ? { score: 0 } : { choice }), confidence: 1,
      probabilities: Object.fromEntries(criteria.map(key => [key, Number(key === choice)])) }];
  })) };
}

test('automatic artifact citation owner retains the authenticated context with TypeSafe enabled', async t => {
  const f = await googleFixture(); await enabled(f.context);
  const conversation = await createConversation(db, f.context);
  await recordSources(f.context, conversation.id, [{kind:'web', ref:'https://example.test/cc', title:'Código Civil', text:'Art. 113 do Código Civil. Os negócios jurídicos devem ser interpretados conforme a boa-fé.'}]);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const wire = new Request(input, init); assert.ok(wire.url.startsWith('https://api.typesafe.ai/')); calls++;
    return Response.json(decision(await wire.json() as DecisionRequest));
  });
  const result = await runCapability({...f.context, invocation:'agent', conversationId:conversation.id}, 'k5_artifacts_create', {title:'Fundamento', content:'Aplica-se o art. 113 do Código Civil.'}) as {citations:{status:string}};
  assert.equal(result.citations.status,'evaluated'); assert.equal(calls,1);
});

test('scoring citation cache preserves Vault and owner-only contributors without a research pin', async () => {
  const f = await googleFixture(), caseId = randomUUID();
  await db.prepare('INSERT INTO vault_case(id,office_id,name,created_by) VALUES(?,?,?,?)').run(caseId,f.officeId,'Fonte',f.userId);
  const page = (await createPage(f.context,{caseId,title:'Restrita',content:'SCORING_PRIVATE_BYTES'})).page;
  const policy = uncertainPolicy(f.userId,[(await observePage(f.userId,page.id,caseId)).policy]);
  const conversation = await createConversation(db,f.context);
  const result = await scoreJurisprudence({...f.context,invocation:'agent',contentSources:[policy],consultedLinks:new Set(['https://example.test/stj'])},
    {question:'SCORING_PRIVATE_BYTES',decisions:[{url:'https://example.test/stj',title:'STJ',summary:'SCORING_PRIVATE_BYTES'}]});
  await recordSources(f.context,conversation.id,sourcesFromTool('k5_research_score_jurisprudence',result));
  assert.match(JSON.stringify(await conversationSources(f.context,conversation.id)),/SCORING_PRIVATE_BYTES/);
  await db.prepare('UPDATE vault_case SET deleted_at=CURRENT_TIMESTAMP WHERE id=?').run(caseId);
  assert.doesNotMatch(JSON.stringify(await conversationSources(f.context,conversation.id)),/SCORING_PRIVATE_BYTES/);
});

test('seeded edited null-ID replacement plus explicit deletion conflicts under the original readToken and CAS', async () => {
  const f = await googleFixture(), caseId = randomUUID();
  await db.prepare('INSERT INTO vault_case(id,office_id,name,created_by) VALUES(?,?,?,?)').run(caseId,f.officeId,'Perfil',f.userId);
  const first = await saveResearchCaseProfile(f.context,{caseId,expectedVersion:0,legalQuestion:'Questão jurídica',objective:'Objetivo',thesis:'Tese',documentedFacts:[],allegedFacts:['Texto restrito original'],gaps:[],documentIds:[]});
  const source = (await createPage(f.context,{caseId,title:'Origem',content:'Origem restrita'})).page;
  const policy = uncertainPolicy(f.userId,[(await observePage(f.userId,source.id,caseId)).policy]);
  const row = await db.prepare('SELECT content_parts FROM research_case_profile WHERE case_id=?').get<{content_parts:Array<{id:string;kind:string;policy:unknown}>}>(caseId);
  row!.content_parts.find(part=>part.kind==='allegedFacts')!.policy=combinePolicy('','"Texto restrito original"',[policy],'generated');
  await db.prepare('UPDATE research_case_profile SET content_parts=?::jsonb WHERE case_id=?').run(JSON.stringify(row!.content_parts),caseId);
  const shown = (await getResearchCaseProfile(f.context,caseId))!;
  await assert.rejects(saveResearchCaseProfile(f.context,{caseId,expectedVersion:first.version,readToken:shown.readToken,
    allegedFacts:['Texto restrito editado'],documentedFacts:[],gaps:[],documentIds:[],entryIds:{allegedFacts:[null],documentedFacts:[],gaps:[]},deletedEntryIds:shown.entryIds.allegedFacts.filter((id):id is string=>id!==null)}),{code:'CONFLICT'});
  const other = await googleFixture();
  await db.prepare('INSERT INTO office_associate(office_id,user_id,created_by) VALUES(?,?,?)').run(f.officeId,other.userId,f.userId);
  await db.prepare('INSERT INTO case_participant(office_id,case_id,user_id,invited_by) VALUES(?,?,?,?)').run(f.officeId,caseId,other.userId,f.userId);
  assert.doesNotMatch(JSON.stringify(await getResearchCaseProfile({...other.context,officeId:f.officeId,caseScope:{caseId,homeOfficeId:other.officeId}},caseId)),/Texto restrito/);
});

async function catalog() {
  const installationId=randomUUID(), judgmentId=randomUUID(), materialId=randomUUID(), versionId=randomUUID();
  await db.prepare(`INSERT INTO judicial_source_installation(id,kind,court_code,court_name,degree,system,purpose,auth_kind,discovery_status,permission_query,permission_cache,permission_documents,permission_redistribution,permission_ai,enabled)
    VALUES(?,'jurisprudence_api',?,'Tribunal','second','proprietary','jurisprudence','none','pilot','permitido','permitido','permitido','permitido','permitido',1)`).run(installationId,'TJ'+installationId.slice(0,6));
  await db.prepare(`INSERT INTO research_judgment(id,installation_id,source_judgment_id,tribunal,title,metadata_hash,collected_at,status) VALUES(?,?,?,?,?,?,'2026-09-01','active')`).run(judgmentId,installationId,randomUUID(),'TJDFT','CATALOG_PRIVATE_BYTES','hash');
  await db.prepare(`INSERT INTO research_material(id,judgment_id,kind,status,current_version_id) VALUES(?,?,'ementa','ready',?)`).run(materialId,judgmentId,versionId);
  await db.prepare(`INSERT INTO research_material_version(id,material_id,sha256,mime_type,byte_size,text_content,parser_version,citation_metadata_json,metadata_revision,collected_at,published_at)
    VALUES(?,?,'hash','text/plain',21,'CATALOG_PRIVATE_BYTES','v1',?,1,'2026-09-01','2026-09-01')`).run(versionId,materialId,JSON.stringify({tribunal:'TJDFT',title:'CATALOG_PRIVATE_BYTES'}));
  await db.prepare('INSERT INTO research_chunk(id,material_version_id,ordinal,text_content,reference) VALUES(?,?,0,?,?)').run(randomUUID(),versionId,'CATALOG_PRIVATE_BYTES','ementa:1');
  await db.prepare('INSERT INTO research_fts(judgment_id,material_version_id,text_content) VALUES(?,?,?)').run(judgmentId,versionId,'CATALOG_PRIVATE_BYTES');
  return {installationId,judgmentId,versionId};
}

test('catalog result returning to the real agent tool denies permission_ai while human-local read remains available', async () => {
  const f=await googleFixture(), material=await catalog();
  const search=await startResearchSearch(f.context,{theme:'CATALOG_PRIVATE_BYTES',filters:{},includeSources:false});
  assert.match(JSON.stringify(search),/CATALOG_PRIVATE_BYTES/);
  await db.prepare("UPDATE judicial_source_installation SET permission_ai='proibido' WHERE id=?").run(material.installationId);
  assert.match(JSON.stringify(await getResearchJudgment(f.context,material.judgmentId)),/CATALOG_PRIVATE_BYTES/);
  assert.match(JSON.stringify(await getResearchSearch(f.context,search.id)),/CATALOG_PRIVATE_BYTES/);
  const tool=agentTools({...f.context,invocation:'agent'}).k5_research_get_judgment;
  await assert.rejects(async()=>tool.execute!({judgmentId:material.judgmentId},{observe:noopObserve}),{code:'NOT_FOUND'});
  await assert.rejects(runCapability({...f.context,invocation:'webmcp'},'k5_research_get_judgment',{judgmentId:material.judgmentId}),{code:'NOT_FOUND'});
  await assert.rejects(runCapability({...f.context,invocation:'agent'},'k5_research_get_search',{searchId:search.id}),{code:'NOT_FOUND'});
  await assert.rejects(runCapability({...f.context,invocation:'webmcp'},'k5_research_search_corpus',{theme:'CATALOG_PRIVATE_BYTES',filters:{}}),{code:'NOT_FOUND'});
});

test('Gmail keyed save replay checks exact managed access without repeating its remote draft effect', async () => {
  const f=await googleFixture(), caseId=randomUUID();
  await setRule(f.officeId,'gmail.draft',{mode:'automatic'});
  await db.prepare('INSERT INTO vault_case(id,office_id,name,created_by) VALUES(?,?,?,?)').run(caseId,f.officeId,'Original',f.userId);
  const upload=await createUploadRef(f.context,new File(['OWN_EXACT_FILE'],'original-restrito.txt',{type:'text/plain'}));
  const document=await createVaultDocument(f.context,upload,{scope:'case',caseId,policy:personPolicy('',''),independentUpload:true});
  const fake=installFakeGoogle(); fake.on('POST',/\/users\/me\/drafts$/,()=>respond(200,{id:'draft-functional',message:{id:'message-functional',payload:{headers:[{name:'Subject',value:'Rascunho'}],parts:[{partId:'1',filename:'original-restrito.txt',mimeType:'text/plain',body:{size:14}}]}}}));
  fake.on('GET',/\/users\/me\/drafts\/draft-functional$/,()=>respond(200,{id:'draft-functional',message:{id:'message-functional',payload:{headers:[{name:'Subject',value:'Rascunho'}],parts:[{partId:'1',filename:'original-restrito.txt',mimeType:'text/plain',body:{size:14}}]}}}));
  const input={to:[],cc:[],bcc:[],subject:'Rascunho',body:'Arquivo',attachments:[{kind:'vault' as const,documentId:document.id}],idempotencyKey:randomUUID()};
  assert.equal((await saveDraft(f.context,input)).operation.status,'succeeded');
  await db.prepare('UPDATE vault_case SET deleted_at=CURRENT_TIMESTAMP WHERE id=?').run(caseId);
  await assert.rejects(saveDraft(f.context,input),{code:'NOT_FOUND'});
  assert.equal(fake.count('POST',/\/users\/me\/drafts$/),1);
});

async function readyDocument(f: Awaited<ReturnType<typeof googleFixture>>) {
  const id=randomUUID(), chunkId=randomUUID();
  await db.prepare(`INSERT INTO vault_document(id,office_id,scope,original_name,stored_name,mime_type,byte_size,sha256,status,created_by) VALUES(?,?,'library','fatos.txt',?,'text/plain',40,'hash','ready',?)`).run(id,f.officeId,id,f.userId);
  await db.prepare(`INSERT INTO vault_document_version(id,office_id,document_id,version,original_name,stored_name,mime_type,byte_size,sha256,created_by,is_active) SELECT ?,office_id,id,1,original_name,stored_name,mime_type,byte_size,sha256,created_by,1 FROM vault_document WHERE id=?`).run(randomUUID(),id);
  await db.prepare('UPDATE vault_document SET extracted_version=1,extracted_sha256=sha256 WHERE id=?').run(id);
  await db.prepare('INSERT INTO vault_document_chunk(id,document_id,office_id,ordinal,stable_reference,content) VALUES(?,?,?,0,?,?)').run(chunkId,id,f.officeId,'linha:1','O contrato foi assinado em janeiro.');
  return {id,chunkId};
}

test('real semantic retrieval denies a revoked retained query contributor before embedding dispatch', async t => {
  const f=await googleFixture(), document=await readyDocument(f), caseId=randomUUID();
  await db.prepare('INSERT INTO vault_case(id,office_id,name,created_by) VALUES(?,?,?,?)').run(caseId,f.officeId,'Fonte da consulta',f.userId);
  const page=(await createPage(f.context,{caseId,title:'Fonte',content:'EMBED_QUERY_PRIVATE_BYTES'})).page;
  const source=await observePage(f.userId,page.id,caseId);
  await createAiConnection(db,parseCredentialKeyring(),f.userId,{name:'Embedding '+randomUUID(),provider:'openai',apiKey:'synthetic-embedding',models:{embedding:'text-embedding-3-small'}});
  await db.prepare(`INSERT INTO knowledge_index_generation(id,office_id,profile_name,model_id,dimension,chunker,status) VALUES(?,?,'embedding','text-embedding-3-small',3,'structural','active')`).run(randomUUID(),f.officeId);
  await db.prepare('UPDATE vault_case SET deleted_at=CURRENT_TIMESTAMP WHERE id=?').run(caseId);
  let entries=0;
  t.mock.method(globalThis,'fetch',async()=>{entries++;return Response.json({data:[{index:0,embedding:[1,0,0]}]});});
  await assert.rejects(searchKnowledgeEngine({...f.context,invocation:'agent',contentSources:[source.policy]}, {query:source.content,documentIds:[document.id],limit:8}),{code:'NOT_FOUND'});
  assert.equal(entries,0);
});

for (const revoke of [false,true]) test(`real background draft ${revoke?'refuses final artifact after in-flight original session revocation':'completes with TypeSafe RAG enabled'}`, async t=>{
  const f=await googleFixture(), document=await readyDocument(f); await enabled(f.context);
  if(revoke) await db.prepare("UPDATE typesafe_platform_connection SET rag_mode='off' WHERE id=1").run();
  const wire=await recordingWriter(t,f.userId,[{paragraphs:[{text:'Contrato assinado.',evidence:[{sourceId:document.chunkId,quote:'O contrato foi assinado'}]}],gaps:[]}]);
  const connection=await db.prepare('SELECT id FROM ai_connection WHERE name=?').get<{id:string}>('Writer fixture '+f.userId);
  await updateModelAssignment(db,f.userId,{scope:'task',target:'drafting.outline',model:{mode:'explicit',connectionId:connection!.id,modelId:'gpt-6-luna'},effort:{mode:'provider_default'}});
  const previous=globalThis.fetch;
  let secondary=0;
  t.mock.method(globalThis,'fetch',async (input: RequestInfo|URL,init?:RequestInit)=>{
    const request=new Request(input,init);
    if(request.url.startsWith('https://api.typesafe.ai/')){secondary++;return Response.json(decision(await request.json() as DecisionRequest));}
    const result=await previous(input,init);
    if(revoke) await db.prepare('DELETE FROM session WHERE id=?').run(f.context.sessionId);
    return result;
  });
  const {run}=await startRun(f.context,{kind:'draft',documentIds:[document.id],templateId:document.id,instructions:'Redija os fatos.'});
  await db.prepare('INSERT INTO ai_checkpoint(run_id,step_key,result) VALUES(?,?,?)').run(run.id,'outline',JSON.stringify({title:'Minuta',sections:[{heading:'Fatos',purpose:'Relatar',search:'contrato'}]}));
  await processNextRun();
  const actual=await db.prepare('SELECT status,error FROM ai_run WHERE id=?').get<{status:string;error:string|null}>(run.id);
  assert.equal(actual!.status,revoke?'failed':'completed',actual!.error??'');
  assert.equal(secondary,revoke?0:1); assert.equal(wire.length,1);
  assert.equal(Boolean(await db.prepare('SELECT id FROM ai_artifact WHERE run_id=?').get(run.id)),!revoke);
});

test('assessment configuration changed between owner check and evaluator load never dispatches a differently labeled evaluation', async t=>{
  const f=await googleFixture(), material=await catalog(), caseId=randomUUID(); await enabled(f.context);
  await db.prepare('INSERT INTO vault_case(id,office_id,name,created_by) VALUES(?,?,?,?)').run(caseId,f.officeId,'Avaliação',f.userId);
  await saveResearchCaseProfile(f.context,{caseId,expectedVersion:0,legalQuestion:'Questão jurídica',objective:'Objetivo',thesis:'Tese',documentedFacts:[],allegedFacts:['Fato alegado'],gaps:[],documentIds:[]});
  const assessment=await assessResearchCaseMaterial(f.context,{caseId,materialVersionId:material.versionId});
  assert.equal(assessment.status,'queued');
  const prepare=db.prepare.bind(db); let changed=false, entries=0;
  t.mock.method(db,'prepare',(sql:string)=>{
    const statement=prepare(sql);
    if(sql!=='SELECT * FROM typesafe_platform_connection WHERE id=1') return statement;
    return {...statement,async get<T>(...args:unknown[]){const result=await statement.get<T>(...args);if(!changed){changed=true;await prepare("UPDATE typesafe_platform_connection SET version=version+1,model='changed-model' WHERE id=1").run();}return result;}};
  });
  await processNextResearchAssessment({send:async(_key,request)=>{entries++;return decision(request);}});
  const row=await db.prepare('SELECT status,reason,result_json FROM research_case_assessment WHERE id=?').get<{status:string;reason:string;result_json:unknown}>(assessment.id);
  assert.equal(changed,true);assert.equal(entries,0);assert.equal(row!.status,'unavailable');assert.equal(row!.result_json,null);
  assert.equal((await db.prepare('SELECT failures FROM typesafe_platform_connection WHERE id=1').get<{failures:number}>())!.failures,0);
});

test('assessment dispatch rejects configuration drift committed by the real evaluation reservation', async()=>{
  const f=await googleFixture(),material=await catalog(),caseId=randomUUID();await enabled(f.context);
  await db.prepare('INSERT INTO vault_case(id,office_id,name,created_by) VALUES(?,?,?,?)').run(caseId,f.officeId,'Configuração fixada',f.userId);
  await saveResearchCaseProfile(f.context,{caseId,expectedVersion:0,legalQuestion:'Questão jurídica',objective:'Objetivo',thesis:'Tese',documentedFacts:[],allegedFacts:['Fato alegado'],gaps:[],documentIds:[]});
  const assessment=await assessResearchCaseMaterial(f.context,{caseId,materialVersionId:material.versionId});
  await db.exec(`CREATE FUNCTION drift_functional_config() RETURNS trigger AS $$ BEGIN UPDATE typesafe_platform_connection SET version=version+1 WHERE id=1; RETURN NEW; END $$ LANGUAGE plpgsql;
    CREATE TRIGGER drift_functional_config AFTER INSERT ON typesafe_evaluation FOR EACH ROW WHEN (NEW.purpose='research') EXECUTE FUNCTION drift_functional_config();`);
  let calls=0;
  try {await processNextResearchAssessment({send:async(_key,request)=>{calls++;return decision(request);}});}
  finally {await db.exec('DROP TRIGGER drift_functional_config ON typesafe_evaluation; DROP FUNCTION drift_functional_config();');}
  assert.equal(calls,0);
  assert.deepEqual(await db.prepare('SELECT status,reason,result_json FROM research_case_assessment WHERE id=?').get(assessment.id),{status:'unavailable',reason:'configuration_changed',result_json:null});
  assert.deepEqual(await db.prepare('SELECT status,reason,reserved_tokens FROM typesafe_evaluation WHERE user_id=?').get(f.userId),{status:'unavailable',reason:'configuration_changed',reserved_tokens:0});
  assert.equal((await db.prepare('SELECT failures FROM typesafe_platform_connection WHERE id=1').get<{failures:number}>())!.failures,0);
});
