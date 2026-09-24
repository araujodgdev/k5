import { testDb } from './test-setup';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { capabilities, capabilitiesForRole, publishedCapabilitiesForRole } from '../src/lib/capabilities/contracts';
import { requestCapability } from '../src/lib/capabilities/http-client';
import { agentTools, runCapability } from '../src/lib/agent-tools';
import type { WorkspaceContext } from '../src/lib/application/context';

async function actor(role: WorkspaceContext['role'] = 'lawyer', officeId: string = randomUUID()): Promise<WorkspaceContext> {
  const userId = randomUUID();
  (await testDb.prepare('INSERT INTO office(id,name) VALUES(?,?) ON CONFLICT DO NOTHING').run(officeId, 'Escritório de teste'));
  (await testDb.prepare('INSERT INTO user(id,email,name) VALUES(?,?,?)').run(userId, `${userId}@test.invalid`, 'Pesquisador'));
  (await testDb.prepare('INSERT INTO office_member(id,office_id,user_id,role) VALUES(?,?,?,?)').run(randomUUID(), officeId, userId, role));
  return { officeId, userId, role };
}

test('somente leituras de acervo, julgado e referências são publicadas', async () => {
  const names = ['k5_research_search_corpus', 'k5_research_get_judgment', 'k5_research_list_references'];
  // Web case law is a read the Lume runs itself; its list reaches the person from the tool result.
  assert.deepEqual(publishedCapabilitiesForRole('lawyer', 'agent').filter(name => capabilities[name].module === 'research'), ['k5_research_web_jurisprudence', ...names]);
  assert.deepEqual(publishedCapabilitiesForRole('lawyer', 'webmcp').filter(name => capabilities[name].module === 'research'), names);
  assert.ok(capabilitiesForRole('reviewer').filter(name => capabilities[name].module === 'research')
    .every(name => capabilities[name].effect === 'read'));
  const tools = agentTools((await actor()));
  assert.ok(tools.k5_research_search_corpus);
  assert.ok(!tools.k5_research_start_search);
  assert.ok(!tools.k5_research_add_reference);
  assert.ok(publishedCapabilitiesForRole('reviewer', 'agent').includes('k5_research_web_jurisprudence'));
});

test('invocação de agente não burla publicação e revisor não inicia pesquisa', async () => {
  const lawyer = (await actor());
  await assert.rejects(
    runCapability({ ...lawyer, invocation: 'agent' }, 'k5_research_start_search', { theme: 'guarda da avó', includeSources: false }),
    { code: 'FORBIDDEN' },
  );
  await assert.rejects(
    runCapability({ ...lawyer, invocation: 'webmcp' }, 'k5_research_assess_material', { caseId: randomUUID(), materialVersionId: randomUUID() }),
    { code: 'FORBIDDEN' },
  );
  const reviewer = (await actor('reviewer'));
  await assert.rejects(
    runCapability(reviewer, 'k5_research_start_search', { theme: 'guarda da avó', includeSources: false }),
    { code: 'FORBIDDEN' },
  );
});

test('pesquisa fica no autor e chave idempotente não aceita outro tema', async () => {
  const a = (await actor());
  const colleague = (await actor('lawyer', a.officeId));
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
  const a = (await actor('reviewer'));
  const colleague = (await actor('lawyer', a.officeId));
  const sent: Array<Record<string, unknown>> = [];
  const originalKey = process.env.EXA_API_KEY;
  process.env.EXA_API_KEY = 'exa-test';
  t.after(() => { if (originalKey === undefined) delete process.env.EXA_API_KEY; else process.env.EXA_API_KEY = originalKey; });
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
