import './test-setup';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {testModelCredential} from '../src/lib/ai-runtime';

test('OpenAI requests carry xhigh through the Mastra adapter to the HTTP body',async t=>{
  let body:Record<string,unknown>|undefined;
  t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
    body=JSON.parse(typeof init?.body==='string'?init.body:await new Request(input,init).text());
    // Deliberately reject after inspecting the wire request; never contact a provider.
    return Response.json({error:{message:'Controlled provider rejection',type:'invalid_request_error',code:'invalid_api_key'}},{status:400});
  });
  await assert.rejects(testModelCredential({provider:'openai',modelId:'gpt-5.6-luna',apiKey:'test-only'}));
  assert.ok(body,'The provider adapter must perform an HTTP request');
  assert.equal((body.reasoning as {effort?:string}|undefined)?.effort??body.reasoning_effort,'xhigh');
});
