import {testDb} from './test-setup';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {createAgent,generateStructured,testModelCredential} from '../src/lib/ai-runtime';
import {createTool} from '@mastra/core/tools';
import {researchCapabilities} from '../src/lib/capabilities/research';

test('OpenAI requests carry the task effort through the Mastra adapter to the HTTP body, and none by default',async t=>{
  let body:Record<string,unknown>|undefined;
  t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
    body=JSON.parse(typeof init?.body==='string'?init.body:await new Request(input,init).text());
    // Deliberately reject after inspecting the wire request; never contact a provider.
    return Response.json({error:{message:'Controlled provider rejection',type:'invalid_request_error',code:'invalid_api_key'}},{status:400});
  });
  await assert.rejects(testModelCredential({provider:'openai',modelId:'gpt-5.6-luna',apiKey:'test-only'},'xhigh'));
  assert.ok(body,'The provider adapter must perform an HTTP request');
  assert.equal((body.reasoning as {effort?:string}|undefined)?.effort??body.reasoning_effort,'xhigh');
  // Provider default: no effort is sent at all.
  body=undefined;
  await assert.rejects(testModelCredential({provider:'openai',modelId:'gpt-5.6-luna',apiKey:'test-only'},null));
  const sent=body as Record<string,unknown>|undefined;
  assert.ok(sent);
  assert.equal((sent.reasoning as {effort?:string}|undefined)?.effort??sent.reasoning_effort,undefined);
});

test('a structured answer that fails the schema is recorded as a failure with the tokens it was billed',async t=>{
  const office=randomUUID(),user=randomUUID();
  await testDb.prepare('INSERT INTO user (id,email,name) VALUES (?,?,?)').run(user,`${user}@example.test`,'Advogada');
  await testDb.prepare('INSERT INTO office (id,name) VALUES (?,?)').run(office,'Escritório');
  t.mock.method(globalThis,'fetch',async()=>Response.json({id:'resp_1',object:'response',created_at:1,model:'gpt-6-luna',status:'completed',incomplete_details:null,
    output:[{type:'message',id:'msg_1',status:'completed',role:'assistant',content:[{type:'output_text',text:'{"wrong":1}',annotations:[]}]}],
    usage:{input_tokens:11,output_tokens:5,total_tokens:16}}));
  const config={task:'summary.email_digest' as const,provider:'openai' as const,modelId:'gpt-6-luna',apiKey:'test-only',connectionId:'c1',effort:null,modelSource:'group:summary',effortSource:'default'};
  await assert.rejects(generateStructured(office,user,config,'Resuma.',z.object({ok:z.boolean()})),/A análise falhou/);
  const rows=await testDb.prepare('SELECT task,status,input_tokens,output_tokens,error_class FROM ai_usage WHERE office_id=?').all(office);
  assert.deepEqual(rows,[{task:'summary.email_digest',status:'failed',input_tokens:11,output_tokens:5,error_class:'invalid_output'}]);
});

test('structured vision sends the original image and a typed JSON schema through the provider adapter',async t=>{
  const office=randomUUID(),user=randomUUID();
  await testDb.prepare('INSERT INTO user (id,email,name) VALUES (?,?,?)').run(user,`${user}@example.test`,'Advogada');
  await testDb.prepare('INSERT INTO office (id,name) VALUES (?,?)').run(office,'Escritório');
  const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jkX8AAAAASUVORK5CYII=','base64');
  let requestBody:Record<string,unknown>|undefined;
  const originalFetch=globalThis.fetch;
  t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
    if(String(input).startsWith('data:')) return originalFetch(input,init);
    requestBody=JSON.parse(typeof init?.body==='string'?init.body:await new Request(input,init).text());
    return Response.json({id:'resp_logo',object:'response',created_at:1,model:'gpt-6-sol',status:'completed',incomplete_details:null,
      output:[{type:'message',id:'msg_logo',status:'completed',role:'assistant',content:[{type:'output_text',text:'{"code":"27.5.1"}',annotations:[]}]}],
      usage:{input_tokens:21,output_tokens:9,total_tokens:30}});
  });
  const config={task:'classification.trademark_logo' as const,provider:'openai' as const,modelId:'gpt-6-sol',apiKey:'test-only',connectionId:'c1',effort:null,modelSource:'group:classification',effortSource:'default'};
  const result=await generateStructured(office,user,config,'Classifique.',z.object({code:z.string().regex(/^\d{1,2}\.\d{1,2}\.\d{1,2}$/)}),{image:{bytes,mimeType:'image/png'}});
  assert.deepEqual(result,{code:'27.5.1'});
  assert.ok(requestBody);
  const messages=requestBody.input as Array<{content:Array<{type:string;image_url?:string}>}>;
  const image=messages.flatMap(message=>message.content).find(part=>part.type==='input_image');
  assert.equal(image?.image_url,`data:image/png;base64,${bytes.toString('base64')}`);
  const text=requestBody.text as {format:{schema:{properties:{code:{type:string}}}}};
  assert.equal(text.format.schema.properties.code.type,'string');
  assert.deepEqual(await testDb.prepare('SELECT task,status,input_tokens,output_tokens FROM ai_usage WHERE office_id=?').all(office),
    [{task:'classification.trademark_logo',status:'completed',input_tokens:21,output_tokens:9}]);
});

test('trademark agent tools reach OpenAI with object parameters and typed Vienna codes',async t=>{
  let requestBody:Record<string,unknown>|undefined;
  t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
    requestBody=JSON.parse(typeof init?.body==='string'?init.body:await new Request(input,init).text());
    return Response.json({id:'resp_tools',object:'response',created_at:1,model:'gpt-6-sol',status:'completed',incomplete_details:null,
      output:[{type:'message',id:'msg_tools',status:'completed',role:'assistant',content:[{type:'output_text',text:'Confirmado.',annotations:[]}]}],
      usage:{input_tokens:21,output_tokens:9,total_tokens:30}});
  });
  const names=['k5_research_start_trademark_search','k5_research_analyze_trademark_logo'] as const;
  const tools=Object.fromEntries(names.map(name=>[name,createTool({id:name,description:researchCapabilities[name].description,
    inputSchema:researchCapabilities[name].input,execute:async()=>({ok:true})})]));
  const {agent}=await createAgent({task:'agent.chat',provider:'openai',modelId:'gpt-6-sol',apiKey:'test-only',connectionId:'c1',effort:null,modelSource:'default',effortSource:'default'},'Teste de contrato.',tools);
  const result=await agent.generate('Verifique as ferramentas.');assert.equal(result.text,'Confirmado.');
  assert.ok(requestBody);
  const sent=requestBody.tools as Array<{name:string;parameters:{type:string;properties:Record<string,unknown>}}>;
  assert.equal(sent.length,2);assert.ok(sent.every(tool=>tool.parameters.type==='object'));
  const search=sent.find(tool=>tool.name==='k5_research_start_trademark_search');assert.ok(search);
  const query=search.parameters.properties.query as {anyOf:Array<{properties:{kind:{const:string};codes?:{items:{type:string}}}}>};
  const vienna=query.anyOf.find(branch=>branch.properties.kind.const==='vienna');assert.equal(vienna?.properties.codes?.items.type,'string');
});
