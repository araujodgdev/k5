import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
const pointer=JSON.parse(readFileSync(join(tmpdir(),'lume-verify-current.json'),'utf8'));
const state=JSON.parse(readFileSync(join(pointer.runDir,'state.json'),'utf8'));
assert.equal(state.runId,'20261006T234247-d88728');assert.equal(state.port,62541);assert.equal(state.pgPort,62542);
process.loadEnvFile(join(pointer.runDir,'verify.env'));process.env.DATABASE_URL=state.databaseUrl;
const require=createRequire(new URL('../apps/web/package.json',import.meta.url));
const serverOnly=require.resolve('server-only');require.cache[serverOnly]={id:serverOnly,filename:serverOnly,loaded:true,exports:{}} as NodeJS.Module;
const {database:db,authStore}=await import('../apps/web/src/lib/database');
const [mode,email,caseId,conversationId]=process.argv.slice(2);
assert.match(email,/@k5\.test$/);
const actor=await db.prepare(`SELECT m.user_id,m.office_id,s.id AS session_id FROM office_member m JOIN "user" u ON u.id=m.user_id JOIN session s ON s."userId"=u.id WHERE u.email=? AND s."expiresAt">clock_timestamp() ORDER BY s."createdAt" DESC LIMIT 1`).get<{user_id:string;office_id:string;session_id:string}>(email);
assert.ok(actor);assert.ok(await db.prepare('SELECT 1 FROM vault_case WHERE id=? AND office_id=? AND created_by=?').get(caseId,actor.office_id,actor.user_id));
const context={officeId:actor.office_id,userId:actor.user_id,sessionId:actor.session_id};
try {
 if(mode==='prepare') {
  const {recordPersonRequest}=await import('../apps/web/src/lib/documents/shared-writing');
  const {authorizeMessageScope}=await import('../apps/web/src/lib/chat-scope-server');
  const {runCapability}=await import('../apps/web/src/lib/agent-tools');
  const {createAiConnection,deleteAiConnection}=await import('../apps/web/src/lib/ai-connections-core');
  const {updateModelAssignment}=await import('../apps/web/src/lib/ai-assignments-core');
  const submissionId=await recordPersonRequest(context,conversationId,randomUUID(),'Prepare um perfil factual independente com os fatos informados neste pedido.',await authorizeMessageScope(context,{caseId,documentIds:[],researchReferenceIds:[]}),[]);
  const previous=await db.prepare("SELECT * FROM ai_model_assignment WHERE scope='task' AND target='drafting.section'").get<Record<string,unknown>>();
  const connection=await createAiConnection(db,Buffer.from(process.env.K5_CREDENTIALS_KEY!,'base64'),actor.user_id,{name:`Round3 browser ${randomUUID()}`,provider:'cliproxyapi',apiKey:'synthetic-browser-key'});
  const originalFetch=globalThis.fetch;let entries=0;
  try {
   await updateModelAssignment(db,actor.user_id,{scope:'task',target:'drafting.section',model:{mode:'explicit',connectionId:connection.id,modelId:'gpt-6-luna'},effort:{mode:'provider_default'}});
   globalThis.fetch=async(input,init)=>{const request=new Request(input,init);assert.equal(request.url,'https://api.lume.software/v1/responses');entries++;
    return Response.json({id:'profile-browser',object:'response',created_at:1,model:'gpt-6-luna',status:'completed',output:[{type:'message',id:'profile-message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify({legalQuestion:'Questão exata preparada para revisão.',objective:'Objetivo exato preparado.',thesis:null,documentedFacts:[],allegedFacts:['Fato exato preparado.'],gaps:[],documentIds:[]}),annotations:[]}]}],usage:{input_tokens:20,output_tokens:10,total_tokens:30}});
   };
   try {await runCapability({...context,invocation:'agent',conversationId,submissionId,generationId:randomUUID()},'k5_research_save_profile',{caseId,expectedVersion:0,change:{kind:'request'}});assert.fail('Missing exact review');}
   catch(error){assert.equal((error as {code:string}).code,'APPROVAL_REQUIRED');const approvalId=(error as Error).message.match(/\[id: ([\w-]+)\]/)?.[1];assert.ok(approvalId);console.log(JSON.stringify({approvalId,providerEntries:entries}));}
  } finally {
   globalThis.fetch=originalFetch;await db.prepare("DELETE FROM ai_model_assignment WHERE scope='task' AND target='drafting.section'").run();
   if(previous)await db.prepare('INSERT INTO ai_model_assignment(scope,target,model_mode,connection_id,model_id,effort_mode,reasoning_effort,updated_at,updated_by) VALUES(?,?,?,?,?,?,?,?,?)').run(...['scope','target','model_mode','connection_id','model_id','effort_mode','reasoning_effort','updated_at','updated_by'].map(key=>previous[key]));
   await deleteAiConnection(db,actor.user_id,connection.id);
  }
 } else if(mode==='legacy') {
  const installationId=randomUUID(),judgmentId=randomUUID(),materialId=randomUUID(),versionId=randomUUID();
  await db.prepare(`INSERT INTO judicial_source_installation(id,kind,court_code,court_name,degree,system,purpose,auth_kind,discovery_status,permission_query,permission_cache,permission_documents,permission_redistribution,permission_ai,enabled) VALUES(?,'jurisprudence_api',?,'Tribunal sintético','second','proprietary','jurisprudence','none','pilot','permitido','permitido','permitido','permitido','permitido',1)`).run(installationId,`TJ${installationId.slice(0,6)}`);
  await db.prepare("INSERT INTO research_judgment(id,installation_id,source_judgment_id,tribunal,title,metadata_hash,collected_at,status) VALUES(?,?,?,'TJDFT','Referência controlada','round3','2026-10-07','active')").run(judgmentId,installationId,randomUUID());
  await db.prepare("INSERT INTO research_material(id,judgment_id,kind,status,current_version_id) VALUES(?,?,'ementa','ready',?)").run(materialId,judgmentId,versionId);
  const text='Ementa sintética pública com conteúdo para revisão do perfil.';
  await db.prepare(`INSERT INTO research_material_version(id,material_id,sha256,mime_type,byte_size,text_content,parser_version,citation_metadata_json,metadata_revision,collected_at,published_at) VALUES(?,?,?,'text/plain',?,?,'v1',?,1,'2026-10-07','2026-10-07')`).run(versionId,materialId,createHash('sha256').update(text).digest('hex'),Buffer.byteLength(text),text,JSON.stringify({tribunal:'TJDFT',title:'Referência controlada',courtUnit:null,caseNumber:'001',decisionDate:'2026-10-07',sourceUrl:'https://example.test/judgment'}));
  await db.prepare("INSERT INTO research_chunk(id,material_version_id,ordinal,text_content,reference) VALUES(?,?,0,?,'ementa:1')").run(randomUUID(),versionId,text);
  const {assessResearchCaseMaterial}=await import('../apps/web/src/lib/research/case-assessment');
  const {addResearchCaseReference}=await import('../apps/web/src/lib/research/case-references');
  const assessment=await assessResearchCaseMaterial(context,{caseId,materialVersionId:versionId});
  const reference=await addResearchCaseReference(context,{caseId,materialVersionId:versionId,purpose:'context',assessmentId:assessment.id,bypassEvaluation:true,notes:'UNKNOWN_LEGACY_NOTES'});
  await db.prepare('UPDATE research_case_profile SET content_parts=NULL WHERE case_id=? AND office_id=?').run(caseId,context.officeId);
  await db.prepare('UPDATE research_case_reference SET notes_policy=NULL,notes_receipt=NULL WHERE id=?').run(reference.id);
  console.log(JSON.stringify({judgmentId,referenceId:reference.id}));
 } else throw Error('Unsupported owned fixture mode');
} finally {await(await authStore()).end();}
