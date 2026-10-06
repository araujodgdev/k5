import { testDb } from './test-setup';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { registerHooks } from 'node:module';
import test, { after } from 'node:test';
import { authStore, withPostgres, withTransaction } from '../src/lib/database';
import { createConversation, conversation } from '../src/lib/ai-store';
import { admitTurn, releaseTurn, writeTurnHistory } from '../src/lib/chat-lease';
import { createAiConnection } from '../src/lib/ai-connections-core';
import { requestHeaders } from './support/request-headers';
import { executor } from './support/chat-route-executor';

process.env.BETTER_AUTH_SECRET = randomBytes(48).toString('base64url');
process.env.BETTER_AUTH_URL = 'http://localhost:3000';
const hooks = registerHooks({ resolve(specifier, context, next) {
  const substitute = specifier === 'next/headers' ? './support/request-headers.ts'
    : specifier === '@/lib/chat-run' && context.parentURL?.includes('/api/chat/route.ts') ? './support/chat-route-executor.ts' : null;
  return substitute ? { url: new URL(substitute, import.meta.url).href, shortCircuit: true } : next(specifier, context);
} });
after(() => hooks.deregister());

async function fixture() {
  const pool = await authStore();
  const backend = globalThis as typeof globalThis & { k5Postgres?: { database: typeof testDb; store: typeof pool } };
  backend.k5Postgres = { database: testDb, store: pool };
  const { auth } = await import('../src/lib/auth');
  const { POST } = await import('../src/app/api/chat/route');
  const origin = 'http://localhost:3000';
  const signup = await withPostgres(pool, () => auth.handler(new Request(`${origin}/api/auth/sign-up/email`, {
    method: 'POST', headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Teste', officeName: 'Teste', email: `${randomUUID()}@test.local`, password: 'Route-Test-2026!' }),
  })));
  assert.equal(signup.status, 200);
  const cookie = signup.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const { user } = await signup.json();
  const member = await testDb.prepare('SELECT office_id FROM office_member WHERE user_id=?').get<{ office_id: string }>(user.id);
  assert.ok(member);
  const owner = { userId: user.id, officeId: member.office_id };
  await createAiConnection(testDb, Buffer.from(process.env.K5_CREDENTIALS_KEY!, 'base64'), user.id,
    { name: `Direta ${user.id}`, provider: 'openai', apiKey: 'synthetic-route-key' });
  const post = (id: string, text = 'Nova pergunta') => {
    const headers = new Headers({ origin, cookie, 'content-type': 'application/json' });
    return withPostgres(pool, () => requestHeaders.run(headers, () => POST(new Request(`${origin}/api/chat`, {
      method: 'POST', headers, body: JSON.stringify({ conversationId: id, message: { id: randomUUID(), role: 'user', parts: [{ type: 'text', text }] } }),
    }))));
  };
  return { owner, post };
}

test('POST rereads history after admission when the preceding turn finished after the first read', async t => {
  const { owner, post } = await fixture();
  const { id } = await createConversation(testDb, owner);
  const lease = await withTransaction(tx => admitTurn(tx, owner, id));
  await writeTurnHistory(owner, id, lease, [{ id: 'question', role: 'user', parts: [{ type: 'text', text: 'Pergunta anterior' }] }]);
  const paused = Promise.withResolvers<void>(), resume = Promise.withResolvers<void>();
  const prepare = testDb.prepare.bind(testDb);
  let intercepted = false;
  t.mock.method(testDb, 'prepare', (sql: string) => {
    const statement = prepare(sql);
    if (!sql.startsWith('SELECT id,title,updated_at AS updatedAt,messages')) return statement;
    return { ...statement, async get<T>(...params: unknown[]) {
      const result = await statement.get<T>(...params);
      if (!intercepted) { intercepted = true; paused.resolve(); await resume.promise; }
      return result;
    } };
  });
  const response = post(id);
  await paused.promise;
  await releaseTurn(owner, id, lease, [
    { id: 'question', role: 'user', parts: [{ type: 'text', text: 'Pergunta anterior' }] },
    { id: 'answer', role: 'assistant', parts: [{ type: 'text', text: 'Resposta concluída durante a admissão' }] },
  ]);
  resume.resolve();
  assert.equal((await response).status, 200);
  const stored = await conversation(testDb, owner, id);
  assert.deepEqual(stored?.messages.map(message => message.parts), [
    [{ type: 'text', text: 'Pergunta anterior' }],
    [{ type: 'text', text: 'Resposta concluída durante a admissão' }],
    [{ type: 'text', text: 'Nova pergunta' }],
  ]);
  const turn = executor.turns.at(-1)!;
  assert.equal(turn.conversationId, id);
  assert.equal(await releaseTurn(owner, id, turn.lease), true);
});

test('POST returns 409 for a busy conversation and 429 for the fourth without storing an unanswered message', async () => {
  const { owner, post } = await fixture();
  const conversations = await Promise.all(Array.from({ length: 4 }, () => createConversation(testDb, owner)));
  const responses = await Promise.all(conversations.slice(0, 3).map(c => post(c.id)));
  assert.deepEqual(responses.map(response => response.status), [200, 200, 200]);
  assert.equal((await post(conversations[0].id)).status, 409);
  const fourth = await post(conversations[3].id);
  assert.equal(fourth.status, 429);
  assert.match((await fourth.json()).error, /3 respostas do Lume/);
  assert.deepEqual((await conversation(testDb, owner, conversations[3].id))?.messages, []);
  const running = executor.turns.find(turn => turn.conversationId === conversations[0].id)!;
  assert.equal(await releaseTurn(owner, running.conversationId, running.lease), true);
  assert.equal((await post(conversations[3].id)).status, 200);
  assert.equal((await conversation(testDb, owner, conversations[3].id))?.messages.length, 1);
});
