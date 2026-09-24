import { testDb } from './test-setup';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createTicket, listAuthorTickets, platformTicket, platformTickets, updateTicket } from '../src/lib/feedback-tickets';
import { composeTriage, processNextFeedbackClassification } from '../src/lib/feedback-triage';
import { saveConnection, connectionView } from '../src/lib/typesafe/config';
import { connectionSettings, type DecisionResponse } from '../src/lib/typesafe/contracts';
import type { DecisionRequest, DecisionTransport } from '../src/lib/typesafe/client';

async function member(role = 'lawyer', officeId: string = randomUUID()) {
  const userId = randomUUID();
  if (!await testDb.prepare('SELECT 1 FROM office WHERE id=?').get(officeId)) await testDb.prepare('INSERT INTO office(id,name) VALUES(?,?)').run(officeId, 'Escritório de teste');
  await testDb.prepare('INSERT INTO user(id,email,name) VALUES(?,?,?)').run(userId, `${userId}@example.test`, 'Pessoa');
  await testDb.prepare('INSERT INTO office_member(id,office_id,user_id,role) VALUES(?,?,?,?)').run(randomUUID(), officeId, userId, role);
  return { officeId, userId };
}
async function admin() {
  const person = await member();
  await testDb.prepare('INSERT INTO platform_admin(user_id) VALUES(?)').run(person.userId);
  return person;
}
const png = () => new File([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])], 'print.png', { type: 'image/png' });

type Answers = { kind?: string; kindConfidence?: number; module?: string; severity?: number; value?: number; security?: number; personal?: number };
function reply(request: DecisionRequest, value: Answers): DecisionResponse {
  const choice = (name: string, picked: string, confidence = 0.95) => {
    const question = request.questions[name] as { criteria: Record<string, string> };
    return { type: 'choice' as const, choice: picked, confidence, probabilities: Object.fromEntries(Object.keys(question.criteria).map(key => [key, key === picked ? 1 : 0])) };
  };
  const severity = value.severity ?? 0;
  return { model: request.model, usage: { input_tokens: 50, output_tokens: 5 }, answers: {
    kind: choice('kind', value.kind ?? 'problem', value.kindConfidence),
    module: choice('module', value.module ?? 'cofre'),
    severity: { type: 'score', score: severity, confidence: 0.9, probabilities: { '0': Number(severity === 0), '1': Number(severity === 1), '2': Number(severity === 2), '3': Number(severity === 3) } },
    // Every question is answered, as Jev does; a neutral value keeps improvements at P2 unless a test says otherwise.
    value: { type: 'score', score: value.value ?? 1.5, confidence: 0.9, probabilities: { '0': 0, '1': 0.5, '2': 0.5, '3': 0 } },
    security: { type: 'noul', noul: value.security ?? 0.05 },
    personal_data: { type: 'noul', noul: value.personal ?? 0.05 },
  } };
}
const sender = (value: Answers): DecisionTransport => async (_key, request) => reply(request, value);
async function enableTypesafe(actor: string) {
  await saveConnection(actor, connectionSettings.parse({ apiKey: 'synthetic-key-not-secret', enabled: true, version: (await connectionView()).version }));
}
async function drain(send: DecisionTransport) { while (await processNextFeedbackClassification({ send })); }

test('feedback: any member reports, authors see only their own tickets, invalid input is refused', async () => {
  const author = await member('reviewer');
  const colleague = await member('lawyer', author.officeId);
  const outsider = await member();
  const first = await createTicket(author, { message: 'O upload travou no Cofre.', pagePath: '/app/vault' }, png(), 'Navegador de teste');
  assert.ok(first.number > 0);
  await createTicket(colleague, { message: 'Sugestão: filtro por área.' }, null);
  const own = await listAuthorTickets(author);
  assert.deepEqual(own.map(ticket => ticket.number), [first.number]);
  assert.equal(own[0].status, 'new'); assert.equal(own[0].resolutionNote, '');
  assert.equal((await listAuthorTickets(outsider)).length, 0);
  await assert.rejects(createTicket({ officeId: author.officeId, userId: outsider.userId }, { message: 'Sem vínculo' }, null), { status: 403 });
  await assert.rejects(createTicket(author, { message: 'x' }, null), { status: 400 });
  await assert.rejects(createTicket(author, { message: 'Imagem falsa', pagePath: '' }, new File([Buffer.from('not an image')], 'x.png', { type: 'image/png' })), { status: 400 });
  await assert.rejects(createTicket(author, { message: 'Formato errado' }, new File([Buffer.from('GIF89a')], 'x.gif', { type: 'image/gif' })), { status: 400 });
  await assert.rejects(createTicket(author, { message: 'Caminho externo', pagePath: 'https://example.test' }, null), { status: 400 });
});

test('feedback: the kind and place the person chose are kept apart from triage and seed the queue', async () => {
  const author = await member();
  const platform = await admin();
  const ticket = await createTicket(author, { message: 'Poder enviar vários arquivos de uma vez.', pagePath: '/app/agents', kind: 'suggestion', module: 'lume' }, null);
  const own = (await listAuthorTickets(author)).find(item => item.id === ticket.id)!;
  assert.equal(own.kind, 'suggestion'); assert.equal(own.module, 'lume');
  const view = (await platformTicket(platform.userId, ticket.id))!;
  assert.equal(view.reportedKind, 'suggestion'); assert.equal(view.reportedModule, 'lume');
  assert.equal(view.kind, 'suggestion', 'the queue is readable before the model answers'); assert.equal(view.module, 'lume');
  await assert.rejects(createTicket(author, { message: 'Só problema ou melhoria', kind: 'praise' }, null), { status: 400 });
  await assert.rejects(createTicket(author, { message: 'Lugar desconhecido', module: 'financeiro' }, null), { status: 400 });
});

test('feedback triage: priority is composed in code from typed answers', () => {
  const request = { questions: { kind: { criteria: { problem: '', suggestion: '', question: '', praise: '', other: '' } }, module: { criteria: { cofre: '', lume: '' } } }, model: 'jev-1.13.0' } as unknown as DecisionRequest;
  const triage = (value: Answers) => composeTriage(reply(request, value));
  assert.equal(triage({ kind: 'problem', severity: 3 }).priority, 'p0');
  assert.equal(triage({ kind: 'problem', severity: 2 }).priority, 'p1');
  assert.equal(triage({ kind: 'problem', severity: 0 }).priority, 'p2');
  assert.equal(triage({ kind: 'suggestion', severity: 3 }).priority, 'p2', 'severity only applies to problems');
  assert.equal(triage({ kind: 'suggestion', severity: 3 }).severity, null);
  assert.equal(triage({ kind: 'praise' }).priority, 'p3');
  // Improvements rank by how much they would help the office.
  assert.equal(triage({ kind: 'suggestion', value: 2.6 }).priority, 'p1');
  assert.equal(triage({ kind: 'suggestion', value: 1.4 }).priority, 'p2');
  assert.equal(triage({ kind: 'suggestion', value: 0.4 }).priority, 'p3');
  assert.equal(triage({ kind: 'suggestion', value: 2.6 }).valueScore, 2.6);
  assert.equal(triage({ kind: 'problem', severity: 0, value: 3 }).priority, 'p2', 'value only applies to improvements');
  assert.equal(triage({ kind: 'problem', severity: 0, value: 3 }).valueScore, null);
  const security = triage({ kind: 'praise', security: 0.9 });
  assert.equal(security.priority, 'p0'); assert.equal(security.securityFlag, true);
  assert.equal(triage({ kind: 'question', kindConfidence: 0.4 }).needsReview, true);
  assert.equal(triage({ kind: 'question', personal: 0.8 }).personalDataFlag, true);
  const empty = composeTriage(undefined);
  assert.equal(empty.kind, null); assert.equal(empty.needsReview, true); assert.equal(empty.priority, 'p2');
});

test('feedback triage: disabled, classified, retried and never overriding an admin correction', async () => {
  const author = await member();
  const platform = await admin();
  // Without a platform connection the ticket still arrives, unclassified and marked for review.
  const off = await createTicket(author, { message: 'Não consigo instalar no iPhone.' }, null);
  await drain(sender({}));
  let view = (await platformTicket(platform.userId, off.id))!;
  assert.equal(view.classificationStatus, 'disabled'); assert.equal(view.needsReview, true); assert.equal(view.priority, 'p2');

  await enableTypesafe(platform.userId);
  const urgent = await createTicket(author, { message: 'Vi documentos de outro escritório na minha lista.', pagePath: '/app/vault' }, null);
  let seen: DecisionRequest | undefined;
  await drain(async (key, request) => { seen = request; return reply(request, { kind: 'problem', module: 'cofre', severity: 3, security: 0.92 }); });
  assert.deepEqual((seen!.state as { feedback: unknown }).feedback, { message: 'Vi documentos de outro escritório na minha lista.', page: '/app/vault' });
  view = (await platformTicket(platform.userId, urgent.id))!;
  assert.equal(view.classificationStatus, 'classified'); assert.equal(view.classifiedBy, 'model');
  assert.equal(view.kind, 'problem'); assert.equal(view.module, 'cofre'); assert.equal(view.priority, 'p0'); assert.equal(view.securityFlag, true);
  assert.equal(view.classification?.questionVersion, 'feedback-triage-pt-BR-v2');
  assert.ok(view.events.some(event => event.kind === 'classified'));

  // What the person chose reaches the model as labels, as a hint next to the text.
  const hinted = await createTicket(author, { message: 'O botão de anexar some no celular.', pagePath: '/app/agents', kind: 'problem', module: 'lume' }, null);
  await drain(async (key, request) => { seen = request; return reply(request, { kind: 'problem', module: 'lume', severity: 1 }); });
  assert.deepEqual((seen!.state as { feedback: unknown }).feedback, { message: 'O botão de anexar some no celular.', page: '/app/agents', reported_kind: 'Problema', reported_area: 'Lume (chat)' });
  assert.equal((await platformTicket(platform.userId, hinted.id))!.priority, 'p2');

  // A provider failure is retried later instead of leaving the ticket unclassified.
  const flaky = await createTicket(author, { message: 'A pesquisa demora muito.' }, null);
  await drain(async () => { throw new Error('down'); });
  assert.equal((await platformTicket(platform.userId, flaky.id))!.classificationStatus, 'pending');
  await testDb.prepare('UPDATE feedback_ticket SET lease_until=0 WHERE id=?').run(flaky.id);
  await testDb.prepare('UPDATE typesafe_platform_connection SET circuit_until=0,failures=0 WHERE id=1').run();
  await drain(sender({ kind: 'problem', module: 'pesquisa', severity: 2 }));
  assert.equal((await platformTicket(platform.userId, flaky.id))!.priority, 'p1');

  // An admin correction made before the model answers is kept.
  const corrected = await createTicket(author, { message: 'Seria bom exportar a agenda.' }, null);
  const before = (await platformTicket(platform.userId, corrected.id))!;
  await updateTicket(platform.userId, corrected.id, { version: before.version, kind: 'suggestion', module: 'agenda', priority: 'p3' });
  await drain(sender({ kind: 'problem', module: 'cofre', severity: 3 }));
  view = (await platformTicket(platform.userId, corrected.id))!;
  assert.equal(view.kind, 'suggestion'); assert.equal(view.module, 'agenda'); assert.equal(view.priority, 'p3'); assert.equal(view.classifiedBy, 'admin');
  assert.equal(view.classification?.answers.kind?.choice, 'problem', 'the raw model answer stays for audit');
});

test('feedback admin: platform-only, versioned updates, history and a notification on resolution', async () => {
  const author = await member();
  const platform = await admin();
  const ticket = await createTicket(author, { message: 'O botão de salvar some no celular.' }, null);
  await assert.rejects(platformTickets(author.userId, {}), { status: 403 });
  await assert.rejects(updateTicket(author.userId, ticket.id, { version: 1, status: 'resolved' }), { status: 403 });

  const queue = await platformTickets(platform.userId, {});
  assert.ok(queue.tickets.some(item => item.id === ticket.id));
  let view = (await platformTicket(platform.userId, ticket.id))!;
  view = (await updateTicket(platform.userId, ticket.id, { version: view.version, status: 'in_progress', note: 'Reproduzido no Android.' }))!;
  await assert.rejects(updateTicket(platform.userId, ticket.id, { version: view.version - 1, status: 'dismissed' }), { status: 409 });
  view = (await updateTicket(platform.userId, ticket.id, { version: view.version, status: 'resolved', resolutionNote: 'Corrigido na versão de hoje.' }))!;
  assert.equal(view.status, 'resolved'); assert.ok(view.resolvedAt);
  assert.deepEqual(view.events.map(event => event.kind), ['created', 'status_changed', 'note', 'status_changed']);

  const events = await testDb.prepare("SELECT intended_recipients_json,data_json FROM notification_event WHERE event_type='system.feedback.resolved' AND source_id=?").all<{ intended_recipients_json: string; data_json: string }>(ticket.id);
  assert.equal(events.length, 1);
  assert.deepEqual(JSON.parse(events[0].intended_recipients_json), [author.userId]);
  const own = await listAuthorTickets(author);
  assert.equal(own[0].status, 'resolved'); assert.equal(own[0].resolutionNote, 'Corrigido na versão de hoje.');

  // Resolved tickets leave the default (open) queue but stay reachable by filter.
  assert.ok(!(await platformTickets(platform.userId, {})).tickets.some(item => item.id === ticket.id));
  assert.ok((await platformTickets(platform.userId, { status: 'resolved' })).tickets.some(item => item.id === ticket.id));
});
