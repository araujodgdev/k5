import { testDb } from './test-setup';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { candidateSources, findCitationSpans, type CitationSource } from '../src/lib/citations/detect';
import { composeCitation } from '../src/lib/citations/verdict';
import { reviewCitations } from '../src/lib/citations/review';
import { conversationSources, recordSources, sourcesFromTool } from '../src/lib/citations/sources';
import { saveConnection, connectionView } from '../src/lib/typesafe/config';
import { connectionSettings } from '../src/lib/typesafe/contracts';
import type { DecisionRequest } from '../src/lib/typesafe/client';
import { createConversation } from '../src/lib/ai-store';

const text = [
  'Dos fatos. O réu, no processo 1234567-89.2024.8.26.0100, não pagou.',
  '',
  'Requer a citação, nos termos do art. 319, IV, do CPC. A mora gera juros desde o evento danoso (Súmula 54 do STJ).',
  '',
  'O STJ decidiu no REsp 1.234.567/SP que o dano é presumido. Aplica-se a Lei 8.078/1990.',
].join('\n');

test('citations: a source matches on the main number and the named code or court', () => {
  const sources: CitationSource[] = [
    { id: 'a', kind: 'web_jurisprudence', title: 'REsp 1.234.567/SP', court: 'STJ', caseNumber: '1.234.567', text: 'Dano moral presumido.' },
    { id: 'b', kind: 'web', title: 'Código de Defesa do Consumidor', text: 'Lei nº 8.078, de 11 de setembro de 1990 (Lei 8.078/90).' },
    { id: 'c', kind: 'vault', title: 'Petição anterior', text: 'art. 319 do CPP' },
    { id: 'd', kind: 'vault', title: 'Manual', text: 'Petição inicial: art. 319 do CPC exige os requisitos.' },
  ];
  assert.deepEqual(candidateSources('REsp 1.234.567/SP', sources).map(s => s.id), ['a']);
  assert.deepEqual(candidateSources('Lei 8.078/1990', sources).map(s => s.id), ['b']);
  // Same article number in another code is not the same authority.
  assert.deepEqual(candidateSources('art. 319, IV, do CPC', sources).map(s => s.id), ['d']);
  assert.deepEqual(candidateSources('Súmula 54 do STJ', sources), []);
});

const choice = (value: string, confidence: number) => ({ type: 'choice' as const, choice: value, confidence, probabilities: { [value]: confidence } });
const noul = (value: number) => ({ type: 'noul' as const, noul: value });

test('citations: verdicts follow the thresholds; a confident mention is dropped', () => {
  const [span] = findCitationSpans('Conforme o REsp 1.234.567, o dano é presumido.');
  const source: CitationSource = { id: 'a', kind: 'web_jurisprudence', title: 'REsp 1.234.567', url: 'https://stj.jus.br/x', text: '...' };
  const judged = (support: ReturnType<typeof choice>, match = 0.9) => composeCitation(span, [source], { kind: choice('precedent', 0.9), candidates: [{ match: noul(match), support }] });
  assert.equal(composeCitation(span, [], undefined)?.status, 'no_source');
  assert.equal(composeCitation(span, [source], undefined)?.status, 'unchecked');
  assert.equal(composeCitation(span, [source], { kind: choice('mention', 0.9), candidates: [] }), null);
  assert.equal(composeCitation(span, [source], { kind: choice('mention', 0.4), candidates: [{ match: noul(0.9), support: choice('supports', 0.95) }] })?.status, 'verified');
  assert.deepEqual({ status: judged(choice('supports', 0.95))?.status, url: judged(choice('supports', 0.95))?.source?.url }, { status: 'verified', url: 'https://stj.jus.br/x' });
  assert.equal(judged(choice('supports', 0.7))?.status, 'weak');
  assert.equal(judged(choice('partial', 0.9))?.status, 'weak');
  assert.equal(judged(choice('contradicts', 0.9))?.status, 'contradicted');
  assert.equal(judged(choice('supports', 0.95), 0.2)?.status, 'no_source');
});

async function fixture() {
  const officeId = randomUUID(), userId = randomUUID();
  await testDb.prepare('INSERT INTO office(id,name) VALUES(?,?)').run(officeId, 'Escritório');
  await testDb.prepare('INSERT INTO user(id,email,name) VALUES(?,?,?)').run(userId, `${userId}@test.local`, 'Advogada');
  await testDb.prepare('INSERT INTO office_member(id,office_id,user_id,role) VALUES(?,?,?,?)').run(randomUUID(), officeId, userId, 'lawyer');
  await testDb.prepare('INSERT INTO platform_admin(user_id) VALUES(?)').run(userId);
  return { officeId, userId };
}

test('citations: Jev decides what is a citation and whether the consulted source backs it', async () => {
  const owner = await fixture();
  await saveConnection(owner.userId, connectionSettings.parse({ apiKey: `fake-${owner.officeId}`, enabled: true, documents: 'enabled', version: (await connectionView()).version }));
  const conversation = await createConversation(testDb, owner);
  // The Lume searched case law and read one excerpt of the Cofre during the conversation.
  await recordSources(owner, conversation.id, [
    ...sourcesFromTool('k5_research_web_jurisprudence', { results: [{ title: 'REsp 1.234.567/SP', court: 'STJ', caseNumber: '1.234.567', url: 'https://stj.jus.br/resp', summary: 'Dano moral presumido em negativação indevida.' }] }),
    ...sourcesFromTool('k5_knowledge_search', { sources: [{ sourceId: 'chunk-1', sourceLabel: 'manual.pdf — página 3', text: 'O art. 319 do CPC lista os requisitos da petição inicial.' }] }),
  ]);
  const sources = await conversationSources(owner, conversation.id);
  assert.equal(sources.length, 2);

  const asked: string[] = [];
  const sentCitations: Array<{ text: string; paragraph: string }> = [];
  const send = async (_key: string, request: DecisionRequest) => {
    asked.push(...Object.keys(request.questions));
    const state = request.state as { citations: Array<{ text: string; paragraph: string }> };
    sentCitations.push(...state.citations);
    // A well-formed choice spreads its probability over every criterion, as the service does.
    const pick = (name: string, value: string, confidence: number) => {
      const keys = Object.keys((request.questions[name] as { criteria: Record<string, string> }).criteria);
      const rest = (1 - confidence) / (keys.length - 1);
      return { type: 'choice' as const, choice: value, confidence, probabilities: Object.fromEntries(keys.map(key => [key, key === value ? confidence : rest])) };
    };
    const answers = Object.fromEntries(Object.keys(request.questions).map(name => {
      const [kind, index] = name.split('_');
      const citation = state.citations[Number(index)].text;
      if (kind === 'kind') return [name, citation.includes('-89.2024') ? pick(name, 'mention', 0.95) : pick(name, citation.startsWith('REsp') || citation.startsWith('Súmula') ? 'precedent' : 'statute', 0.9)];
      if (kind === 'match') return [name, noul(0.92)];
      // The case law source backs the paragraph; the manual only lists requirements, so it backs it in part.
      return [name, citation.startsWith('REsp') ? pick(name, 'supports', 0.93) : pick(name, 'partial', 0.8)];
    }));
    return { model: request.model, usage: { input_tokens: 10, output_tokens: 0 }, answers };
  };
  const review = await reviewCitations(owner, text, sources, { send });
  assert.equal(review.status, 'evaluated');
  assert.deepEqual(sentCitations.map(citation => citation.text), [
    '1234567-89.2024.8.26.0100', 'art. 319, IV, do CPC', 'Súmula 54 do STJ', 'REsp 1.234.567/SP', 'Lei 8.078/1990',
  ]);
  assert.match(sentCitations.find(citation => citation.text === 'art. 319, IV, do CPC')!.paragraph, /^Requer a citação/);
  assert.equal(review.mentions, 1, 'the client case number is not a citation');
  assert.deepEqual(review.items.map(item => [item.text, item.kind, item.status, item.source?.title ?? null]), [
    ['art. 319, IV, do CPC', 'statute', 'weak', 'manual.pdf — página 3'],
    ['Súmula 54 do STJ', 'precedent', 'no_source', null],
    ['REsp 1.234.567/SP', 'precedent', 'verified', 'REsp 1.234.567/SP'],
    ['Lei 8.078/1990', 'statute', 'no_source', null],
  ]);
  // Only citations with a candidate source ask whether that source is the one cited.
  assert.equal(asked.filter(name => name.startsWith('match_')).length, 2);

  // Without Jev, nothing is judged: spans with a matching source become "unchecked", the rest
  // "no_source", and nothing can be ruled out as a mere mention (the client's case number stays).
  await saveConnection(owner.userId, connectionSettings.parse({ enabled: true, documents: 'off', version: (await connectionView()).version }));
  const offline = await reviewCitations(owner, text, sources, { send });
  assert.equal(offline.status, 'disabled');
  assert.equal(offline.mentions, 0);
  assert.deepEqual(offline.items.map(item => item.status), ['no_source', 'unchecked', 'no_source', 'unchecked', 'no_source']);
});

test('citations: sources belong to their conversation and owner', async () => {
  const a = await fixture();
  const b = await fixture();
  const conversation = await createConversation(testDb, a);
  await recordSources(b, conversation.id, [{ kind: 'web', ref: 'https://x.test', url: 'https://x.test', title: 'x', text: 'x' }]);
  assert.deepEqual(await conversationSources(a, conversation.id), []);
  assert.deepEqual(await conversationSources(b, conversation.id), []);
  await recordSources(a, conversation.id, [{ kind: 'web', ref: 'https://x.test', url: 'https://x.test', title: 'x', text: 'x' }, { kind: 'web', ref: 'https://x.test', url: 'https://x.test', title: 'x', text: 'mais texto' }]);
  const [only] = await conversationSources(a, conversation.id);
  assert.equal(only.text, 'mais texto');
});
