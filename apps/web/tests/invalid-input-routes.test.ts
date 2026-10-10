import { testDb } from './test-setup';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { registerHooks } from 'node:module';
import test, { after } from 'node:test';
import { authStore, withPostgres } from '../src/lib/database';
import { createConversation } from '../src/lib/ai-store';
import { LEGAL_VERSION } from '../src/lib/legal-version';
import { requestHeaders } from './support/request-headers';

process.env.BETTER_AUTH_SECRET = randomBytes(48).toString('base64url');
process.env.BETTER_AUTH_URL = 'http://localhost:3000';
const hooks = registerHooks({ resolve(specifier, context, next) {
  return specifier === 'next/headers' ? { url: new URL('./support/request-headers.ts', import.meta.url).href, shortCircuit: true } : next(specifier, context);
} });
after(() => hooks.deregister());

const origin = 'http://localhost:3000';

async function fixture() {
  const pool = await authStore();
  const backend = globalThis as typeof globalThis & { k5Postgres?: { database: typeof testDb; store: typeof pool } };
  backend.k5Postgres = { database: testDb, store: pool };
  const { auth } = await import('../src/lib/auth');
  const signup = await withPostgres(pool, () => auth.handler(new Request(`${origin}/api/auth/sign-up/email`, {
    method: 'POST', headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Teste', officeName: 'Teste', email: `${randomUUID()}@test.local`, password: 'Route-Test-2026!', acceptedLegalVersion: LEGAL_VERSION }),
  })));
  assert.equal(signup.status, 200);
  const cookie = signup.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const { user } = await signup.json();
  const member = await testDb.prepare('SELECT office_id FROM office_member WHERE user_id=?').get<{ office_id: string }>(user.id);
  assert.ok(member);
  const call = (path: string, init: RequestInit, handler: (request: Request) => Promise<Response>) => {
    const headers = new Headers({ origin, cookie, ...init.headers as Record<string, string> });
    return withPostgres(pool, () => requestHeaders.run(headers, () => handler(new Request(`${origin}${path}`, { ...init, headers }))));
  };
  return { owner: { userId: user.id as string, officeId: member.office_id }, call };
}

const bodyOf = async (response: Response) => ({ status: response.status, body: await response.json() });

test('uploads answer 400 instead of 500 to a body that is not multipart and still accept a form', async () => {
  const { owner, call } = await fixture();
  const attachments = await import('../src/app/api/chat/attachments/route');
  const feedback = await import('../src/app/api/feedback/route');
  const rejected = { status: 400, body: { error: 'Confira o arquivo enviado.' } };
  assert.deepEqual(await bodyOf(await call('/api/chat/attachments', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'não é multipart' }, attachments.POST)), rejected);
  for (const [type, body] of [['application/json', JSON.stringify({ message: 'Erro na agenda' })], ['text/plain', 'Erro na agenda']]) {
    assert.deepEqual(await bodyOf(await call('/api/feedback', { method: 'POST', headers: { 'content-type': type }, body }, feedback.POST)), rejected, type);
  }
  const upload = new FormData();
  upload.set('file', new File(['Revisar contrato amanhã.'], 'tarefas.txt', { type: 'text/plain' }));
  upload.set('conversationId', (await createConversation(testDb, owner)).id);
  const attached = await bodyOf(await call('/api/chat/attachments', { method: 'POST', body: upload }, attachments.POST));
  assert.deepEqual([attached.status, attached.body.attachment?.name], [201, 'tarefas.txt']);
  const report = new FormData();
  report.set('message', 'A agenda não carrega');
  const sent = await bodyOf(await call('/api/feedback', { method: 'POST', body: report }, feedback.POST));
  assert.equal(sent.status, 201);
  assert.equal((await testDb.prepare('SELECT message FROM feedback_ticket WHERE id=?').get<{ message: string }>(sent.body.ticket.id))?.message, 'A agenda não carrega');
});

test('GET /api/runs answers 400 to a limit that is not an integer from 1 to 100', async () => {
  const { call } = await fixture();
  const runs = await import('../src/app/api/runs/route');
  for (const limit of ['abc', '-1', '1.5', '0', '101', '100000']) {
    assert.deepEqual(await bodyOf(await call(`/api/runs?limit=${limit}`, {}, runs.GET)), { status: 400, body: { error: 'Confira os dados enviados.' } }, limit);
  }
  assert.deepEqual(await bodyOf(await call('/api/runs', {}, runs.GET)), { status: 200, body: { runs: [] } });
  assert.deepEqual(await bodyOf(await call('/api/runs?limit=100', {}, runs.GET)), { status: 200, body: { runs: [] } });
});
