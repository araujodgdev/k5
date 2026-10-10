import './test-setup';
import test from 'node:test';
import assert from 'node:assert/strict';
import { protectedModelFor, modelProviderOptions } from '../src/lib/ai-providers';
import { admissionTransport } from '../src/lib/content-admission';
import { CapabilityError } from '../src/lib/capabilities/errors';
import { payloadDigest } from '../src/lib/content-result';

const providers = ['openai','cliproxyapi','anthropic','google','deepseek','inception','openrouter','vercel'] as const;
const endpoints = ['api.openai.com/v1/responses','api.lume.software/v1/responses','api.anthropic.com/v1/messages',
  'generativelanguage.googleapis.com/v1beta/models/fixture:generateContent','api.deepseek.com/chat/completions',
  'api.inceptionlabs.ai/v1/chat/completions','openrouter.ai/api/v1/chat/completions','ai-gateway.vercel.sh/v4/ai/language-model'];

test('all eight public protected adapters reach their native concrete request and latch denial for later repair', async () => {
  for (const [index,provider] of providers.entries()) {
    const calls: { url: string; body: Record<string,unknown>; headers: Headers }[] = [];
    let allowed = true;
    const denied = new CapabilityError('NOT_FOUND','Fonte indisponível.');
    const admission = { applicationDigest: payloadDigest('PINNED_PROTECTED_INPUT'), async admit() { if (!allowed) throw denied; } };
    const transport = admissionTransport(admission,async (input,init) => {
      calls.push({ url:String(input),body:JSON.parse(String(init?.body)),headers:new Headers(init?.headers) });
      allowed = false;
      return Response.json({ error:{message:'Controlled rejection',type:'invalid_request_error'} },{ status:400 });
    });
    const model = protectedModelFor({provider,modelId:'fixture',apiKey:'synthetic-key',session:'lume-task-fixture'},transport.fetch);
    const request: Parameters<typeof model.doGenerate>[0] = { prompt:[{ role:'user' as const,content:[{ type:'text' as const,text:'PINNED_PROTECTED_INPUT' }] }],
      responseFormat:{ type:'json',schema:{type:'object',properties:{ok:{type:'boolean'}},required:['ok'],additionalProperties:false} },
      providerOptions:modelProviderOptions(provider,null) };
    await assert.rejects(async () => model.doGenerate(request));
    assert.equal(calls.length,1,provider);
    assert.ok(calls[0].url.includes(endpoints[index]),`${provider}: ${calls[0].url}`);
    assert.match(JSON.stringify(calls[0].body),/PINNED_PROTECTED_INPUT/);
    if (provider === 'cliproxyapi') { assert.equal(calls[0].headers.get('Session-Id'),'lume-task-fixture'); assert.equal(calls[0].body.store,false); }
    if (provider === 'google') assert.ok(calls[0].body.contents);
    if (provider === 'anthropic') assert.ok(calls[0].body.messages);
    await assert.rejects(async () => model.doGenerate({...request,prompt:[{role:'user',content:[{type:'text',text:'SCHEMA_REPAIR_INPUT'}]}]}));
    assert.throws(() => transport.throwIfDenied(),error => error === denied);
    assert.equal(calls.length,1,`${provider}: denied repair never entered transport`);
    assert.equal(transport.wireDigests.length,1);
    assert.notEqual(transport.wireDigests[0],admission.applicationDigest);
  }
});

test('anthropic requests carry the effort the model accepts and cache the prompt only when asked', async () => {
  const bodies: Record<string, unknown>[] = [];
  const fetch: typeof globalThis.fetch = async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return Response.json({ error: { message: 'Controlled rejection', type: 'invalid_request_error' } }, { status: 400 });
  };
  const send = async (modelId: string, providerOptions: ReturnType<typeof modelProviderOptions>) => {
    const model = protectedModelFor({ provider: 'anthropic', modelId, apiKey: 'synthetic-key' }, fetch);
    await assert.rejects(async () => model.doGenerate({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'Olá' }] }], providerOptions }));
    return bodies.at(-1)!;
  };

  const chat = await send('claude-sonnet-5-5', modelProviderOptions('anthropic', 'medium', { modelId: 'claude-sonnet-5-5', promptCache: true }));
  assert.deepEqual(chat.cache_control, { type: 'ephemeral' });
  assert.deepEqual(chat.output_config, { effort: 'medium' });

  const task = await send('claude-haiku-5-5', modelProviderOptions('anthropic', 'minimal', { modelId: 'claude-haiku-5-5' }));
  assert.equal(task.cache_control, undefined);
  assert.deepEqual(task.output_config, { effort: 'low' });

  // Sonnet 4.5 rejects an effort, and the provider default sends none.
  assert.equal((await send('claude-sonnet-4-5', modelProviderOptions('anthropic', 'high', { modelId: 'claude-sonnet-4-5' }))).output_config, undefined);
  assert.equal(modelProviderOptions('anthropic', null, { modelId: 'claude-sonnet-5-5' }), undefined);
  assert.deepEqual(modelProviderOptions('anthropic', 'xhigh', { modelId: 'claude-sonnet-4-6' }), { anthropic: { effort: 'high' } });
});
