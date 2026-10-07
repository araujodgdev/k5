import { fixtureSession } from './session-fixture';
import { testDb } from './test-setup';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { capabilities, publishedCapabilities } from '../src/lib/capabilities/contracts';
import { requestCapability } from '../src/lib/capabilities/http-client';
import { agentTools, runCapability } from '../src/lib/agent-tools';
import type { WorkspaceContext } from '../src/lib/application/context';

async function actor(): Promise<WorkspaceContext> {
  const officeId = randomUUID();
  const userId = randomUUID();
  (await testDb.prepare('INSERT INTO office(id,name) VALUES(?,?) ON CONFLICT DO NOTHING').run(officeId, 'Escritório de teste'));
  (await testDb.prepare('INSERT INTO user(id,email,name) VALUES(?,?,?)').run(userId, `${userId}@test.invalid`, 'Pesquisador'));
  (await testDb.prepare('INSERT INTO office_member(id,office_id,user_id) VALUES(?,?,?)').run(randomUUID(), officeId, userId));
  return { officeId, userId, sessionId: await fixtureSession(userId) };
}

test('pesquisa publica operações autorizadas de leitura e escrita', async () => {
  const names = publishedCapabilities('agent').filter(name => capabilities[name].module === 'research');
  assert.deepEqual(publishedCapabilities('agent').filter(name => capabilities[name].module === 'research'), names);
  assert.deepEqual(publishedCapabilities('webmcp').filter(name => capabilities[name].module === 'research'), names.filter(name => name !== 'k5_research_score_jurisprudence'));
  const tools = agentTools((await actor()));
  assert.ok(tools.k5_research_search_corpus);
  assert.ok(tools.k5_research_start_search);
  assert.ok(tools.k5_research_add_reference);
  assert.ok(publishedCapabilities('agent').includes('k5_research_score_jurisprudence'));
});

test('agente solicita confirmação para pesquisa externa e operação exige vínculo ativo', async () => {
  const lawyer = (await actor());
  await assert.rejects(
    runCapability({ ...lawyer, invocation: 'agent' }, 'k5_research_start_search', { theme: 'guarda da avó', includeSources: false }),
    { code: 'APPROVAL_REQUIRED' },
  );
  await assert.rejects(
    runCapability({ ...lawyer, invocation: 'webmcp' }, 'k5_research_assess_material', { caseId: randomUUID(), materialVersionId: randomUUID() }),
    { code: 'NOT_FOUND' },
  );
  const removed = await actor();
  await testDb.prepare('DELETE FROM office_member WHERE user_id=?').run(removed.userId);
  await assert.rejects(
    runCapability(removed, 'k5_research_start_search', { theme: 'guarda da avó', includeSources: false }),
    { code: 'FORBIDDEN' },
  );
});

test('pesquisa fica no autor e chave idempotente não aceita outro tema', async () => {
  const a = (await actor());
  const colleague = await actor();
  const otherOffice = (await actor());
  const idempotencyKey = randomUUID();
  const input = { theme: `guarda da avó ${randomUUID()}`, includeSources: false, idempotencyKey };
  const started = await runCapability(a, 'k5_research_start_search', input) as { search: { id: string } };
  const repeated = await runCapability(a, 'k5_research_start_search', input) as { search: { id: string } };
  assert.equal(started.search.id, repeated.search.id);
  await assert.rejects(runCapability(a, 'k5_research_start_search', { ...input, theme: 'alimentos', idempotencyKey }), { code: 'CONFLICT' });
  await assert.rejects(runCapability(colleague, 'k5_research_get_search', { searchId: started.search.id }), { code: 'NOT_FOUND' });
  await assert.rejects(runCapability(otherOffice, 'k5_research_get_search', { searchId: started.search.id }), { code: 'NOT_FOUND' });
});

test('pesquisa na web usa o modo escolhido, fica no histórico e só o autor a reabre', async (t) => {
  const a = await actor();
  const colleague = await actor();
  const sent: Array<Record<string, unknown>> = [];
  const originalKey = process.env.EXA_API_KEY;
  process.env.EXA_API_KEY = 'exa-test';
  t.after(() => { if (originalKey === undefined) Reflect.deleteProperty(process.env, 'EXA_API_KEY'); else process.env.EXA_API_KEY = originalKey; });
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)));
    return Response.json({ results: [
      { title: 'REsp 1.234.567', url: 'https://www.stj.jus.br/julgado', publishedDate: '2025-03-10', text: 'Guarda   concedida à avó.' },
      { title: 'Sem protocolo', url: 'javascript:alert(1)', text: 'descartado' },
    ] });
  });
  const query = `guarda da avó ${randomUUID()}`;
  const { search } = await runCapability(a, 'k5_research_web_search', { query, mode: 'deep' }) as { search: { id: string; mode: string; results: Array<{ host: string; excerpt: string }> } };
  assert.equal(sent[0].type, 'deep');
  assert.equal(sent[0].query, query);
  assert.equal(search.mode, 'deep');
  assert.deepEqual(search.results.map(({ host, excerpt }) => ({ host, excerpt })), [{ host: 'stj.jus.br', excerpt: 'Guarda concedida à avó.' }]);
  const history = await runCapability(a, 'k5_research_list_web_searches', {}) as { searches: Array<{ id: string; resultCount: number }> };
  assert.deepEqual(history.searches.map(({ id, resultCount }) => ({ id, resultCount })), [{ id: search.id, resultCount: 1 }]);
  const reopened = await runCapability(a, 'k5_research_get_web_search', { searchId: search.id }) as { search: { results: unknown[] } };
  assert.equal(reopened.search.results.length, 1);
  assert.equal(sent.length, 1);
  await assert.rejects(runCapability(colleague, 'k5_research_get_web_search', { searchId: search.id }), { code: 'NOT_FOUND' });
  assert.deepEqual((await runCapability(colleague, 'k5_research_list_web_searches', {}) as { searches: unknown[] }).searches, []);
});

test('tema privado segue no corpo do POST de busca do acervo', async () => {
  const original = globalThis.fetch;
  let url = '';
  let method = '';
  let payload: unknown;
  globalThis.fetch = async (input, init) => {
    url = String(input); method = String(init?.method); payload = JSON.parse(String(init?.body));
    return Response.json({ results: [], nextCursor: null, total: 0 });
  };
  try {
    const result = await requestCapability('k5_research_search_corpus', { theme: 'guarda da avó', filters: {} });
    assert.equal(result.ok, true);
    assert.equal(url, '/api/research/corpus');
    assert.equal(method, 'POST');
    assert.deepEqual(payload, { theme: 'guarda da avó', filters: {} });
  } finally { globalThis.fetch = original; }
});
