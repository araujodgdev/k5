import { testDb } from './test-setup';
import { postgresFixture } from './postgres-fixture';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import { z } from 'zod';
import { createTool } from '@mastra/core/tools';
import { createAgent, requestContextFor, type ResolvedTaskModel } from '../src/lib/ai-runtime';
import { modelFor, conversationSession } from '../src/lib/ai-providers';
import { modelModalities, modelReadsPdf, chatHearsAudio } from '../src/lib/ai-modalities';
import { createAiConnection, updateAiConnection, readSecret, resolveEmbeddingConfigFromDatabase } from '../src/lib/ai-connections-core';
import { loadAssignmentSnapshot, planTask, resolveTaskModelFromDatabase, testModelAssignment, updateModelAssignment, pinRunModelPlan, resolvePinnedTaskModel } from '../src/lib/ai-assignments-core';
import { embedTexts } from '../src/lib/knowledge/embedding-provider';
import { webSearchFor } from '../src/lib/agent-web-search';
import { webSearchLinks } from '../src/lib/research/jurisprudence-score';
import { webStepSources, recordedWebSources } from '../src/lib/citations/web-step';

const responseBody = {
  id: 'resp_test', object: 'response', created_at: 1, model: 'gpt-6-luna', status: 'completed',
  output: [{ type: 'message', id: 'msg_test', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'OK', annotations: [] }] }],
  usage: { input_tokens: 4, output_tokens: 1, total_tokens: 5 },
};
const generate = async (apiKey: string, session?: string) => {
  const model = modelFor({ provider: 'cliproxyapi', modelId: 'gpt-6-luna', apiKey, session });
  return model.doGenerate({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'Oi' }] }] });
};

test('a platform with only a proxy connection remains unconfigured until explicitly assigned', async () => {
  const { db } = await postgresFixture();
  const actor = randomUUID();
  await db.prepare('INSERT INTO user(id,email,name) VALUES(?,?,?)').run(actor, `${actor}@test.local`, 'Admin');
  const connection = await createAiConnection(db, randomBytes(32), actor, { name: 'Única conexão', provider: 'cliproxyapi', apiKey: 'synthetic-only-proxy' });
  assert.equal(planTask('agent.chat', await loadAssignmentSnapshot(db)).status, 'unconfigured');
  await updateModelAssignment(db, actor, { scope: 'task', target: 'agent.chat', model: { mode: 'explicit', connectionId: connection.id, modelId: 'gpt-6-luna' }, effort: { mode: 'provider_default' } });
  const plan = planTask('agent.chat', await loadAssignmentSnapshot(db));
  assert.ok(plan.status === 'ready');
  assert.equal(plan.provider, 'cliproxyapi');
  assert.equal(plan.connectionId, connection.id);
});

test('proxy transport binds isolated credentials and opaque conversation sessions to Responses', async t => {
  const requests: Request[] = [];
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(new Request(input, init));
    return Response.json(responseBody);
  });
  const owner = { userId: 'server-user', officeId: 'server-office' };
  const session = conversationSession(owner, 'conversation-a');
  const other = conversationSession(owner, 'conversation-b');
  assert.match(session, /^lume-[a-f0-9]{32}$/);
  assert.equal(conversationSession(owner, 'conversation-a'), session);
  assert.equal(new Set([session, other, conversationSession({ ...owner, userId: 'other-user' }, 'conversation-a'), conversationSession({ ...owner, officeId: 'other-office' }, 'conversation-a')]).size, 4);
  const results = await Promise.all([generate('synthetic-a', session), generate('synthetic-b', other)]);
  assert.deepEqual(results.map(result => result.content), [[{ type: 'text', text: 'OK', providerMetadata: { openai: { itemId: 'msg_test' } } }], [{ type: 'text', text: 'OK', providerMetadata: { openai: { itemId: 'msg_test' } } }]]);
  assert.deepEqual(requests.map(request => [request.url, request.headers.get('authorization'), request.headers.get('session-id'), request.redirect]), [
    ['https://api.lume.software/v1/responses', 'Bearer synthetic-a', session, 'manual'],
    ['https://api.lume.software/v1/responses', 'Bearer synthetic-b', other, 'manual'],
  ]);
  assert.equal((await requests[0].json()).model, 'gpt-6-luna');
  await generate('synthetic-task'); await generate('synthetic-task');
  assert.match(requests[2].headers.get('session-id')!, /^lume-task-/);
  assert.notEqual(requests[2].headers.get('session-id'), requests[3].headers.get('session-id'));
  assert.deepEqual(modelFor({ provider: 'openai', modelId: 'gpt-6-luna', apiKey: 'direct-key' }), { providerId: 'openai', modelId: 'gpt-6-luna', apiKey: 'direct-key' });
});

test('proxy redirects fail without forwarding credentials to the redirect destination', async t => {
  const destinations: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    assert.equal(request.redirect, 'manual');
    destinations.push(request.url);
    return new Response(null, { status: 307, headers: { location: 'https://other.example/responses' } });
  });
  await assert.rejects(generate('synthetic-secret'), /redirect refused/);
  assert.deepEqual(destinations, ['https://api.lume.software/v1/responses']);
});

test('only proven proxy image input is enabled; manual PDF, audio and embedding model names do not grant capabilities', async () => {
  assert.deepEqual(modelModalities('cliproxyapi', 'gpt-6-luna'), { image: true, audio: false });
  for (const model of ['gpt-6.1-sol', 'gpt-4o-audio-preview', 'google/gemini-2.5-pro', 'unknown']) {
    assert.deepEqual(modelModalities('cliproxyapi', model), { image: false, audio: false });
    assert.equal(chatHearsAudio('cliproxyapi', model), false);
  }
  assert.equal(modelReadsPdf('cliproxyapi', 'gpt-6-luna'), false);
  assert.equal(modelReadsPdf('openai', 'gpt-6-luna'), true);
  await assert.rejects(embedTexts({ provider: 'cliproxyapi', modelId: 'text-embedding-3-small', apiKey: 'synthetic', connectionId: 'proxy' }, ['Texto']), /não é compatível/);
});

test('native search sources nested in provider tool results reach links, citations and persistence', () => {
  const step = { sources: [], toolResults: [{ type: 'tool-result', from: 'AGENT', payload: {
    toolCallId: 'ws_test', toolName: 'web_search', result: {
      action: { type: 'search', query: 'example.com', queries: ['example.com'] },
      sources: [{ type: 'url', url: 'https://www.iana.org/help/example-domains' }],
    }, providerExecuted: true,
  } }] };
  const tool = webSearchFor('cliproxyapi').web_search;
  assert.ok(tool && typeof tool === 'object' && 'type' in tool && 'id' in tool);
  assert.equal(tool.type, 'provider'); assert.equal(tool.id, 'openai.web_search');
  assert.deepEqual(webSearchLinks(step), ['https://www.iana.org/help/example-domains']);
  assert.deepEqual(webStepSources(step), [{ id: 'https://www.iana.org/help/example-domains', url: 'https://www.iana.org/help/example-domains', title: 'https://www.iana.org/help/example-domains', text: '' }]);
  assert.deepEqual(recordedWebSources(step), [{ kind: 'web', ref: 'https://www.iana.org/help/example-domains', url: 'https://www.iana.org/help/example-domains', title: 'https://www.iana.org/help/example-domains', text: '' }]);
});

test('Mastra resumes after native search and a local tool without replaying stateless item references', async t => {
  const requests: Array<{ store?: boolean; input: Array<{ type?: string; call_id?: string; output?: string }> }> = [];
  t.mock.method(globalThis, 'fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body)));
    return Response.json(requests.length === 1 ? { ...responseBody, output: [
      { type: 'web_search_call', id: 'ws_stateless', status: 'completed', action: { type: 'search', query: 'example.com', sources: [{ type: 'url', url: 'https://www.iana.org/help/example-domains' }] } },
      { type: 'function_call', id: 'fc_stateless', call_id: 'call_lookup', name: 'lookup', arguments: '{}', status: 'completed' },
    ] } : responseBody);
  });
  const config: ResolvedTaskModel = { task: 'agent.chat', provider: 'cliproxyapi', modelId: 'gpt-6-luna', apiKey: 'synthetic-multi-step',
    connectionId: 'test', effort: null, modelSource: 'task:agent.chat', effortSource: 'task:agent.chat' };
  const { agent } = await createAgent(config, 'Use a busca e consulte a tarefa.', {
    ...webSearchFor('cliproxyapi'),
    lookup: createTool({ id: 'lookup', description: 'Consulta uma tarefa de teste', inputSchema: z.object({}), outputSchema: z.object({ title: z.string() }), execute: async () => ({ title: 'Revisar contrato' }) }),
  });
  const result = await agent.generate('Pesquise example.com e consulte a tarefa.', { requestContext: requestContextFor(config), maxSteps: 3 });
  assert.equal(result.text, 'OK');
  assert.equal(requests.length, 2);
  assert.deepEqual(requests.map(request => request.store), [false, false]);
  assert.equal(requests[1].input.some(item => item.type === 'item_reference'), false);
  assert.deepEqual(requests[1].input.filter(item => item.type === 'function_call_output').map(item => [item.call_id, item.output]), [['call_lookup', '{"title":"Revisar contrato"}']]);
  assert.deepEqual(webStepSources({ toolResults: result.toolResults }).map(source => source.url), ['https://www.iana.org/help/example-domains']);
});

test('proxy selection is explicit, encrypted, pinned and separate from direct OpenAI assignments', async () => {
  const key = randomBytes(32), actor = randomUUID();
  await testDb.prepare('INSERT INTO user(id,email,name) VALUES(?,?,?)').run(actor, `${actor}@test.local`, 'Admin');
  const direct = await createAiConnection(testDb, key, actor, { name: 'Direta', provider: 'openai', apiKey: 'direct-synthetic-secret', models: { embedding: 'text-embedding-3-small' } });
  const proxy = await createAiConnection(testDb, key, actor, { name: 'Proxy', provider: 'cliproxyapi', apiKey: 'proxy-synthetic-secret' });
  const plan = async () => planTask('agent.chat', await loadAssignmentSnapshot(testDb));
  assert.equal((await resolveTaskModelFromDatabase(testDb, key, 'agent.chat')).connectionId, direct.id);
  await updateAiConnection(testDb, key, actor, proxy.id, { name: 'Proxy atualizado' });
  assert.equal((await resolveTaskModelFromDatabase(testDb, key, 'agent.chat')).apiKey, 'direct-synthetic-secret');
  assert.equal((await resolveEmbeddingConfigFromDatabase(testDb, key)).apiKey, 'direct-synthetic-secret');
  await updateModelAssignment(testDb, actor, { scope: 'group', target: 'agent', model: { mode: 'explicit', connectionId: proxy.id, modelId: 'gpt-6-luna' }, effort: { mode: 'provider_default' } });
  assert.deepEqual(await plan(), { status: 'ready', provider: 'cliproxyapi', connectionId: proxy.id, connectionName: 'Proxy atualizado', modelId: 'gpt-6-luna', modelOrigin: { scope: 'group', target: 'agent' }, effort: null, effortOrigin: { scope: 'group', target: 'agent' } });
  assert.equal((await resolveTaskModelFromDatabase(testDb, key, 'agent.chat')).apiKey, 'proxy-synthetic-secret');
  assert.equal(planTask('transcription.voice_note', await loadAssignmentSnapshot(testDb)).status, 'disabled');
  for (const modelId of ['gpt-4o-mini-transcribe', 'gemini-2.5-pro']) await assert.rejects(updateModelAssignment(testDb, actor, {
    scope: 'task', target: 'transcription.voice_note', model: { mode: 'explicit', connectionId: proxy.id, modelId }, effort: { mode: 'inherit' },
  }), /não oferece transcrição/);
  await assert.rejects(updateAiConnection(testDb, key, actor, proxy.id, { models: { embedding: 'text-embedding-3-small' } }), /não oferece embeddings/);
  const row = await testDb.prepare('SELECT encrypted_api_key FROM ai_connection WHERE id=?').get<{ encrypted_api_key: string }>(proxy.id);
  assert.equal(readSecret(row!.encrypted_api_key, key), 'proxy-synthetic-secret');
  assert.equal(JSON.stringify(proxy).includes('proxy-synthetic-secret'), false);
  assert.equal(row!.encrypted_api_key.includes('proxy-synthetic-secret'), false);
  const pinned = pinRunModelPlan(await loadAssignmentSnapshot(testDb), ['drafting.section']);
  await updateModelAssignment(testDb, actor, { scope: 'group', target: 'agent', model: { mode: 'explicit', connectionId: direct.id, modelId: 'gpt-6-sol' }, effort: { mode: 'provider_default' } });
  assert.equal((await resolvePinnedTaskModel(testDb, key, pinned, 'drafting.section')).provider, 'cliproxyapi');
  await assert.rejects(updateAiConnection(testDb, key, actor, proxy.id, { provider: 'openai' }), /chave do novo provider/);
  await updateAiConnection(testDb, key, actor, proxy.id, { provider: 'openai', apiKey: 'new-direct-secret' });
  await assert.rejects(resolvePinnedTaskModel(testDb, key, pinned, 'drafting.section'), /provider/);
  await assert.rejects(updateAiConnection(testDb, key, actor, proxy.id, { provider: 'cliproxyapi' }), /chave do novo provider/);
});

for (const operation of ['resolve', 'probe'] as const) {
  test(`a provider change during ${operation} cannot attach a proxy key to an implicit OpenAI plan`, async t => {
    const { db } = await postgresFixture();
    const key = randomBytes(32), actor = randomUUID();
    await db.prepare('INSERT INTO user(id,email,name) VALUES(?,?,?)').run(actor, `${actor}@test.local`, 'Admin');
    const connection = await createAiConnection(db, key, actor, { name: 'Direta', provider: 'openai', apiKey: 'synthetic-direct-before-switch' });
    assert.equal((await resolveTaskModelFromDatabase(db, key, 'agent.chat')).provider, 'openai');
    const paused = Promise.withResolvers<void>(), resume = Promise.withResolvers<void>();
    const prepare = db.prepare.bind(db);
    let intercepted = false;
    t.mock.method(db, 'prepare', (sql: string) => {
      const statement = prepare(sql);
      if (intercepted || !sql.startsWith('SELECT encrypted_api_key FROM ai_connection')) return statement;
      intercepted = true;
      return { ...statement, async get<T>(...params: unknown[]) {
        paused.resolve();
        await resume.promise;
        return statement.get<T>(...params);
      } };
    });
    const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected external request'); });
    const send = t.mock.fn(async () => { throw new Error('Unexpected model probe'); });
    const resolving = operation === 'resolve'
      ? resolveTaskModelFromDatabase(db, key, 'agent.chat')
      : testModelAssignment(db, key, actor, { scope: 'group', target: 'agent' }, send);
    const refused = assert.rejects(resolving, { code: 'unavailable' });
    await paused.promise;
    try {
      await updateAiConnection(db, key, actor, connection.id, { provider: 'cliproxyapi', apiKey: 'synthetic-proxy-after-switch' });
    } finally { resume.resolve(); }
    await refused;
    assert.equal(send.mock.callCount(), 0);
    assert.equal(fetch.mock.callCount(), 0);
  });
}
