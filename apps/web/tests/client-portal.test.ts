import { testDb } from './test-setup';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import type { PoolClient } from 'pg';
import { authStore } from '../src/lib/database';
import { createAuth } from '../src/lib/auth-core';
import { withClientRegistration } from '../src/lib/client-portal/registration';
import { acceptPortalInvitation } from '../src/lib/client-portal/invitations';
import * as portal from '../src/lib/client-portal/service';
import * as agenda from '../src/lib/application/agenda-service';
import * as honorarios from '../src/lib/honorarios/service';
import { prepareCharge } from '../src/lib/honorarios/charges';
import { findOfficeForUser } from '../src/lib/offices';
import { objectStorage, resetObjectStorageForTests } from '../src/lib/storage';
import type { WorkspaceContext } from '../src/lib/application/context';

const origin = 'http://localhost:3000', password = 'Senha-segura-2026!';
async function fixture(idempotencyKey?: string) {
  const auth = createAuth(await authStore(), testDb, { secret: randomBytes(48).toString('base64url'), baseURL: origin, idleSeconds: 3600, ipHeaders: ['x-forwarded-for'] });
  async function signup(email: string) {
    const ip = `10.${Math.floor(Math.random()*200)+1}.${Math.floor(Math.random()*200)+1}.${Math.floor(Math.random()*200)+1}`;
    const response = await auth.handler(new Request(`${origin}/api/auth/sign-up/email`, { method: 'POST', headers: { origin, 'x-forwarded-for': ip, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Pessoa de teste', email, password, officeName: 'Escritório de teste' }) }));
    assert.equal(response.status, 200, await response.clone().text());
    const { user } = await response.json();
    const cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join(';');
    const session = await (await auth.handler(new Request(`${origin}/api/auth/get-session`, { headers: { cookie, 'x-forwarded-for': ip } }))).json();
    return { user, cookie, auth, context: { userId: user.id, sessionId: session.session.id } satisfies portal.ClientContext };
  }
  const attorney = await signup(`${randomUUID()}@office.test`);
  const office = await findOfficeForUser(testDb, attorney.user.id); assert.ok(office);
  const context: WorkspaceContext = { ...attorney.context, officeId: office.officeId };
  const email = `${randomUUID()}@client.test`;
  const { client: { id: clientId } } = await agenda.createClient(context, { name: 'Cliente Maria', email, stage: 'active', idempotencyKey });
  const invited = await portal.invitePortal(context, { clientId, email, version: 0 });
  const token = invited.invitationPath.split('/').at(-1); assert.ok(token);
  const client = await withClientRegistration(token, () => signup(email));
  assert.ok(invited.access);
  return { context, clientId, client: client.context, clientAuth: client, staffAuth: attorney, accessId: invited.access.id, signup, token };
}
async function file(name = 'contrato.pdf') { const pdf = await PDFDocument.create(); pdf.addPage(); return new File([new Uint8Array(await pdf.save())], name, { type: 'application/pdf' }); }

test('portal shows only explicitly published files and charges; a proof never settles a fee', async () => {
  const f = await fixture();
  assert.equal((await portal.portalChoices(f.client)).accesses.length, 1);
  assert.equal((await portal.clientPortal(f.client, f.accessId)).files.length, 0);
  const pdf = await file(); const key = randomUUID();
  const published = await portal.publishPortalFile(f.context, f.clientId, pdf, key);
  assert.deepEqual(await portal.publishPortalFile(f.context, f.clientId, pdf, key), published);
  const detail = await honorarios.createHonorario(f.context, { clientId: f.clientId, title: 'Contrato', notes: 'Observação financeira privada', installments: [{ amountCents: 10000, dueOn: '2035-01-10' }], idempotencyKey: randomUUID() });
  const id = detail.installments[0].id;
  const charge = await prepareCharge(f.context, { installmentId: id, version: 0, pixKey: 'financeiro@office.test', idempotencyKey: randomUUID() });
  assert.equal((await portal.clientPortal(f.client, f.accessId)).charges.length, 0);
  await portal.publishPortalCharge(f.context, { clientId: f.clientId, installmentId: id, version: charge.version });
  const view = await portal.clientPortal(f.client, f.accessId);
  assert.equal(view.files.length, 1); assert.equal(view.charges.length, 1); assert.equal(view.charges[0].pendingCents, 10000);
  assert.equal(JSON.stringify(view).includes('Observação financeira privada'), false);
  const proof = await portal.uploadClientFile(f.client, f.accessId, await file('comprovante.pdf'), randomUUID(), id);
  assert.equal((await portal.managePortal(f.context, f.clientId)).files.find(row => row.id === proof.id)?.kind, 'proof');
  assert.equal((await honorarios.getHonorario(f.context, { agreementId: detail.agreement.id })).agreement.receivedCents, 0);
  assert.equal((await portal.downloadManagedFile(f.context, f.clientId, proof.id)).mimeType, 'application/pdf');
  await portal.withdrawPortalCharge(f.context, { clientId: f.clientId, installmentId: id, version: charge.version });
  assert.equal((await portal.clientPortal(f.client, f.accessId)).charges.length, 0);
  await portal.removePortalFile(f.context, f.clientId, published.id);
  await assert.rejects(portal.downloadClientFile(f.client, f.accessId, published.id), { code: 'NOT_FOUND' });
});

test('a client created from the clients screen, whose idempotencyKey makes the id a sha256 hex, gets management, invitation, published files, charges and uploads', async () => {
  const f = await fixture(randomUUID());
  assert.equal(f.clientId.length, 64);
  const management = await portal.managePortal(f.context, f.clientId); assert.equal(management.access?.state, 'active');
  const published = await portal.publishPortalFile(f.context, f.clientId, await file(), randomUUID());
  assert.deepEqual((await portal.clientPortal(f.client, f.accessId)).files.map(row => row.id), [published.id]);
  const detail = await honorarios.createHonorario(f.context, { clientId: f.clientId, title: 'Contrato', notes: 'Nota interna', installments: [{ amountCents: 10000, dueOn: '2035-01-10' }], idempotencyKey: randomUUID() });
  const id = detail.installments[0].id;
  const charge = await prepareCharge(f.context, { installmentId: id, version: 0, pixKey: 'financeiro@office.test', idempotencyKey: randomUUID() });
  await portal.publishPortalCharge(f.context, { clientId: f.clientId, installmentId: id, version: charge.version });
  assert.equal((await portal.clientPortal(f.client, f.accessId)).charges[0]?.id, id);
  const proof = await portal.uploadClientFile(f.client, f.accessId, await file('comprovante.pdf'), randomUUID(), id);
  assert.equal((await portal.managePortal(f.context, f.clientId)).files.find(row => row.id === proof.id)?.kind, 'proof');
  await portal.withdrawPortalCharge(f.context, { clientId: f.clientId, installmentId: id, version: charge.version });
  await portal.removePortalFile(f.context, f.clientId, published.id);
  await assert.rejects(portal.downloadClientFile(f.client, f.accessId, published.id), { code: 'NOT_FOUND' });
  await portal.revokePortal(f.context, { clientId: f.clientId, version: management.access!.version });
  await assert.rejects(portal.clientPortal(f.client, f.accessId), { code: 'NOT_FOUND' });
});

test('portal blocks foreign clients, offices, fees, replaced invitations and revoked sessions', async () => {
  const f = await fixture(), other = await fixture();
  const published = await portal.publishPortalFile(f.context, f.clientId, await file(), randomUUID());
  await assert.rejects(portal.clientPortal(other.client, f.accessId), { code: 'NOT_FOUND' });
  await assert.rejects(portal.downloadClientFile(other.client, other.accessId, published.id), { code: 'NOT_FOUND' });
  await assert.rejects(portal.managePortal(other.context, f.clientId), { code: 'NOT_FOUND' });
  await assert.rejects(portal.uploadClientFile(f.client, f.accessId, await file(), randomUUID(), randomUUID()), { code: 'NOT_FOUND' });
  await assert.rejects(acceptPortalInvitation(testDb, f.token, { id: other.client.userId, email: 'wrong@client.test' }), { code: 'NOT_FOUND' });
  const management = await portal.managePortal(f.context, f.clientId); assert.ok(management.access);
  const invitation = await portal.invitePortal(f.context, { clientId: f.clientId, email: `${randomUUID()}@client.test`, version: management.access.version });
  assert.ok(invitation.access);
  await assert.rejects(portal.clientPortal(f.client, f.accessId), { code: 'NOT_FOUND' });
  await portal.revokePortal(f.context, { clientId: f.clientId, version: invitation.access.version });
  const token = invitation.invitationPath.split('/').at(-1); assert.ok(token);
  await assert.rejects(acceptPortalInvitation(testDb, token, { id: other.client.userId, email: invitation.access.email }), { code: 'NOT_FOUND' });
  await testDb.prepare('DELETE FROM session WHERE id=?').run(other.client.sessionId);
  await assert.rejects(portal.portalChoices(other.client), { code: 'UNAUTHENTICATED' });
});

test('a file read paused in storage cannot complete after the portal access is revoked', async () => {
  const f = await fixture();
  const published = await portal.publishPortalFile(f.context, f.clientId, await file(), randomUUID());
  const storage = await objectStorage();
  let entered!: () => void, resume!: () => void;
  const enteredPromise = new Promise<void>(resolve => { entered = resolve; });
  const release = new Promise<void>(resolve => { resume = resolve; });
  resetObjectStorageForTests({ put: storage.put.bind(storage), delete: storage.delete.bind(storage), get: async key => { entered(); await release; return storage.get(key); } });
  try {
    const downloading = portal.downloadClientFile(f.client, f.accessId, published.id);
    await enteredPromise;
    const manage = await portal.managePortal(f.context, f.clientId); assert.ok(manage.access);
    await portal.revokePortal(f.context, { clientId: f.clientId, version: manage.access.version });
    resume(); await assert.rejects(downloading, { code: 'NOT_FOUND' });
  } finally { resume(); resetObjectStorageForTests(storage); }
});

async function waitForLock(holder: PoolClient, fragment: string) {
  for (let i = 0; i < 250; i++) {
    await holder.query('SELECT pg_stat_clear_snapshot()');
    const rows = await holder.query("SELECT 1 FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND wait_event_type='Lock' AND position($1 in query)>0", [fragment]);
    if (rows.rowCount) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.fail(`The actual production operation did not wait at ${fragment}`);
}

test('actual upload and renewal use one gate/parent/access ordering during an INSERT wait', { timeout: 15_000 }, async () => {
  const f = await fixture(), holder = await (await authStore()).connect();
  const version = (await portal.managePortal(f.context, f.clientId)).access!.version;
  let upload: Promise<PromiseSettledResult<unknown>[]> | undefined, renew: Promise<PromiseSettledResult<unknown>[]> | undefined;
  try {
    await holder.query('BEGIN'); await holder.query('LOCK TABLE client_portal_file IN SHARE MODE');
    upload = Promise.allSettled([portal.uploadClientFile(f.client, f.accessId, await file(), randomUUID(), null)]);
    await waitForLock(holder, 'INSERT INTO client_portal_file');
    renew = Promise.allSettled([portal.invitePortal(f.context, { clientId: f.clientId, email: 'renewed@example.test', version })]);
    await waitForLock(holder, 'pg_advisory_xact_lock(');
    await holder.query('COMMIT');
    assert.equal((await upload)[0].status, 'fulfilled');
    const result = (await renew)[0]; assert.equal(result.status, 'fulfilled', result.status === 'rejected' ? String(result.reason) : 'renewal completed');
    await assert.rejects(portal.uploadClientFile(f.client, f.accessId, await file(), randomUUID(), null), { code: 'NOT_FOUND' });
  } finally { await holder.query('ROLLBACK').catch(() => undefined); holder.release(); await upload; await renew; }
});

for (const actor of ['staff', 'client'] as const) test(`actual ${actor} writer refuses natural session expiry after authorization and INSERT wait`, { timeout: 15_000 }, async () => {
  const f = await fixture(), holder = await (await authStore()).connect();
  const sessionId = actor === 'staff' ? f.context.sessionId! : f.client.sessionId;
  await testDb.prepare('UPDATE session SET expiresAt=clock_timestamp()+INTERVAL \'2 seconds\' WHERE id=?').run(sessionId);
  let pending: Promise<PromiseSettledResult<unknown>[]> | undefined;
  try {
    await holder.query('BEGIN'); await holder.query('LOCK TABLE client_portal_file IN SHARE MODE');
    const pdf = await file();
    pending = Promise.allSettled([actor === 'staff' ? portal.publishPortalFile(f.context, f.clientId, pdf, randomUUID()) : portal.uploadClientFile(f.client, f.accessId, pdf, randomUUID(), null)]);
    await waitForLock(holder, 'INSERT INTO client_portal_file');
    for (let i = 0; i < 200; i++) {
      const expired = await holder.query('SELECT "expiresAt"<clock_timestamp() AS expired FROM session WHERE id=$1', [sessionId]);
      if (expired.rows[0].expired) break;
      if (i === 199) assert.fail('Session did not naturally expire while the real INSERT waited');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    await holder.query('COMMIT');
    const result = (await pending)[0]; assert.equal(result.status, 'rejected');
    if (result.status === 'rejected') assert.equal(result.reason.code, 'UNAUTHENTICATED');
    assert.equal(await testDb.prepare('SELECT 1 FROM client_portal_file WHERE client_id=?').get(f.clientId), undefined);
  } finally { await holder.query('ROLLBACK').catch(() => undefined); holder.release(); await pending; }
});

test('actual client upload rechecks real logout and cancellation after storage staging', async t => {
  const f = await fixture(), storage = await objectStorage(), put = storage.put.bind(storage);
  let entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  t.mock.method(storage, 'put', async (key: string, bytes: Buffer) => { await put(key, bytes); entered.resolve(); await release.promise; });
  const cancelled = new AbortController();
  const denial = assert.rejects(portal.uploadClientFile({ ...f.client, signal: cancelled.signal }, f.accessId, await file(), randomUUID(), null), /cancelled/);
  await entered.promise; cancelled.abort(new Error('cancelled')); release.resolve(); await denial;
  entered = Promise.withResolvers<void>(); release = Promise.withResolvers<void>();
  const logout = assert.rejects(portal.uploadClientFile(f.client, f.accessId, await file(), randomUUID(), null), { code: 'UNAUTHENTICATED' });
  await entered.promise;
  assert.equal((await f.clientAuth.auth.handler(new Request(`${origin}/api/auth/sign-out`, { method: 'POST', headers: { origin, cookie: f.clientAuth.cookie, 'content-type': 'application/json' }, body: '{}' }))).status, 200);
  release.resolve(); await logout;
  assert.equal(await testDb.prepare('SELECT 1 FROM client_portal_file WHERE client_id=?').get(f.clientId), undefined);
});

test('actual invitation acceptance, renewal and revoke serialize behind the FK parent without deadlock', { timeout: 15_000 }, async () => {
  const f = await fixture(), holder = await (await authStore()).connect();
  const email = f.clientAuth.user.email;
  const invitation = await portal.invitePortal(f.context, { clientId: f.clientId, email, version: (await portal.managePortal(f.context, f.clientId)).access!.version });
  const token = invitation.invitationPath.split('/').at(-1)!;
  let acceptance: Promise<PromiseSettledResult<unknown>[]> | undefined, renewal: Promise<PromiseSettledResult<unknown>[]> | undefined;
  try {
    await holder.query('BEGIN'); await holder.query('SELECT id FROM crm_client WHERE id=$1 FOR UPDATE', [f.clientId]);
    acceptance = Promise.allSettled([acceptPortalInvitation(testDb, token, f.clientAuth.user, { id: f.client.sessionId })]);
    await waitForLock(holder, 'SELECT id FROM crm_client');
    renewal = Promise.allSettled([portal.invitePortal(f.context, { clientId: f.clientId, email, version: invitation.access!.version })]);
    await waitForLock(holder, 'pg_advisory_xact_lock(');
    await holder.query('COMMIT');
    assert.equal((await acceptance)[0].status, 'fulfilled');
    const result = (await renewal)[0]; assert.equal(result.status, 'fulfilled');
    const access = (await portal.managePortal(f.context, f.clientId)).access!;
    await portal.revokePortal(f.context, { clientId: f.clientId, version: access.version });
    await assert.rejects(acceptPortalInvitation(testDb, token, f.clientAuth.user, { id: f.client.sessionId }), { code: 'NOT_FOUND' });
  } finally { await holder.query('ROLLBACK').catch(() => undefined); holder.release(); await acceptance; await renewal; }
});

test('actual invitation acceptance refuses natural invitation expiry after a parent lock wait', { timeout: 15_000 }, async () => {
  const f = await fixture(), holder = await (await authStore()).connect();
  const invitation = await portal.invitePortal(f.context, { clientId: f.clientId, email: f.clientAuth.user.email, version: (await portal.managePortal(f.context, f.clientId)).access!.version });
  await testDb.prepare("UPDATE client_portal_access SET expires_at=clock_timestamp()+INTERVAL '2 seconds' WHERE id=?").run(f.accessId);
  let acceptance: Promise<PromiseSettledResult<unknown>[]> | undefined;
  try {
    await holder.query('BEGIN'); await holder.query('SELECT id FROM crm_client WHERE id=$1 FOR UPDATE', [f.clientId]);
    acceptance = Promise.allSettled([acceptPortalInvitation(testDb, invitation.invitationPath.split('/').at(-1)!, f.clientAuth.user, { id: f.client.sessionId })]);
    await waitForLock(holder, 'SELECT id FROM crm_client');
    for (let i = 0; i < 200; i++) {
      const expired = await holder.query('SELECT expires_at<clock_timestamp() AS expired FROM client_portal_access WHERE id=$1', [f.accessId]);
      if (expired.rows[0].expired) break;
      if (i === 199) assert.fail('Invitation did not naturally expire during the production parent wait');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    await holder.query('COMMIT'); const result = (await acceptance)[0]; assert.equal(result.status, 'rejected');
    if (result.status === 'rejected') assert.equal(result.reason.code, 'NOT_FOUND');
    assert.equal((await portal.managePortal(f.context, f.clientId)).access!.acceptedAt, null);
  } finally { await holder.query('ROLLBACK').catch(() => undefined); holder.release(); await acceptance; }
});

test('real logout and revoke wait behind an authorized upload and prevent all later access', { timeout: 15_000 }, async () => {
  for (const mutation of ['logout', 'revoke'] as const) {
    const f = await fixture(), holder = await (await authStore()).connect();
    const version = (await portal.managePortal(f.context, f.clientId)).access!.version;
    let upload: Promise<PromiseSettledResult<unknown>[]> | undefined, revocation: Promise<PromiseSettledResult<unknown>[]> | undefined;
    try {
      await holder.query('BEGIN'); await holder.query('LOCK TABLE client_portal_file IN SHARE MODE');
      upload = Promise.allSettled([portal.uploadClientFile(f.client, f.accessId, await file(), randomUUID(), null)]);
      await waitForLock(holder, 'INSERT INTO client_portal_file');
      revocation = Promise.allSettled([mutation === 'logout'
        ? f.clientAuth.auth.handler(new Request(`${origin}/api/auth/sign-out`, { method: 'POST', headers: { origin, cookie: f.clientAuth.cookie, 'content-type': 'application/json' }, body: '{}' }))
        : portal.revokePortal(f.context, { clientId: f.clientId, version })]);
      await waitForLock(holder, mutation === 'logout' ? 'delete from "session"' : 'pg_advisory_xact_lock(');
      await holder.query('COMMIT');
      assert.equal((await upload)[0].status, 'fulfilled');
      const result = (await revocation)[0]; assert.equal(result.status, 'fulfilled');
      if (mutation === 'logout' && result.status === 'fulfilled') assert.equal((result.value as Response).status, 200);
      await assert.rejects(portal.clientPortal(f.client, f.accessId), { code: mutation === 'logout' ? 'UNAUTHENTICATED' : 'NOT_FOUND' });
    } finally { await holder.query('ROLLBACK').catch(() => undefined); holder.release(); await upload; await revocation; }
  }
});
