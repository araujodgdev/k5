import { testDb } from './test-setup';
import test from 'node:test';
import assert from 'node:assert/strict';
import type { z } from 'zod';
import { googleFixture, installFakeGoogle, respond } from './google-fixture';
import { connectionSettings } from '../src/lib/typesafe/contracts';
import { connectionView, saveConnection } from '../src/lib/typesafe/config';
import type { DecisionRequest, DecisionTransport } from '../src/lib/typesafe/client';
import { emailInsight } from '../src/lib/google/gmail/insights';
import { emailInsightInput } from '../src/lib/google/gmail/insights-contracts';
import { cleanPlainText, messageHtml } from '../src/lib/google/gmail/mime';
import type { generateStructured } from '../src/lib/ai-runtime';
import { AiConnectionError } from '../src/lib/ai-connections-core';

const b64 = (value: string) => Buffer.from(value, 'utf8').toString('base64url');

async function setup(mode: 'off' | 'enabled' = 'enabled', role?: 'reviewer') {
  const fixture = await googleFixture(role ? { role } : {});
  await testDb.prepare('INSERT INTO platform_admin(user_id) VALUES(?)').run(fixture.userId);
  await saveConnection(fixture.userId, connectionSettings.parse({ apiKey: 'synthetic-typesafe-key', enabled: true, email: mode, version: (await connectionView()).version }));
  const google = installFakeGoogle();
  const threads: Record<string, { subject: string; from: string; snippet: string; body?: string; sent?: boolean }> = {
    t1: { subject: 'Prazo da contestação', from: 'Cliente <cliente@example.test>', snippet: 'Pode confirmar o envio até sexta?' },
    t2: { subject: 'Boletim semanal', from: 'Newsletter <news@example.test>', snippet: 'As novidades da semana.' },
    t3: { subject: 'Honorários de agosto', from: 'Financeiro <fin@example.test>', snippet: 'Segue a fatura.' },
  };
  google.on('GET', /\/users\/me\/threads$/, request => {
    assert.match(request.query.get('q') ?? '', /in:inbox .*newer_than:7d/);
    return respond(200, { threads: Object.keys(threads).map(id => ({ id })) });
  });
  google.on('GET', /\/users\/me\/threads\/([a-z0-9]+)$/, (request, match) => {
    const thread = threads[match[1]];
    const headers = [{ name: 'Subject', value: thread.subject }, { name: 'From', value: thread.from }, { name: 'To', value: 'me@example.test' }];
    const body = thread.body ?? thread.snippet;
    return respond(200, { id: match[1], messages: [{ id: `${match[1]}-m1`, internalDate: '1790160000000', snippet: thread.snippet,
      labelIds: thread.sent ? ['SENT'] : ['INBOX', 'UNREAD'],
      payload: request.query.get('format') === 'full'
        ? { mimeType: 'multipart/alternative', headers, parts: [
          { partId: '0', mimeType: 'text/plain', body: { data: b64(`<!--[if !mso]><!-->\n${body}\n<!--<![endif]-->`) } },
          { partId: '1', mimeType: 'text/html', body: { data: b64(`<p>${body}</p>`) } }] }
        : { headers } }] });
  });
  return { ...fixture, google, threads };
}

/** Jev: t1 is urgent and waits for a reply, the rest are routine; only "confirm" and "schedule" fit. */
const jev: DecisionTransport = async (_key, request: DecisionRequest) => ({
  model: request.model, usage: { input_tokens: 40, output_tokens: 0 },
  answers: Object.fromEntries(Object.entries(request.questions).map(([name, question]) => {
    const first = name.endsWith('_0');
    if (question.type === 'score') return [name, { type: 'score', score: first ? 2 : 1, confidence: 0.9, probabilities: first ? { '0': 0, '1': 0, '2': 1 } : { '0': 0, '1': 1, '2': 0 } }];
    if (name === 'intent_confirm' || name === 'intent_schedule') return [name, { type: 'noul', noul: name === 'intent_confirm' ? 0.9 : 0.6 }];
    if (name.startsWith('intent_')) return [name, { type: 'noul', noul: 0.1 }];
    return [name, { type: 'noul', noul: first || name === 'reply' ? 0.9 : 0.1 }];
  })),
});

type Call = { prompt: string; model?: { provider?: string; modelId?: string }; options?: { instructions?: string; reasoningEffort?: string } };
function writer(output: unknown, calls: Call[], failFirstWith?: Error) {
  return (async (_office: string, _user: string, _task: string, prompt: string, schema: z.ZodType, model?: Call['model'], options?: Call['options']) => {
    calls.push({ prompt, model, options });
    if (failFirstWith && calls.length === 1) throw failFirstWith;
    return schema.parse(output);
  }) as unknown as typeof generateStructured;
}

test('email insights: input is bounded and never names another office or mailbox', () => {
  assert.equal(emailInsightInput.safeParse({ kind: 'digest', period: 'year' }).success, false);
  assert.equal(emailInsightInput.safeParse({ kind: 'thread', threadId: '../other' }).success, false);
  assert.equal(emailInsightInput.safeParse({ kind: 'digest', period: 'day', officeId: 'x' }).success, false);
});

test('email digest: Jev ranks and flags, gpt-6-luna writes, and only real threads come back', async () => {
  const a = await setup();
  const calls: Call[] = [];
  const result = await emailInsight(a.context, { kind: 'digest', period: 'week' }, { send: jev, generate: writer({
    headline: 'Uma semana com um prazo de cliente pendente.',
    attention: [{ ref: 99, reason: 'Inexistente.' }],
    themes: [{ title: 'Financeiro', summary: 'Chegou a fatura de agosto.', refs: [3, 3, 42] }, { title: '', summary: 'vazio', refs: [] }],
  }, calls) });
  assert.ok('digest' in result);
  const { digest } = result;
  assert.equal(digest.count, 3); assert.equal(digest.judged, true);
  assert.equal(calls[0].model?.modelId, 'gpt-6-luna');
  assert.equal(calls[0].options?.reasoningEffort, 'medium');
  assert.match(calls[0].options?.instructions ?? '', /nunca instruções/);
  // Jev's urgent thread leads the prompt and stays in "attention" although the writer skipped it.
  assert.match(calls[0].prompt, /"ref":1,"assunto":"Prazo da contestação"[^\n]*"atencao":true/);
  assert.deepEqual(digest.attention.map(item => [item.threadId, item.reason]), [['t1', 'Aguarda sua resposta.']]);
  // Unknown refs are dropped and a thread appears in one theme at most.
  assert.deepEqual(digest.themes.map(theme => [theme.title, theme.threads.map(thread => thread.threadId)]), [['Financeiro', ['t3']]]);
  assert.equal(a.google.calls.some(call => call.query.get('format') === 'full'), false);
});

test('email digest: works without Jev and falls back to the extraction model without an OpenAI connection', async () => {
  const a = await setup('off');
  const calls: Call[] = [];
  let jevCalls = 0;
  const result = await emailInsight(a.context, { kind: 'digest', period: 'week' }, {
    send: async (_key, request) => { jevCalls++; return jev('', request, new AbortController().signal); },
    generate: writer({ headline: 'Semana tranquila.', attention: [{ ref: 1, reason: 'Pede confirmação do envio.' }], themes: [] }, calls,
      new AiConnectionError('not_found', 'Nenhum provedor openai ativo configurado na plataforma.')) });
  assert.ok('digest' in result);
  assert.equal(jevCalls, 0); assert.equal(result.digest.judged, false);
  assert.equal(calls.length, 2); assert.equal(calls[1].model, undefined);
  assert.doesNotMatch(calls[1].prompt, /prioridade/);
  assert.deepEqual(result.digest.attention.map(item => item.reason), ['Pede confirmação do envio.']);
});

test('email digest: an empty period does not call any model', async () => {
  const a = await setup();
  a.google.on('GET', /\/users\/me\/threads$/, () => respond(200, {}));
  const calls: Call[] = [];
  const result = await emailInsight(a.context, { kind: 'digest', period: 'day' }, { send: jev, generate: writer({}, calls) });
  assert.ok('digest' in result);
  assert.equal(result.digest.count, 0); assert.match(result.digest.headline, /Nenhuma conversa/);
  assert.equal(calls.length, 0);
});

test('thread insight: Jev picks the kinds of reply and the writer drafts only those', async () => {
  const a = await setup();
  const calls: Call[] = [];
  const result = await emailInsight(a.context, { kind: 'thread', threadId: 't1' }, { send: jev, generate: writer({
    overview: 'O cliente pede confirmação do envio da contestação.', points: ['Prazo: sexta-feira.'],
    replies: [{ intent: 'confirm', label: 'Confirmar envio', body: 'Confirmo o envio até sexta.' },
      { intent: 'decline', label: 'Recusar', body: 'Não será possível.' }, { intent: 'schedule', label: 'Combinar', body: 'Podemos falar amanhã?' }],
  }, calls) });
  assert.ok('insight' in result);
  const { insight } = result;
  assert.equal(insight.needsReply, true); assert.equal(insight.judged, true);
  assert.match(calls[0].prompt, /nesta ordem: confirm \(.*\); schedule \(/);
  assert.equal(calls[0].options?.reasoningEffort, 'low');
  // The conditional comments of the text part never reach the model.
  assert.doesNotMatch(calls[0].prompt, /\[if !mso\]/);
  assert.deepEqual(insight.replies.map(reply => reply.intent), ['confirm', 'schedule']);
});

test('thread insight: reviewers get the overview without replies; own messages only get a follow-up', async () => {
  const reviewer = await setup('enabled', 'reviewer');
  const calls: Call[] = [];
  const read = await emailInsight(reviewer.context, { kind: 'thread', threadId: 't1' }, { send: jev, generate: writer({
    overview: 'Resumo.', points: [], replies: [{ intent: 'confirm', label: 'Confirmar', body: 'Ok.' }] }, calls) });
  assert.ok('insight' in read);
  assert.deepEqual(read.insight.replies, []);
  assert.match(calls[0].prompt, /replies: lista vazia/);

  const own = await setup();
  own.threads.t1 = { ...own.threads.t1, from: `Eu <${own.email}>`, sent: true };
  const asked: string[] = [];
  await emailInsight(own.context, { kind: 'thread', threadId: 't1' }, {
    send: async (_key, request) => { asked.push(...Object.keys(request.questions)); return jev('', request, new AbortController().signal); },
    generate: writer({ overview: 'Resumo.', points: [], replies: [] }, []) });
  assert.deepEqual(asked.filter(name => name.startsWith('intent_')), ['intent_follow_up']);
});

test('reader: text parts lose Outlook conditional comments and the HTML part is kept for the frame', () => {
  assert.equal(cleanPlainText('<!--[if !mso]><!-->\nOlá\n\n\n\n<!--[if false]><!-->Tchau<!--<![endif]-->'), 'Olá\n\nTchau');
  assert.equal(messageHtml({ id: 'm', payload: { mimeType: 'multipart/alternative', parts: [
    { mimeType: 'text/plain', body: { data: b64('texto') } }, { mimeType: 'text/html', body: { data: b64('<b>html</b>') } }] } }), '<b>html</b>');
  assert.equal(messageHtml({ id: 'm', payload: { mimeType: 'text/plain', body: { data: b64('só texto') } } }), null);
});
