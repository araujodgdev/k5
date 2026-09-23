import { testDb } from './test-setup';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { saveConnection, connectionView } from '../src/lib/typesafe/config';
import { connectionSettings } from '../src/lib/typesafe/contracts';
import type { DecisionRequest, DecisionTransport } from '../src/lib/typesafe/client';
import { groundCandidates, parseCandidates, searchWebJurisprudence, relevanceLabel } from '../src/lib/research/web-jurisprudence';
import { publishedCapabilitiesForRole } from '../src/lib/capabilities/contracts';

async function office() {
  const officeId = randomUUID(); const userId = randomUUID();
  await testDb.prepare('INSERT INTO user(id,email,name) VALUES(?,?,?)').run(userId, `${userId}@example.test`, 'Advogada');
  await testDb.prepare('INSERT INTO office(id,name) VALUES(?,?)').run(officeId, 'Escritório');
  await testDb.prepare('INSERT INTO office_member(id,office_id,user_id,role) VALUES(?,?,?,?)').run(randomUUID(), officeId, userId, 'lawyer');
  await testDb.prepare('INSERT INTO platform_admin(user_id) VALUES(?)').run(userId); // configures the platform TypeSafe connection
  return { officeId, userId };
}

const candidates = [
  { title: 'REsp 1.234.567/SP — revisão da vida toda', court: 'STJ', caseNumber: '1.234.567', date: '2024-03-01', url: 'https://www.stj.jus.br/sites/portalp/Paginas/decisao-1?utm_source=x', summary: 'Aposentadoria e revisão da vida toda.' },
  { title: 'Notícia sobre revisão', court: '', caseNumber: null, date: null, url: 'https://blog.example.com/revisao', summary: 'Opinião.' },
  { title: 'Julgado inventado', court: 'TRF3', caseNumber: null, date: null, url: 'https://trf3.jus.br/nao-existe', summary: 'Sem fonte.' },
  { title: 'Tema 1102 — STF', court: 'STF', caseNumber: 'RE 1.276.977', date: null, url: 'https://portal.stf.jus.br/tema/1102', summary: 'Tese sobre revisão.' },
];
const modelText = `Encontrei estes:\n${JSON.stringify(candidates)}\nFim.`;
const sources = ['https://stj.jus.br/sites/portalp/Paginas/decisao-1', 'https://blog.example.com/revisao', 'https://portal.stf.jus.br/tema/1102/'];

/** Jev: the STJ ruling is on point, the blog is not a decision, the STF theme is related. */
const jev: DecisionTransport = async (_key, request: DecisionRequest) => ({
  model: request.model, usage: { input_tokens: 100, output_tokens: 0 },
  answers: Object.fromEntries(Object.entries(request.questions).map(([name, question]) => {
    const index = Number(name.split('_').at(-1));
    if (question.type === 'noul') return [name, { type: 'noul', noul: index === 1 ? 0.1 : 0.95 }];
    const score = [4, 3, 2.6][index] ?? 0;
    const levels = question.type === 'score' ? question.criteria.length : 5;
    return [name, { type: 'score', score, confidence: 0.9, probabilities: Object.fromEntries(Array.from({ length: levels }, (_, i) => [String(i), Number(i === Math.round(score))])) }];
  })),
});

test('web jurisprudence: malformed output is dropped and only links the search returned survive', () => {
  assert.deepEqual(parseCandidates('sem json'), []);
  assert.equal(parseCandidates(modelText).length, 4);
  const grounded = groundCandidates(parseCandidates(modelText), sources);
  assert.deepEqual(grounded.map(item => item.court), ['STJ', '', 'STF'], 'the invented TRF3 link never came back from the search');
  assert.deepEqual(groundCandidates([...candidates, { ...candidates[0], title: 'Duplicado' }], sources).filter(item => item.court === 'STJ').length, 1);
  assert.deepEqual(groundCandidates([{ ...candidates[0], url: 'javascript:alert(1)' }], ['javascript:alert(1)']), []);
});

test('web jurisprudence: Jev keeps related court decisions, ordered by relevance', async () => {
  const context = await office();
  await saveConnection(context.userId, connectionSettings.parse({ apiKey: `fake-${context.officeId}`, enabled: true, research: 'enabled', version: (await connectionView()).version }));
  const result = await searchWebJurisprudence(context, { query: 'revisão da vida toda no INSS' },
    { search: async () => ({ text: modelText, sources }), send: jev });
  assert.equal(result.evaluated, true);
  assert.deepEqual(result.results.map(item => [item.court, item.relevanceLabel]), [['STJ', 'Muito relevante'], ['STF', 'Relevante']]);
  assert.equal(result.discarded, 1, 'the blog post is not a decision');
  assert.equal(relevanceLabel(2.1), 'Relação parcial');
});

test('web jurisprudence: without Jev the grounded list still comes back, marked as not evaluated', async () => {
  const context = await office();
  await saveConnection(context.userId, connectionSettings.parse({ apiKey: `fake-${context.officeId}`, enabled: true, research: 'off', version: (await connectionView()).version }));
  const result = await searchWebJurisprudence(context, { query: 'revisão da vida toda no INSS' }, { search: async () => ({ text: modelText, sources: [] }) });
  assert.deepEqual(result.results, []);
  assert.match(result.note, /Nenhum julgado com link verificável/);
  const unscored = await searchWebJurisprudence(context, { query: 'revisão da vida toda no INSS' }, { search: async () => ({ text: modelText, sources }) });
  assert.equal(unscored.evaluated, false);
  assert.equal(unscored.results.length, 3);
  assert.ok(unscored.results.every(item => item.relevance === null));
});

test('web jurisprudence: only the Lume gets the tool', () => {
  assert.ok(publishedCapabilitiesForRole('reviewer', 'agent').includes('k5_research_web_jurisprudence'));
  assert.ok(!publishedCapabilitiesForRole('lawyer', 'webmcp').includes('k5_research_web_jurisprudence'));
});
