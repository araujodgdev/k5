import { testDb } from './test-setup';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { UIMessage } from 'ai';
import { database, withTransaction } from '../src/lib/database';
import { conversation, createConversation } from '../src/lib/ai-store';
import { admitTurn, holdsTurn, releaseTurn, writeTurnHistory } from '../src/lib/chat-lease';
import { cancelChatRun, ChatRun, executeChatRun, nextRun } from '../src/lib/chat-run';
import type { ChatTurn } from '../src/lib/chat-turn';
import { delegateTask } from '../src/lib/application/task-delegation';
import { createActivity, getActivity } from '../src/lib/application/agenda-service';
import type { WorkspaceContext } from '../src/lib/application/context';
import { agendaCapabilities } from '../src/lib/capabilities/agenda';
import { createAiConnection } from '../src/lib/ai-connections-core';
import { updateModelAssignment } from '../src/lib/ai-assignments-core';

async function fixture(count = 6) {
  const owner: WorkspaceContext = { officeId: randomUUID(), userId: randomUUID() };
  await testDb.prepare('INSERT INTO office(id,name) VALUES(?,?)').run(owner.officeId, 'Teste');
  await testDb.prepare('INSERT INTO user(id,email,name) VALUES(?,?,?)').run(owner.userId, `${owner.userId}@test.local`, 'Advogada');
  await testDb.prepare('INSERT INTO office_member(id,office_id,user_id) VALUES(?,?,?)').run(randomUUID(), owner.officeId, owner.userId);
  const conversations = await Promise.all(Array.from({ length: count }, () => createConversation(testDb, owner)));
  const admit = (id: string) => withTransaction(tx => admitTurn(tx, owner, id));
  return { owner, conversations, admit };
}

const message = (id: string, text: string): UIMessage => ({ id, role: 'assistant', parts: [{ type: 'text', text }] });
const turnFor = (owner: WorkspaceContext, conversationId: string, lease: ChatTurn['lease']): ChatTurn => ({
  workspace: owner, conversationId, lease, request: { attachments: [], documentIds: [], researchReferenceIds: [], caseId: undefined },
});

test('simultaneous admissions allow exactly three turns and leave all histories available', async () => {
  const { owner, conversations, admit } = await fixture(10);
  const outcomes = await Promise.allSettled(conversations.map(c => admit(c.id)));
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 3);
  assert.equal(outcomes.filter(result => result.status === 'rejected').length, 7);
  for (const outcome of outcomes) if (outcome.status === 'rejected') assert.equal(outcome.reason.code, 'RATE_LIMITED');
  assert.deepEqual(await testDb.prepare('SELECT count(*) AS histories, count(*) FILTER (WHERE busy_until > 0) AS running FROM ai_conversation WHERE user_id=?').get(owner.userId), { histories: 10, running: 3 });
  const first = outcomes.findIndex(result => result.status === 'fulfilled');
  await assert.rejects(admit(conversations[first].id), { code: 'CONFLICT' });
});

test('admission scopes the conversation to both user and office and counts by user across offices', async () => {
  const a = await fixture(); const b = await fixture(1);
  await Promise.all(a.conversations.slice(0, 3).map(c => a.admit(c.id)));
  const otherLease = await b.admit(b.conversations[0].id);
  assert.equal(await holdsTurn(b.owner, b.conversations[0].id, otherLease), true);
  await assert.rejects(a.admit(b.conversations[0].id), { code: 'NOT_FOUND' });
  await assert.rejects(withTransaction(tx => admitTurn(tx, { ...a.owner, officeId: b.owner.officeId }, a.conversations[3].id)), { code: 'NOT_FOUND' });
  const transferred = await createConversation(testDb, { ...a.owner, officeId: b.owner.officeId });
  await assert.rejects(withTransaction(tx => admitTurn(tx, { ...a.owner, officeId: b.owner.officeId }, transferred.id)), { code: 'RATE_LIMITED' });
});

test('admission uses the database clock and a missing executor never clears a held lease', async t => {
  const { owner, conversations, admit } = await fixture(4);
  const leases = await Promise.all(conversations.slice(0, 3).map(c => admit(c.id)));
  t.mock.method(Date, 'now', () => leases[0].expiresAt + 86_400_000);
  await assert.rejects(admit(conversations[0].id), { code: 'CONFLICT' });
  await assert.rejects(admit(conversations[3].id), { code: 'RATE_LIMITED' });
  assert.equal(await cancelChatRun(conversations[0].id), false);
  assert.equal(await holdsTurn(owner, conversations[0].id, leases[0]), true);
  assert.equal(await releaseTurn(owner, conversations[0].id, leases[0]), true);
  const next = await admit(conversations[3].id);
  assert.equal(await holdsTurn(owner, conversations[3].id, next), true);
});

test('chat and task delegation share capacity; refusal rolls back task, history and notification changes', async () => {
  const { owner, conversations, admit } = await fixture();
  await Promise.all(conversations.slice(0, 2).map(c => admit(c.id)));
  const first = await createActivity(owner, agendaCapabilities.k5_agenda_create_activity.input.parse({ kind: 'task', title: 'Revisar contrato' }));
  let delegated: ChatTurn | undefined;
  await delegateTask(owner, { activityId: first.activity.id }, { ready: async () => true, start: async turn => { delegated = turn; } });
  assert.ok(delegated);
  assert.equal((await getActivity(owner, { activityId: first.activity.id })).activity.status, 'in_progress');
  await assert.rejects(admit(conversations[2].id), { code: 'RATE_LIMITED' });
  const second = await createActivity(owner, agendaCapabilities.k5_agenda_create_activity.input.parse({ kind: 'task', title: 'Quarta resposta' }));
  const before = await testDb.prepare('SELECT count(*) AS n FROM notification_event WHERE office_id=?').get(owner.officeId);
  await assert.rejects(delegateTask(owner, { activityId: second.activity.id }, { ready: async () => true }), { code: 'RATE_LIMITED' });
  const refused = (await getActivity(owner, { activityId: second.activity.id })).activity;
  assert.equal(refused.status, 'pending');
  assert.equal(refused.version, 1);
  assert.equal(refused.agentConversationId, undefined);
  assert.deepEqual(await testDb.prepare('SELECT count(*) AS n FROM ai_conversation WHERE user_id=?').get(owner.userId), { n: 7 });
  assert.deepEqual(await testDb.prepare('SELECT count(*) AS n FROM notification_event WHERE office_id=?').get(owner.officeId), before);
  assert.equal(await releaseTurn(owner, delegated.conversationId, delegated.lease), true);
  await assert.rejects(delegateTask(owner, { activityId: second.activity.id }, { ready: async () => true, start: async () => { throw new Error('Executor unavailable'); } }), /Executor unavailable/);
  const available = await admit(conversations[2].id);
  assert.equal(await holdsTurn(owner, conversations[2].id, available), true);
});

for (const operation of ['history', 'release'] as const) {
  test(`a paused production ${operation} write cannot overwrite or release the replacement turn`, async t => {
    const { owner, conversations, admit } = await fixture(1);
    const id = conversations[0].id, lease = await admit(id);
    const paused = Promise.withResolvers<void>(), resume = Promise.withResolvers<void>();
    const prepare = database.prepare.bind(database);
    let intercept = true;
    t.mock.method(database, 'prepare', (sql: string) => {
      const statement = prepare(sql);
      if (!intercept || !sql.startsWith('UPDATE ai_conversation')) return statement;
      intercept = false;
      return { ...statement, async run(...params: unknown[]) { paused.resolve(); await resume.promise; return statement.run(...params); } };
    });
    const writing = operation === 'history'
      ? writeTurnHistory(owner, id, lease, [message('stale', 'Resposta antiga')])
      : releaseTurn(owner, id, lease, [message('stale', 'Resposta antiga')]);
    await paused.promise;
    await testDb.prepare('UPDATE ai_conversation SET busy_until=0 WHERE id=?').run(id);
    const replacement = await admit(id);
    assert.equal(await writeTurnHistory(owner, id, replacement, [message('new', 'Resposta atual')]), true);
    resume.resolve();
    assert.equal(await writing, false);
    assert.equal(await holdsTurn(owner, id, replacement), true);
    assert.deepEqual((await conversation(testDb, owner, id))?.messages, [message('new', 'Resposta atual')]);
    assert.equal(await releaseTurn(owner, id, replacement, [message('final', 'Concluída')]), true);
    assert.deepEqual((await conversation(testDb, owner, id))?.messages, [message('final', 'Concluída')]);
  });
}

test('concurrent starts install and execute one run, including a replay after completion', async t => {
  const { owner, conversations, admit } = await fixture(1);
  const id = conversations[0].id, lease = await admit(id), turn = turnFor(owner, id, lease);
  const paused = Promise.withResolvers<void>(), resume = Promise.withResolvers<void>();
  const prepare = database.prepare.bind(database);
  let reads = 0;
  t.mock.method(database, 'prepare', (sql: string) => {
    const statement = prepare(sql);
    if (!sql.includes('SELECT 1 AS held')) return statement;
    return { ...statement, async get<T>(...params: unknown[]) {
      const result = await statement.get<T>(...params);
      if (++reads === 2) paused.resolve();
      await resume.promise;
      return result;
    } };
  });
  let active: ChatRun | undefined;
  const start = () => nextRun(() => active, run => { active = run; }, turn);
  const starts = [start(), start()];
  await paused.promise; resume.resolve();
  const results = await Promise.all(starts);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(active?.token, lease.token);
  assert.equal(active?.controller.signal.aborted, false);
  active!.finish();
  assert.equal(await start(), null);
});

test('a delayed positive lease read cannot abort the replacement installed meanwhile', async t => {
  const { owner, conversations, admit } = await fixture(1);
  const id = conversations[0].id, oldLease = await admit(id);
  const paused = Promise.withResolvers<void>(), resume = Promise.withResolvers<void>();
  const prepare = database.prepare.bind(database);
  let intercepted = false;
  t.mock.method(database, 'prepare', (sql: string) => {
    const statement = prepare(sql);
    if (!sql.includes('SELECT 1 AS held')) return statement;
    return { ...statement, async get<T>(...params: unknown[]) {
      const result = await statement.get<T>(...params);
      if (!intercepted) { intercepted = true; paused.resolve(); await resume.promise; }
      return result;
    } };
  });
  let active: ChatRun | undefined;
  const install = (run: ChatRun) => { active = run; };
  const stale = nextRun(() => active, install, turnFor(owner, id, oldLease));
  const refused = assert.rejects(stale, { code: 'CONFLICT' });
  await paused.promise;
  await testDb.prepare('UPDATE ai_conversation SET busy_until=0 WHERE id=?').run(id);
  const currentLease = await admit(id);
  const replacement = await nextRun(() => active, install, turnFor(owner, id, currentLease));
  resume.resolve(); await refused;
  assert.equal(active?.token, currentLease.token);
  assert.equal(replacement?.controller.signal.aborted, false);
});

test('an executor failure before model setup releases its own capacity', async () => {
  const { owner, conversations, admit } = await fixture(4);
  const leases = await Promise.all(conversations.slice(0, 3).map(c => admit(c.id)));
  const run = new ChatRun(leases[0].token);
  await executeChatRun(run, turnFor(owner, conversations[0].id, leases[0]));
  assert.equal(run.done, true);
  assert.match(await new Response(run.follow()).text(), /Não foi possível concluir a resposta/);
  const fourth = await admit(conversations[3].id);
  assert.equal(await holdsTurn(owner, conversations[3].id, fourth), true);
  assert.equal(await holdsTurn(owner, conversations[1].id, leases[1]), true);
});

test('stopping a running Node turn interrupts the provider, saves the interruption and frees capacity', { timeout: 30_000 }, async t => {
  const { owner, conversations, admit } = await fixture(4);
  const connection = await createAiConnection(testDb, Buffer.from(process.env.K5_CREDENTIALS_KEY!, 'base64'), owner.userId,
    { name: 'Proxy para cancelamento', provider: 'cliproxyapi', apiKey: 'synthetic-stop-key' });
  await updateModelAssignment(testDb, owner.userId, { scope: 'group', target: 'agent',
    model: { mode: 'explicit', connectionId: connection.id, modelId: 'gpt-6-luna' }, effort: { mode: 'provider_default' } });
  const leases = await Promise.all(conversations.slice(0, 3).map(c => admit(c.id)));
  const id = conversations[0].id;
  await writeTurnHistory(owner, id, leases[0], [{ id: 'question', role: 'user', parts: [{ type: 'text', text: 'Escreva uma resposta longa.' }] }]);
  const entered = Promise.withResolvers<AbortSignal>();
  t.mock.method(globalThis, 'fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
    const signal = init?.signal;
    assert.ok(signal);
    entered.resolve(signal);
    return new Promise<Response>((_resolve, reject) => {
      const abort = () => reject(signal.reason);
      if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
    });
  });
  const run = new ChatRun(leases[0].token);
  const execution = executeChatRun(run, turnFor(owner, id, leases[0]));
  const providerSignal = await entered.promise;
  run.controller.abort();
  await execution;
  assert.equal(providerSignal.aborted, true);
  assert.equal(run.done, true);
  const stored = await conversation(testDb, owner, id);
  assert.equal(stored?.messages.at(-1)?.role, 'assistant');
  assert.match(JSON.stringify(stored?.messages.at(-1)), /Resposta interrompida/);
  const fourth = await admit(conversations[3].id);
  assert.equal(await holdsTurn(owner, conversations[3].id, fourth), true);
  assert.equal(await holdsTurn(owner, conversations[1].id, leases[1]), true);
});
