import './test-setup';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {testModelCredential} from '../src/lib/ai-runtime';

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
