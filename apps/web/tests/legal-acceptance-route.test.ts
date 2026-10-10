import { testDb } from './test-setup';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { registerHooks } from 'node:module';
import test, { after } from 'node:test';
import { authStore, withPostgres } from '../src/lib/database';
import * as agenda from '../src/lib/application/agenda-service';
import * as portal from '../src/lib/client-portal/service';
import { LEGAL_VERSION } from '../src/lib/legal-version';
import { requestHeaders } from './support/request-headers';

process.env.BETTER_AUTH_SECRET = randomBytes(48).toString('base64url');
process.env.BETTER_AUTH_URL = 'http://localhost:3000';
const hooks = registerHooks({ resolve(specifier, context, next) {
  return specifier === 'next/headers' ? { url: new URL('./support/request-headers.ts', import.meta.url).href, shortCircuit: true } : next(specifier, context);
} });
after(() => hooks.deregister());

const origin = 'http://localhost:3000', password = 'Route-Test-2026!';
const cookiesOf = (response: Response) => response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');

async function fixture() {
  const pool = await authStore();
  const backend = globalThis as typeof globalThis & { k5Postgres?: { database: typeof testDb; store: typeof pool } };
  backend.k5Postgres = { database: testDb, store: pool };
  const { auth } = await import('../src/lib/auth');
  const acceptance = await import('../src/app/api/legal/acceptance/route');
  const invitations = await import('../src/app/api/client-portal/invitations/[token]/route');
  const call = (headers: Headers, handler: () => Promise<Response>) => withPostgres(pool, () => requestHeaders.run(headers, handler));
  async function signUpOffice() {
    const response = await withPostgres(pool, () => auth.handler(new Request(`${origin}/api/auth/sign-up/email`, {
      method: 'POST', headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Teste', officeName: 'Teste', email: `${randomUUID()}@test.local`, password, acceptedLegalVersion: LEGAL_VERSION }),
    })));
    assert.equal(response.status, 200, await response.clone().text());
    const { user } = await response.json() as { user: { id: string } };
    const member = await testDb.prepare('SELECT office_id FROM office_member WHERE user_id=?').get<{ office_id: string }>(user.id);
    const session = await testDb.prepare('SELECT id FROM session WHERE "userId"=?').get<{ id: string }>(user.id);
    assert.ok(member && session);
    return { user, cookie: cookiesOf(response), context: { userId: user.id, officeId: member.office_id, sessionId: session.id } };
  }
  async function invitePortalClient() {
    const { context } = await signUpOffice();
    const email = `${randomUUID()}@client.test`;
    const { client: { id: clientId } } = await agenda.createClient(context, { name: 'Cliente Maria', email, stage: 'active' });
    const invited = await portal.invitePortal(context, { clientId, email, version: 0 });
    const token = invited.invitationPath.split('/').at(-1);
    assert.ok(token && invited.access);
    return { email, token, accessId: invited.access.id };
  }
  const acceptInvitation = (token: string, body: Record<string, unknown>) => call(new Headers(), () => invitations.POST(new Request(`${origin}/api/client-portal/invitations/${token}`, {
    method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Cliente Maria', password, ...body }),
  }), { params: Promise.resolve({ token }) }));
  const acceptTerms = (cookie: string) => call(new Headers({ cookie }), () => acceptance.POST(new Request(`${origin}/api/legal/acceptance`, {
    method: 'POST', headers: { origin, cookie, 'content-type': 'application/json' }, body: JSON.stringify({ document: 'terms' }),
  })));
  return { call, signUpOffice, invitePortalClient, acceptInvitation, acceptTerms };
}

test('office APIs answer 403 with the acceptance message until the person accepts the current terms', async () => {
  const f = await fixture();
  const { user, cookie } = await f.signUpOffice();
  const { GET: exportOffice } = await import('../src/app/api/office/export/route');
  const { POST: createCase } = await import('../src/app/api/vault/cases/route');
  const headers = new Headers({ origin, cookie, 'content-type': 'application/json' });
  const exportRequest = async () => {
    const response = await f.call(headers, () => exportOffice(new Request(`${origin}/api/office/export`, { headers })));
    if (response.ok) await response.arrayBuffer();
    return response;
  };
  const caseRequest = () => f.call(headers, () => createCase(new Request(`${origin}/api/vault/cases`, { method: 'POST', headers, body: JSON.stringify({ name: `Caso ${randomUUID()}`, idempotencyKey: randomUUID() }) })));
  assert.equal((await exportRequest()).status, 200);
  await testDb.prepare('DELETE FROM legal_acceptance WHERE user_id=?').run(user.id);
  const denied = await exportRequest();
  assert.equal(denied.status, 403);
  assert.match((await denied.json()).error, /Termos de uso/);
  assert.equal((await caseRequest()).status, 403);
  assert.equal((await f.acceptTerms(cookie)).status, 204);
  assert.equal((await exportRequest()).status, 200);
  assert.equal((await caseRequest()).status, 201);
});

test('the client portal API answers 403 until the client accepts the current terms', async () => {
  const f = await fixture();
  const { token, accessId } = await f.invitePortalClient();
  const created = await f.acceptInvitation(token, { acceptedLegalVersion: LEGAL_VERSION });
  assert.equal(created.status, 200, await created.clone().text());
  const cookie = cookiesOf(created);
  const { user } = await created.json() as { user: { id: string } };
  const { GET: portalView } = await import('../src/app/api/client-portal/[accessId]/route');
  const view = () => f.call(new Headers({ cookie }), () => portalView(new Request(`${origin}/api/client-portal/${accessId}`, { headers: { cookie } }), { params: Promise.resolve({ accessId }) }));
  assert.equal((await view()).status, 200);
  await testDb.prepare('DELETE FROM legal_acceptance WHERE user_id=?').run(user.id);
  const denied = await view();
  assert.equal(denied.status, 403);
  assert.match((await denied.json()).error, /Termos de uso/);
  assert.equal((await f.acceptTerms(cookie)).status, 204);
  assert.equal((await view()).status, 200);
});

test('the portal invitation creates no account without the current legal version', async () => {
  const f = await fixture();
  const { email, token } = await f.invitePortalClient();
  for (const body of [{}, { acceptedLegalVersion: '0.9' }]) {
    assert.equal((await f.acceptInvitation(token, body)).status, 400);
    assert.equal(await testDb.prepare('SELECT 1 FROM "user" WHERE email=?').get(email), undefined);
  }
  const created = await f.acceptInvitation(token, { acceptedLegalVersion: LEGAL_VERSION });
  assert.equal(created.status, 200, await created.clone().text());
  const { user } = await created.json() as { user: { id: string } };
  assert.equal((await testDb.prepare("SELECT version FROM legal_acceptance WHERE user_id=? AND document='terms'").get<{ version: string }>(user.id))?.version, LEGAL_VERSION);
});
