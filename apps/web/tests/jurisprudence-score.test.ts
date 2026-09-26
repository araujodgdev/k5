import { testDb } from './test-setup';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { saveConnection, connectionView } from '../src/lib/typesafe/config';
import { connectionSettings } from '../src/lib/typesafe/contracts';
import type { DecisionRequest, DecisionTransport } from '../src/lib/typesafe/client';
import { comparableUrl, scoreJurisprudence, webSearchLinks } from '../src/lib/research/jurisprudence-score';
import { recordSources } from '../src/lib/citations/sources';
import { createConversation } from '../src/lib/ai-store';

async function office(research: 'enabled' | 'off') {
  const officeId = randomUUID(); const userId = randomUUID();
  await testDb.prepare('INSERT INTO user(id,email,name) VALUES(?,?,?)').run(userId, `${userId}@example.test`, 'Advogada');
  await testDb.prepare('INSERT INTO office(id,name) VALUES(?,?)').run(officeId, 'Escritório');
  await testDb.prepare('INSERT INTO office_member(id,office_id,user_id,role) VALUES(?,?,?,?)').run(randomUUID(), officeId, userId, 'lawyer');
  await testDb.prepare('INSERT INTO platform_admin(user_id) VALUES(?)').run(userId); // configures the platform TypeSafe connection
  await saveConnection(userId, connectionSettings.parse({ apiKey: `fake-${officeId}`, enabled: true, research, version: (await connectionView()).version }));
  return { officeId, userId };
}

const decisions = [
  { title: 'Tema 1102 — STF', court: 'STF', caseNumber: 'RE 1.276.977', url: 'https://portal.stf.jus.br/tema/1102/', summary: 'Tese sobre revisão.' },
  { title: 'Notícia sobre revisão', url: 'https://blog.example.com/revisao', summary: 'Opinião.' },
  { title: 'REsp 1.234.567/SP — revisão da vida toda', court: 'STJ', caseNumber: '1.234.567', date: '2024-03-01', url: 'https://www.stj.jus.br/decisao-1?utm_source=x', summary: 'Aposentadoria e revisão da vida toda.' },
  { title: 'Julgado de memória', court: 'TRF3', url: 'https://trf3.jus.br/nao-existe', summary: 'Sem fonte.' },
];
const question = 'Cabe a revisão da vida toda para aposentadoria concedida em 2015?';

/** Jev: the STF theme and the STJ ruling fit the case, the blog is not a decision. */
const jev: DecisionTransport = async (_key, request: DecisionRequest) => ({
  model: request.model, usage: { input_tokens: 100, output_tokens: 0 },
  answers: Object.fromEntries(Object.entries(request.questions).map(([name, question]) => {
    const index = Number(name.split('_').at(-1));
    if (question.type === 'noul') return [name, { type: 'noul', noul: index === 1 ? 0.1 : 0.95 }];
    const score = [2.8, 1, 3.8, 3.9][index] ?? 0;
    const levels = question.type === 'score' ? question.criteria.length : 5;
    return [name, { type: 'score', score, confidence: 0.9, probabilities: Object.fromEntries(Array.from({ length: levels }, (_, i) => [String(i), Number(i === Math.round(score))])) }];
  })),
});

test('jurisprudence score: only web search results count as found links', () => {
  const links = webSearchLinks({
    toolResults: [
      // The provider's own search (OpenAI) and the Exa fallback, both named web_search.
      { type: 'tool-result', payload: { toolName: 'web_search', result: { action: { query: 'revisão' }, sources: [{ type: 'url', url: 'https://portal.stf.jus.br/tema/1102' }] } } },
      { toolName: 'web_search', result: { results: [{ url: 'https://stj.jus.br/decisao-1', title: 'REsp' }] } },
      // A tool that echoes what the model wrote never vouches for a link.
      { toolName: 'k5_research_score_jurisprudence', result: { results: [{ url: 'https://trf3.jus.br/nao-existe' }] } },
    ],
    sources: [{ type: 'source', payload: { url: 'https://blog.example.com/revisao' } }],
  });
  assert.deepEqual(links.sort(), ['https://blog.example.com/revisao', 'https://portal.stf.jus.br/tema/1102', 'https://stj.jus.br/decisao-1']);
  assert.equal(comparableUrl('https://www.STJ.jus.br/decisao-1/?utm_source=x#topo'), 'stj.jus.br/decisao-1');
  assert.equal(comparableUrl('javascript:alert(1)'), '');
});

test('jurisprudence score: Jev grades the fit to the case and nothing is dropped', async () => {
  const context = await office('enabled');
  let state: { question?: string; caseFacts?: string; decisions?: Array<{ host: string }> } = {};
  const result = await scoreJurisprudence(
    { ...context, consultedLinks: new Set(['https://portal.stf.jus.br/tema/1102', 'https://blog.example.com/revisao', 'https://stj.jus.br/decisao-1']) },
    { question, caseFacts: 'Aposentadoria por tempo de contribuição concedida em 2015.', decisions },
    { send: async (key, request, signal) => { state = request.state as typeof state; return jev(key, request, signal); } },
  );
  assert.equal(result.evaluated, true);
  assert.equal(state.caseFacts, 'Aposentadoria por tempo de contribuição concedida em 2015.');
  assert.deepEqual(state.decisions?.map(item => item.host), ['portal.stf.jus.br', 'blog.example.com', 'www.stj.jus.br', 'trf3.jus.br']);
  assert.deepEqual(result.results.map(item => [item.court, item.reliability, item.score, item.linkFound]), [
    ['STJ', 'alta', 3.8, true],
    ['STF', 'média', 2.8, true],
    // Jev rated the invented TRF3 ruling highly; its link never came from a search, so it stays low.
    ['TRF3', 'baixa', 3.9, false],
    ['', 'baixa', 1, true],
  ]);
  assert.match(result.results[2].reason, /não veio de uma busca/);
  assert.match(result.results[3].reason, /não parece ser uma decisão/);
});

test('jurisprudence score: without Jev the links are still checked, earlier searches included', async () => {
  const context = await office('off');
  const conversation = await createConversation(testDb, context);
  await recordSources(context, conversation.id, [{ kind: 'web', ref: 'https://portal.stf.jus.br/tema/1102', url: 'https://portal.stf.jus.br/tema/1102', title: 'Tema 1102', text: 'Tema 1102' }]);
  let asked = 0;
  const result = await scoreJurisprudence({ ...context, conversationId: conversation.id }, { question, decisions: decisions.slice(0, 1).concat(decisions[3]) },
    { send: async (key, request, signal) => { asked++; return jev(key, request, signal); } });
  assert.equal(asked, 0);
  assert.equal(result.evaluated, false);
  assert.deepEqual(result.results.map(item => [item.court, item.reliability, item.score]), [['STF', 'não avaliada', null], ['TRF3', 'baixa', null]]);
  assert.match(result.note, /Jev não avaliou/);
});
