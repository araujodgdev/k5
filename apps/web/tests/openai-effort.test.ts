import {testDb} from './test-setup';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {generateStructured,testModelCredential} from '../src/lib/ai-runtime';

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
