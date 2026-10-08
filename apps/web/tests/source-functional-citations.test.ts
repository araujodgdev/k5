import { testDb as db } from './test-setup';
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { registerHooks } from 'node:module';
import { authStore, withPostgres } from '../src/lib/database';
import { requestHeaders } from './support/request-headers';
import { createConversation } from '../src/lib/ai-store';
import { createPrivateDocument } from '../src/lib/documents/service';
import { recordSources } from '../src/lib/citations/sources';
import { createAiConnection } from '../src/lib/ai-connections-core';
import { updateModelAssignment } from '../src/lib/ai-assignments-core';
import { saveConnection, connectionView } from '../src/lib/typesafe/config';
import { connectionSettings } from '../src/lib/typesafe/contracts';
import type { DecisionRequest } from '../src/lib/typesafe/client';
import { createPage } from '../src/lib/case-pages/service';
import { observePage } from '../src/lib/content-policy';
import { LEGAL_VERSION } from '../src/lib/legal-version';

process.env.BETTER_AUTH_SECRET = randomBytes(48).toString('base64url');
process.env.BETTER_AUTH_URL = 'http://localhost:62541';
const hooks = registerHooks({ resolve(specifier, context, next) {
  return specifier === 'next/headers' ? { url: new URL('./support/request-headers.ts', import.meta.url).href, shortCircuit: true } : next(specifier, context);
} });
after(() => hooks.deregister());

async function fixture() {
  const pool=await authStore();
  (globalThis as typeof globalThis & { k5Postgres?: { database: typeof db; store: typeof pool } }).k5Postgres={database:db,store:pool};
  const {auth}=await import('../src/lib/auth'), origin='http://localhost:62541';
  const response=await withPostgres(pool,()=>auth.handler(new Request(origin+'/api/auth/sign-up/email',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({name:'Pessoa',officeName:'Citações',email:randomUUID()+'@test.local',password:'Citations-Test-2026!',acceptedLegalVersion:LEGAL_VERSION})})));
  assert.equal(response.status,200);
  const cookie=response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; '),{user}=await response.json();
  const office=(await db.prepare('SELECT office_id FROM office_member WHERE user_id=?').get<{office_id:string}>(user.id))!;
  const session=(await db.prepare('SELECT id FROM session WHERE userId=?').get<{id:string}>(user.id))!;
  const context={userId:user.id,officeId:office.office_id,sessionId:session.id};
  await db.prepare('INSERT INTO platform_admin(user_id) VALUES(?)').run(user.id);
  await saveConnection(user.id,connectionSettings.parse({apiKey:'synthetic-citation-key',enabled:true,documents:'enabled',version:(await connectionView()).version}));
  const conversation=await createConversation(db,context);
  await recordSources(context,conversation.id,[{kind:'web',ref:'https://example.test/cc',title:'Código Civil',text:'Art. 113 do Código Civil. Os negócios jurídicos devem ser interpretados conforme a boa-fé.'}]);
  const headers=new Headers({origin,cookie,'content-type':'application/json'});
  return {pool,origin,context,conversation,headers};
}

function evaluated(request:DecisionRequest) {
  return {model:request.model,usage:{input_tokens:100,output_tokens:20},answers:Object.fromEntries(Object.entries(request.questions).map(([name,question])=>{
    if(question.type==='noul')return [name,{type:'noul',noul:1}];
    assert.equal(question.type,'choice');
    const choice=name.startsWith('kind_')?'statute':'supports';
    return [name,{type:'choice',choice,confidence:1,probabilities:Object.fromEntries(Object.keys(question.criteria!).map(key=>[key,Number(key===choice)]))}];
  }))};
}

test('authenticated manual citation route evaluates its exact artifact under the original session',async t=>{
  const f=await fixture(), artifact=await createPrivateDocument({...f.context,conversationId:f.conversation.id},{title:'Fundamento',content:'Aplica-se o art. 113 do Código Civil.'});
  let calls=0;
  t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{const request=new Request(input,init);assert.ok(request.url.startsWith('https://api.typesafe.ai/'));calls++;return Response.json(evaluated(await request.json() as DecisionRequest));});
  const {POST}=await import('../src/app/api/artifacts/[id]/citations/route');
  const result=await withPostgres(f.pool,()=>requestHeaders.run(f.headers,()=>POST(new Request(f.origin+'/api/artifacts/'+artifact.id+'/citations',{method:'POST',headers:f.headers}),{params:Promise.resolve({id:artifact.id})})));
  assert.equal(result.status,200); assert.equal((await result.json()).review.status,'evaluated'); assert.equal(calls,1);
});

test('manual citation route carries artifact source policy even when the retained public citation is independent',async t=>{
  const f=await fixture(),caseId=randomUUID();
  await db.prepare('INSERT INTO vault_case(id,office_id,name,created_by) VALUES(?,?,?,?)').run(caseId,f.context.officeId,'Fonte do argumento',f.context.userId);
  const page=(await createPage(f.context,{caseId,title:'Origem',content:'Argumento restrito'})).page;
  const artifact=await createPrivateDocument({...f.context,conversationId:f.conversation.id},{title:'Fundamento',content:'Aplica-se o art. 113 do Código Civil.',sources:[(await observePage(f.context.userId,page.id,caseId)).policy]});
  await db.prepare('UPDATE vault_case SET deleted_at=CURRENT_TIMESTAMP WHERE id=?').run(caseId);
  let calls=0; t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('No external call may enter');});
  const {POST}=await import('../src/app/api/artifacts/[id]/citations/route');
  const result=await withPostgres(f.pool,()=>requestHeaders.run(f.headers,()=>POST(new Request(f.origin+'/api/artifacts/'+artifact.id+'/citations',{method:'POST',headers:f.headers}),{params:Promise.resolve({id:artifact.id})})));
  assert.equal(result.status,404); assert.equal(calls,0);
});

test('real authenticated chat emits evaluated citations with TypeSafe enabled',async t=>{
  const f=await fixture();
  const connection=await createAiConnection(db,Buffer.from(process.env.K5_CREDENTIALS_KEY!,'base64'),f.context.userId,{name:'Citations chat',provider:'cliproxyapi',apiKey:'synthetic-chat-key'});
  await updateModelAssignment(db,f.context.userId,{scope:'task',target:'agent.chat',model:{mode:'explicit',connectionId:connection.id,modelId:'gpt-6-luna'},effort:{mode:'provider_default'}});
  let calls=0;
  t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
    const request=new Request(input,init);
    if(request.url.startsWith('https://api.typesafe.ai/')){calls++;return Response.json(evaluated(await request.json() as DecisionRequest));}
    assert.equal(request.url,'https://api.lume.software/v1/responses');
    const text='Aplica-se o art. 113 do Código Civil.',item={type:'message',id:'msg_citations',role:'assistant',status:'completed',content:[{type:'output_text',text,annotations:[]}]};
    const events=[{type:'response.created',response:{id:'resp_citations',created_at:1,model:'gpt-6-luna'}},{type:'response.output_item.added',output_index:0,item},{type:'response.output_text.delta',item_id:item.id,output_index:0,delta:text},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response:{usage:{input_tokens:40,output_tokens:10,total_tokens:50}}}];
    return new Response(events.map(event=>'data: '+JSON.stringify(event)+'\n\n').join('')+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
  });
  const {POST}=await import('../src/app/api/chat/route');
  const result=await withPostgres(f.pool,()=>requestHeaders.run(f.headers,()=>POST(new Request(f.origin+'/api/chat',{method:'POST',headers:f.headers,body:JSON.stringify({conversationId:f.conversation.id,message:{id:randomUUID(),role:'user',parts:[{type:'text',text:'Explique a boa-fé.'}]}})}))));
  assert.equal(result.status,200); const stream=await result.text(); assert.match(stream,/data-citations/); assert.match(stream,/"status":"evaluated"/); assert.equal(calls,1);
});
