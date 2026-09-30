import { testDb } from './test-setup';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { authStore } from '../src/lib/database';
import { createAuth } from '../src/lib/auth-core';
import { withClientRegistration } from '../src/lib/client-portal/registration';
import { acceptPortalInvitation } from '../src/lib/client-portal/invitations';
import * as portal from '../src/lib/client-portal/service';
import * as honorarios from '../src/lib/honorarios/service';
import { prepareCharge } from '../src/lib/honorarios/charges';
import { findOfficeForUser } from '../src/lib/offices';
import { objectStorage, resetObjectStorageForTests } from '../src/lib/storage';
import type { WorkspaceContext } from '../src/lib/application/context';

const origin = 'http://localhost:3000', password = 'Senha-segura-2026!';
async function fixture() {
  const auth = createAuth(await authStore(), testDb, { secret: randomBytes(48).toString('base64url'), baseURL: origin, idleSeconds: 3600 });
  async function signup(email: string) {
    const response = await auth.handler(new Request(`${origin}/api/auth/sign-up/email`, { method: 'POST', headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Pessoa de teste', email, password, officeName: 'Escritório de teste' }) }));
    assert.equal(response.status, 200, await response.clone().text());
    const { user } = await response.json();
    const cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join(';');
    const session = await (await auth.handler(new Request(`${origin}/api/auth/get-session`, { headers: { cookie } }))).json();
    return { user, context: { userId: user.id, sessionId: session.session.id } satisfies portal.ClientContext };
  }
  const attorney = await signup(`${randomUUID()}@office.test`);
  const office = await findOfficeForUser(testDb, attorney.user.id); assert.ok(office);
  const context: WorkspaceContext = { ...attorney.context, officeId: office.officeId, role: office.role };
  const clientId = randomUUID(), email = `${randomUUID()}@client.test`;
  await testDb.prepare("INSERT INTO crm_client(id,office_id,name,email,stage,created_at,updated_at) VALUES(?,?,?,?, 'active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)").run(clientId, context.officeId, 'Cliente Maria', email);
  const invited = await portal.invitePortal(context, { clientId, email, version: 0 });
  const token = invited.invitationPath.split('/').at(-1); assert.ok(token);
  const client = await withClientRegistration(token, () => signup(email));
  assert.ok(invited.access);
  return { context, clientId, client: client.context, accessId: invited.access.id, signup, token };
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
