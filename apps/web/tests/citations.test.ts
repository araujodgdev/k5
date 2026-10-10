import { fixtureSession } from './session-fixture';
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
import { recordedWebSources } from '../src/lib/citations/web-step';
import { runCapability } from '../src/lib/agent-tools';
import { createUploadRef } from '../src/lib/application/uploads-service';
import { createVaultDocument, processDocument } from '../src/lib/vault';
import { personPolicy } from '../src/lib/content-policy';

const text = [
  'Dos fatos. O réu, no processo 1234567-89.2024.8.26.0100, não pagou.',
  '',
  'Requer a citação, nos termos do art. 319, IV, do CPC. A mora gera juros desde o evento danoso (Súmula 54 do STJ).',
  '',
  'O STJ decidiu no REsp 1.234.567/SP que o dano é presumido. Aplica-se a Lei 8.078/1990.',
].join('\n');

test('web sources saved at the end of a search step are available to the next document tool', async () => {
  const userId = randomUUID(), officeId = randomUUID();
  await testDb.prepare('INSERT INTO user(id,email,name) VALUES(?,?,?)').run(userId, `${userId}@example.test`, 'Revisora');
  await testDb.prepare('INSERT INTO office(id,name) VALUES(?,?)').run(officeId, 'Fontes');
  await testDb.prepare('INSERT INTO office_member(id,office_id,user_id) VALUES(?,?,?)').run(randomUUID(), officeId, userId);
  const owner = { officeId, userId, sessionId: await fixtureSession(userId) };
  const chat = await createConversation(testDb, owner);
  await recordSources(owner, chat.id, recordedWebSources({ toolResults: [{ toolName: 'web_search', result: { results: [
    { url: 'https://example.test/cc', title: 'Código Civil', text: 'Art. 113 do Código Civil. Os negócios jurídicos devem ser interpretados conforme a boa-fé.' },
  ] } }] }));
  const created = await runCapability({ ...owner, invocation: 'agent', conversationId: chat.id }, 'k5_artifacts_create', {
    title: 'Fundamento pesquisado', content: 'Aplica-se o art. 113 do Código Civil.',
  });
  assert.ok(created && typeof created === 'object' && 'citations' in created);
  assert.equal((created.citations as { noSource: number }).noSource, 0);
});

test('citations: a source matches on the main number and the named code or court', () => {
  const sources: CitationSource[] = [
    { id: 'a', kind: 'web_jurisprudence', title: 'REsp 1.234.567/SP', court: 'STJ', caseNumber: '1.234.567', text: 'Dano moral presumido.' },
    { id: 'b', kind: 'web', title: 'Código de Defesa do Consumidor', text: 'Lei nº 8.078, de 11 de setembro de 1990 (Lei 8.078/90).' },
    { id: 'c', kind: 'vault', title: 'Petição anterior', text: 'art. 319 do CPP' },
    { id: 'd', kind: 'vault', title: 'Manual', text: 'Petição inicial: art. 319 do CPC exige os requisitos.' },
  ];
  assert.deepEqual(candidateSources('REsp 1.234.567/SP', sources).map(s => s.id), ['a']);
  assert.deepEqual(candidateSources('Lei 8.078/1990', sources).map(s => s.id), ['b']);
  assert.deepEqual(candidateSources('art. 319, IV, do CPC', sources).map(s => s.id), ['d']);
  assert.deepEqual(candidateSources('Súmula 54 do STJ', sources), []);
});

test('citations: an article span runs through dotted numbers, abbreviations and enumerations up to its code', () => {
  const spans = (sample: string) => findCitationSpans(sample).map(span => span.text);
  assert.deepEqual(spans('Nos termos dos arts. 1.238 a 1.244 do Código Civil, a posse deve ser mansa.'), ['arts. 1.238 a 1.244 do Código Civil']);
  assert.deepEqual(spans('O art. 5º, inc. XXIII, da CF/88 trata da função social.'), ['art. 5º, inc. XXIII, da CF/88']);
  assert.deepEqual(spans('Conforme os arts. 1.238 e 1.242 do CC.'), ['arts. 1.238 e 1.242 do CC']);
  assert.deepEqual(spans('Os arts. 23 e 24 da Lei do Inquilinato regulam o tema.'), ['arts. 23 e 24']);
  assert.deepEqual(spans('Aplica-se o art. 5º da lei. A CF/88 não trata disso.'), ['art. 5º'], 'a sentence end is not crossed');
  assert.deepEqual(spans('Aplica-se o art. 5. A CF/88 não trata disso.'), ['art. 5'], 'a period right after the number ends the sentence');
});

const judgment = {
  id: 'j1', installationId: 'i1', sourceJudgmentId: 'src-1', tribunal: 'STJ', courtUnit: null, caseNumber: '1.234.567', title: 'REsp 1.234.567/SP',
  decisionDate: null, sourceUrl: 'https://stj.jus.br/resp', sourceStatus: 'active' as const, ementa: 'Usucapião extraordinária. Art. 1.238 do Código Civil.', ementaVersionId: 'v1',
  fullTextStatus: 'pending' as const, fullTextVersionId: null,
};

test('citations: research web searches and corpus judgments are sources with their text', () => {
  const search = { id: 's1', query: 'usucapião', mode: 'auto', createdAt: '2026-10-06T00:00:00.000Z', resultCount: 1, results: [
    { title: 'Código Civil', url: 'https://planalto.gov.br/cc', host: 'planalto.gov.br', publishedDate: null, excerpt: 'Art. 1.238. Aquele que, por quinze anos, possuir como seu um imóvel…' },
  ] };
  const web = sourcesFromTool('k5_research_web_search', { search });
  assert.deepEqual(web.map(source => [source.kind, source.ref, source.url, source.title, source.text]),
    [['web', 'https://planalto.gov.br/cc', 'https://planalto.gov.br/cc', 'Código Civil', search.results[0].excerpt]]);
  assert.deepEqual(sourcesFromTool('k5_research_get_web_search', { search }), web);
  const [corpus] = sourcesFromTool('k5_research_search_corpus', { results: [judgment], nextCursor: null, total: 1 });
  assert.deepEqual([corpus.kind, corpus.ref, corpus.url, corpus.title, corpus.court, corpus.caseNumber, corpus.text, corpus.policy?.origin],
    ['web_jurisprudence', 'j1', 'https://stj.jus.br/resp', 'REsp 1.234.567/SP', 'STJ', '1.234.567', judgment.ementa, 'generated']);
  const page = { id: 'p1', pageNumber: 1, status: 'completed', results: [{ ...judgment, resultId: 'r1', position: 1, origin: 'local' }], nextCursor: null, totalReported: 1,
    progress: { ready: 1, pending: 0, unavailable: 0, failed: 0, cancelled: 0 }, sourceError: null };
  const view = { id: 's2', theme: 'usucapião', filters: {}, status: 'completed', createdAt: '2026-10-06T00:00:00.000Z', pageCount: 1, includeSources: false, pages: [page] };
  assert.deepEqual(sourcesFromTool('k5_research_get_search', { search: view }).map(source => source.ref), ['j1']);
  const detail = { ...judgment, className: null, rapporteur: null, metadataRevision: 1, sourceUpdatedAt: null, collectedAt: '2026-10-06T00:00:00.000Z', materials: [
    { id: 'm1', judgmentId: 'j1', kind: 'full_text', status: 'ready', currentVersionId: 'v2', unavailableReason: null, chunks: [], version: {
      id: 'v2', materialId: 'm1', sha256: 'x', mimeType: 'text/plain', byteSize: 10, textContent: 'Inteiro teor: o prazo é de quinze anos.', originalAvailable: false,
      parserVersion: '1', sourceUrl: null, collectedAt: '2026-10-06T00:00:00.000Z', publishedAt: null } },
  ] };
  const [full] = sourcesFromTool('k5_research_get_judgment', { judgment: detail });
  assert.equal(full.text, `${judgment.ementa}\nInteiro teor: o prazo é de quinze anos.`);
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
  await testDb.prepare('INSERT INTO office_member(id,office_id,user_id) VALUES(?,?,?)').run(randomUUID(), officeId, userId);
  await testDb.prepare('INSERT INTO platform_admin(user_id) VALUES(?)').run(userId);
  return { officeId, userId, sessionId: await fixtureSession(userId) };
}

test('citations: Jev decides what is a citation and whether the consulted source backs it', async () => {
  const owner = await fixture();
  await saveConnection(owner.userId, connectionSettings.parse({ apiKey: `fake-${owner.officeId}`, enabled: true, documents: 'enabled', version: (await connectionView()).version }));
  const conversation = await createConversation(testDb, owner);
  const upload = await createUploadRef(owner, new File(['O art. 319 do CPC lista os requisitos da petição inicial.'], 'manual.txt', { type: 'text/plain' }));
  const document = await createVaultDocument(owner, upload, { scope: 'library', policy: personPolicy('', '') });
  await processDocument(document.id, owner.officeId);
  const consulted = await runCapability(owner, 'k5_knowledge_search', { query: 'requisitos petição inicial' });
  await recordSources(owner, conversation.id, [
    ...sourcesFromTool('k5_research_score_jurisprudence', { results: [{ title: 'REsp 1.234.567/SP', court: 'STJ', caseNumber: '1.234.567', url: 'https://stj.jus.br/resp', summary: 'Dano moral presumido em negativação indevida.', linkFound: true },
      { title: 'REsp inventado', court: 'STJ', caseNumber: '9.999.999', url: 'https://stj.jus.br/inventado', summary: 'Sem fonte.', linkFound: false }] }),
    ...sourcesFromTool('k5_knowledge_search', consulted),
  ]);
  const sources = await conversationSources(owner, conversation.id);
  assert.equal(sources.length, 2);

  const asked: string[] = [];
  const sentCitations: Array<{ text: string; paragraph: string }> = [];
  const send = async (_key: string, request: DecisionRequest) => {
    asked.push(...Object.keys(request.questions));
    const state = request.state as { citations: Array<{ text: string; paragraph: string }> };
    sentCitations.push(...state.citations);
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
    ['art. 319, IV, do CPC', 'statute', 'weak', sources.find(source => source.kind === 'vault')!.title],
    ['Súmula 54 do STJ', 'precedent', 'no_source', null],
    ['REsp 1.234.567/SP', 'precedent', 'verified', 'REsp 1.234.567/SP'],
    ['Lei 8.078/1990', 'statute', 'no_source', null],
  ]);
  assert.equal(asked.filter(name => name.startsWith('match_')).length, 2);

  await saveConnection(owner.userId, connectionSettings.parse({ enabled: true, documents: 'off', version: (await connectionView()).version }));
  const offline = await reviewCitations(owner, text, sources, { send });
  assert.equal(offline.status, 'disabled');
  assert.equal(offline.mentions, 0);
  assert.deepEqual(offline.items.map(item => item.status), ['no_source', 'unchecked', 'no_source', 'unchecked', 'no_source']);
});

test('citations: a corpus judgment the Lume read is a conversation source until its catalog is revoked', async () => {
  const owner = await fixture();
  const installationId = randomUUID(), judgmentId = randomUUID(), materialId = randomUUID(), versionId = randomUUID();
  const ementa = 'Usucapião extraordinária. Art. 1.238 do Código Civil. Posse por quinze anos.';
  await testDb.prepare(`INSERT INTO judicial_source_installation(id,kind,court_code,court_name,degree,system,purpose,auth_kind,discovery_status,permission_query,permission_cache,permission_documents,permission_redistribution,permission_ai,enabled)
    VALUES(?,'jurisprudence_api',?,'STJ','second','proprietary','jurisprudence','none','pilot','permitido','permitido','permitido','permitido','permitido',1)`).run(installationId, installationId.slice(0, 8));
  await testDb.prepare(`INSERT INTO research_judgment(id,installation_id,source_judgment_id,tribunal,case_number,title,source_url,metadata_hash,collected_at,status)
    VALUES(?,?,?,'STJ','1.234.567','REsp 1.234.567/SP','https://stj.jus.br/resp','fixture',CURRENT_TIMESTAMP,'active')`).run(judgmentId, installationId, randomUUID());
  await testDb.prepare("INSERT INTO research_material(id,judgment_id,kind,status,current_version_id) VALUES(?,?,'ementa','ready',?)").run(materialId, judgmentId, versionId);
  await testDb.prepare(`INSERT INTO research_material_version(id,material_id,sha256,mime_type,byte_size,text_content,parser_version,citation_metadata_json,metadata_revision,collected_at,published_at)
    VALUES(?,?,?,'text/plain',?,?,'fixture','{}'::jsonb,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).run(versionId, materialId, randomUUID().replaceAll('-', ''), ementa.length, ementa);
  const conversation = await createConversation(testDb, owner);
  await recordSources(owner, conversation.id, sourcesFromTool('k5_research_get_judgment', await runCapability(owner, 'k5_research_get_judgment', { judgmentId })));
  const [source] = await conversationSources(owner, conversation.id);
  assert.deepEqual([source.kind, source.title, source.court, source.caseNumber, source.url, source.text],
    ['web_jurisprudence', 'REsp 1.234.567/SP', 'STJ', '1.234.567', 'https://stj.jus.br/resp', ementa]);
  await testDb.prepare("UPDATE judicial_source_installation SET permission_ai='proibido' WHERE id=?").run(installationId);
  assert.deepEqual(await conversationSources(owner, conversation.id), []);
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
