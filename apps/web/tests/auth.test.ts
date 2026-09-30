import { postgresFixture } from './postgres-fixture';
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import { createAuth } from "../src/lib/auth-core";
import { ensureOfficeForUser, findOfficeForUser, selectedOfficeForUser, listOfficesForUser } from "../src/lib/offices";
import { withClientRegistration } from '../src/lib/client-portal/registration';
import { invitationHash } from '../src/lib/client-portal/invitations';

const origin = "http://localhost:3000";
const password = "Senha-teste-2026!";

test('portal registration binds the invitation through Better Auth without office provisioning', async () => {
  const { db, database, request, signup } = await fixture();
  const attorney = await signup('attorney@portal.test');
  const office = await findOfficeForUser(db, attorney.data.user.id); assert.ok(office);
  const clientId = randomUUID(), accessId = randomUUID(), token = randomBytes(32).toString('base64url');
  await db.prepare("INSERT INTO crm_client(id,office_id,name,stage,created_at,updated_at) VALUES(?,?,?,'active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)").run(clientId, office.officeId, 'Cliente');
  await db.prepare("INSERT INTO client_portal_access(id,office_id,client_id,email,token_hash,expires_at,invited_by) VALUES(?,?,?,?,?,CURRENT_TIMESTAMP+INTERVAL '1 day',?)")
    .run(accessId, office.officeId, clientId, 'client@portal.test', invitationHash(token), attorney.data.user.id);
  const result = await withClientRegistration(token, () => signup('client@portal.test', { officeName: 'Portal do cliente' }));
  const session = (await request('/get-session', undefined, result.cookie)).data;
  assert.equal(session.user.accountKind, 'client');
  assert.equal(await findOfficeForUser(db, result.data.user.id), undefined);
  await assert.rejects(ensureOfficeForUser(database, { id: result.data.user.id, officeName: 'Escritório indevido' }), { code: 'FORBIDDEN' });
  await assert.rejects(selectedOfficeForUser(database, session.user, office.officeId), { code: 'FORBIDDEN' });
  assert.equal((await db.prepare('SELECT user_id FROM client_portal_access WHERE id=?').get(accessId))?.user_id, result.data.user.id);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM office').get())?.n, 1);
  const second = await request('/sign-in/email', { email: 'client@portal.test', password });
  await request('/sign-out', {}, result.cookie);
  assert.equal((await request('/get-session', undefined, second.cookie)).data, null);
});

test('password recovery uses one-time Better Auth tokens and revokes every previous session', async () => {
  const deliveries: string[] = [];
  const { request, signup } = await fixture(undefined, { enabled: () => true, send: async input => { deliveries.push(input.url); } });
  const first = await signup('recover@portal.test');
  const second = await request('/sign-in/email', { email: 'recover@portal.test', password });
  assert.equal((await request('/request-password-reset', { email: 'unknown@portal.test', redirectTo: `${origin}/client/reset-password` })).response.status, 200);
  assert.equal(deliveries.length, 0);
  assert.equal((await request('/request-password-reset', { email: 'recover@portal.test', redirectTo: `${origin}/client/reset-password` })).response.status, 200);
  assert.equal(deliveries.length, 1);
  const token = new URL(deliveries[0]).pathname.split('/').at(-1);
  const reset = await request('/reset-password', { token, newPassword: 'Nova-senha-segura-2026!' });
  assert.equal(reset.response.status, 200);
  assert.equal((await request('/get-session', undefined, first.cookie)).data, null);
  assert.equal((await request('/get-session', undefined, second.cookie)).data, null);
  assert.ok((await request('/reset-password', { token, newPassword: password })).response.status >= 400);
  assert.equal((await request('/sign-in/email', { email: 'recover@portal.test', password: 'Nova-senha-segura-2026!' })).response.status, 200);
});

test('disabled password delivery does not disclose whether an address is registered', async () => {
  const { request, signup } = await fixture(); await signup();
  for (const email of ['ana@example.test','unknown@example.test']) assert.equal((await request('/request-password-reset', { email, redirectTo: `${origin}/client/reset-password` })).response.status, 503);
});

test('sessão autenticada seleciona apenas vínculos atuais e preserva o escritório original', async () => {
  const { db, request, signup } = await fixture();
  const first = await signup('first@multi.test');
  const second = await signup('second@multi.test');
  const user = (await request('/get-session', undefined, first.cookie)).data.user;
  const original = (await findOfficeForUser(db, user.id))!;
  const invited = (await findOfficeForUser(db, second.data.user.id))!;
  await db.prepare('INSERT INTO office_member(id,office_id,user_id,role) VALUES(?,?,?,?)').run(randomUUID(), invited.officeId, user.id, 'reviewer');
  assert.equal((await listOfficesForUser(db, user.id)).length, 2);
  assert.equal((await selectedOfficeForUser(db, user, invited.officeId)).role, 'reviewer');
  await db.prepare('DELETE FROM office_member WHERE office_id=? AND user_id=?').run(invited.officeId, user.id);
  assert.equal((await selectedOfficeForUser(db, user, invited.officeId)).officeId, original.officeId);
  assert.ok((await request('/get-session', undefined, first.cookie)).data.user);
  await request('/sign-out', {}, first.cookie);
  assert.equal((await request('/get-session', undefined, first.cookie)).data, null);
});

async function fixture(ipHeaders?: string[], passwordReset?: Parameters<typeof createAuth>[2]['passwordReset']) {
  const { db, database, pool } = await postgresFixture({seedDefaults:false});
  const auth = createAuth(pool, database, { secret: randomBytes(48).toString("base64url"), baseURL: origin, idleSeconds: 3600, ipHeaders, passwordReset });
  async function request(path: string, body?: object, cookie = "", requestOrigin = origin, connectingIp?: string) {
    const response = await auth.handler(new Request(`${origin}/api/auth${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        "content-type": "application/json",
        origin: requestOrigin,
        cookie,
        ...(connectingIp ? { "cf-connecting-ip": connectingIp } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    }));
    const cookies = response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    return { response, cookie: cookies, data: await response.json() };
  }
  async function signup(email = "ana@example.test", extra: object = {}) {
    const result = await request("/sign-up/email", { name: "Ana Silva", officeName: "Silva Advocacia", email, password, ...extra });
    assert.equal(result.response.status, 200, JSON.stringify(result.data));
    return result;
  }
  return { db, database, auth, request, signup };
}

test("cadastro cria sessão, hash forte e escritório com administrador", async (t) => {
  const { db, database, request, signup } = await fixture();
  t.after(async () => (await db.close()));
  const result = await signup();
  assert.match(result.response.headers.get("set-cookie") ?? "", /HttpOnly/i);
  assert.match(result.response.headers.get("set-cookie") ?? "", /SameSite=Lax/i);
  const session = await request("/get-session", undefined, result.cookie);
  assert.equal(session.data.user.email, "ana@example.test");
  const account = (await db.prepare("SELECT password FROM account").get());
  assert.ok(account?.password);
  assert.notEqual(account.password, password);
  assert.ok(String(account.password).length > 80);
  const office = await findOfficeForUser(database, result.data.user.id);
  assert.equal(office?.officeName, "Silva Advocacia");
  assert.equal(office?.role, "administrator");
  await ensureOfficeForUser(database, { id: result.data.user.id, officeName: "Não deve duplicar" });
  assert.equal((await db.prepare("SELECT count(*) AS total FROM office").get())?.total, 1);
});

test("dados inválidos e e-mail duplicado não criam contas ou escritórios extras", async (t) => {
  const { db, request, signup } = await fixture();
  t.after(async () => (await db.close()));
  for (const extra of [{ officeName: " " }, { name: " " }, { email: "invalido" }, { password: "123" }]) {
    const result = await request("/sign-up/email", { name: "Ana Silva", officeName: "Silva Advocacia", email: "ana@example.test", password, ...extra });
    assert.ok(result.response.status >= 400);
  }
  assert.equal((await db.prepare("SELECT count(*) AS total FROM user").get())?.total, 0);
  await signup();
  const duplicate = await request("/sign-up/email", { name: "Outra pessoa", officeName: "Outro escritório", email: "ANA@example.test", password });
  assert.ok(duplicate.response.status >= 400);
  assert.equal((await db.prepare("SELECT count(*) AS total FROM user").get())?.total, 1);
  assert.equal((await db.prepare("SELECT count(*) AS total FROM office").get())?.total, 1);
});

test("login recusa senha incorreta e aceita credenciais válidas", async (t) => {
  const { db, request, signup } = await fixture();
  t.after(async () => (await db.close()));
  await signup();
  const rejected = await request("/sign-in/email", { email: "ana@example.test", password: "senha-incorreta" });
  assert.equal(rejected.response.status, 401);
  assert.equal(rejected.data.code, "INVALID_EMAIL_OR_PASSWORD");
  const accepted = await request("/sign-in/email", { email: "ana@example.test", password });
  assert.equal(accepted.response.status, 200);
  assert.ok((await request("/get-session", undefined, accepted.cookie)).data.user);
});

test("escritório A não acessa B e cadastro não aceita escritório ou papel fornecido pelo cliente", async (t) => {
  const { db, database, signup } = await fixture();
  t.after(async () => (await db.close()));
  const a = await signup();
  const officeA = (await findOfficeForUser(database, a.data.user.id))!;
  const b = await signup("bruno@example.test", { officeName: "Bruno Advocacia", officeId: officeA.officeId, role: "reviewer" });
  const officeB = (await findOfficeForUser(database, b.data.user.id))!;
  assert.notEqual(officeA.officeId, officeB.officeId);
  assert.equal(officeB.role, "administrator");
  assert.equal(await findOfficeForUser(database, a.data.user.id, officeB.officeId), undefined);
  assert.equal(await findOfficeForUser(database, b.data.user.id, officeA.officeId), undefined);
  assert.equal(await findOfficeForUser(database, "usuario-inexistente", officeA.officeId), undefined);
  await assert.rejects(async () => (await db.prepare("UPDATE office_member SET role = 'superadmin'").run()));
});

test("logout invalida todos os dispositivos do usuário e preserva outras contas", async (t) => {
  const { db, request, signup } = await fixture();
  t.after(async () => (await db.close()));
  const first = await signup();
  const second = await request("/sign-in/email", { email: "ana@example.test", password });
  const other = await signup("bruno@example.test");
  assert.equal((await request("/sign-out", {}, first.cookie)).response.status, 200);
  assert.equal((await request("/get-session", undefined, first.cookie)).data, null);
  assert.equal((await request("/get-session", undefined, second.cookie)).data, null);
  assert.ok((await request("/get-session", undefined, other.cookie)).data.user);
});

test("sessões ausentes, forjadas e expiradas não autenticam; uso renova a validade", async (t) => {
  const { db, request, signup } = await fixture();
  t.after(async () => (await db.close()));
  assert.equal((await request("/get-session")).data, null);
  assert.equal((await request("/get-session", undefined, "better-auth.session_token=inventado")).data, null);
  const result = await signup();
  const original = new Date(String((await db.prepare("SELECT expiresAt FROM session").get())!.expiresAt)).getTime();
  (await db.prepare("UPDATE session SET expiresAt = ?, updatedAt = ?").run(new Date(original - 600000).toISOString(), new Date(Date.now() - 600000).toISOString()));
  await request("/get-session", undefined, result.cookie);
  assert.ok(new Date(String((await db.prepare("SELECT expiresAt FROM session").get())!.expiresAt)).getTime() > original - 600000);
  (await db.prepare("UPDATE session SET expiresAt = ?").run(new Date(Date.now() - 1000).toISOString()));
  assert.equal((await request("/get-session", undefined, result.cookie)).data, null);
});

test("requisições de outra origem são recusadas", async (t) => {
  const { db, request } = await fixture();
  t.after(async () => (await db.close()));
  const result = await request("/sign-up/email", { name: "Ana Silva", officeName: "Silva Advocacia", email: "ana@example.test", password }, "", "https://outra-origem.example");
  assert.equal(result.response.status, 403);
  assert.equal((await db.prepare("SELECT count(*) AS total FROM user").get())?.total, 0);
});

test("limita tentativas repetidas de login", async (t) => {
  const { db, request } = await fixture();
  t.after(async () => (await db.close()));
  for (let attempt = 0; attempt < 10; attempt++) {
    assert.equal((await request("/sign-in/email", { email: "ausente@example.test", password }, "", origin, "203.0.113.10")).response.status, 401);
  }
  assert.equal((await request("/sign-in/email", { email: "ausente@example.test", password }, "", origin, "203.0.113.10")).response.status, 429);
  assert.equal((await request("/sign-in/email", { email: "ausente@example.test", password }, "", origin, "203.0.113.11")).response.status, 401);
});

test("fora da Cloudflare, cf-connecting-ip forjado não abre um limite novo", async (t) => {
  const { db, request } = await fixture([]);
  t.after(async () => (await db.close()));
  for (let attempt = 0; attempt < 10; attempt++) {
    assert.equal((await request("/sign-in/email", { email: "ausente@example.test", password }, "", origin, `203.0.113.${attempt}`)).response.status, 401);
  }
  assert.equal((await request("/sign-in/email", { email: "ausente@example.test", password }, "", origin, "203.0.113.99")).response.status, 429);
});

test("logout revoga sessões mesmo quando a limpeza de push falha", async (t) => {
  const { db, database, auth, request, signup } = await fixture();
  t.after(async () => (await db.close()));
  const first = await signup();
  const second = await request("/sign-in/email", { email: first.data.user.email, password });
  const prepare = database.prepare.bind(database);
  t.mock.method(database, "prepare", (sql: string) => {
    if (sql.includes("FROM push_subscription")) throw new Error("push cleanup unavailable");
    return prepare(sql);
  });
  const response = await auth.handler(new Request(`${origin}/api/auth/sign-out`, {
    method: 'POST', headers: { origin, cookie: first.cookie, 'content-type': 'application/json' }, body: '{}',
  }));
  assert.equal(response.status, 500);
  assert.equal((await db.prepare('SELECT count(*) AS total FROM session WHERE "userId"=?').get(first.data.user.id))!.total, 0);
  assert.equal((await request("/get-session", undefined, second.cookie)).data, null);
});

test("logout de outra origem não encerra a sessão legítima", async (t) => {
  const { db, request, signup } = await fixture();
  t.after(async () => (await db.close()));
  const user = await signup();
  const result = await request("/sign-out", {}, user.cookie, "https://outra-origem.example");
  assert.equal(result.response.status, 403);
  assert.ok((await request("/get-session", undefined, user.cookie)).data?.user);
});

test("troca de e-mail exige a senha atual e não assume endereço de outra conta", async (t) => {
  const { db, request, signup } = await fixture();
  t.after(async () => (await db.close()));
  const ana = await signup("ana@example.test");
  await signup("bia@example.test");
  const denied = await request("/change-email", { newEmail: "ana.nova@example.test" }, ana.cookie);
  assert.equal(denied.response.status, 400);
  assert.equal(denied.data.code, "INVALID_PASSWORD");
  const wrong = await request("/change-email", { newEmail: "ana.nova@example.test", currentPassword: "Errada-2026!" }, ana.cookie);
  assert.equal(wrong.data.code, "INVALID_PASSWORD");
  assert.equal((await request("/get-session", undefined, ana.cookie)).data.user.email, "ana@example.test");
  const taken = await request("/change-email", { newEmail: "bia@example.test", currentPassword: password }, ana.cookie);
  assert.equal(taken.response.status, 200);
  assert.equal((await request("/get-session", undefined, ana.cookie)).data.user.email, "ana@example.test");
  const changed = await request("/change-email", { newEmail: "Ana.Nova@example.test", currentPassword: password }, ana.cookie);
  assert.equal(changed.response.status, 200, JSON.stringify(changed.data));
  assert.equal((await request("/get-session", undefined, ana.cookie)).data.user.email, "ana.nova@example.test");
  assert.equal((await request("/sign-in/email", { email: "ana@example.test", password })).response.status, 401);
  assert.equal((await request("/sign-in/email", { email: "ana.nova@example.test", password })).response.status, 200);
});

test("troca de senha confere a atual e pode encerrar as outras sessões", async (t) => {
  const { db, request, signup } = await fixture();
  t.after(async () => (await db.close()));
  const phone = await signup("ana@example.test");
  const laptop = await request("/sign-in/email", { email: "ana@example.test", password });
  const wrong = await request("/change-password", { currentPassword: "Errada-2026!", newPassword: "Nova-senha-2026!" }, laptop.cookie);
  assert.equal(wrong.data.code, "INVALID_PASSWORD");
  const changed = await request("/change-password", { currentPassword: password, newPassword: "Nova-senha-2026!", revokeOtherSessions: true }, laptop.cookie);
  assert.equal(changed.response.status, 200, JSON.stringify(changed.data));
  assert.equal((await request("/get-session", undefined, phone.cookie)).data, null);
  // The response refreshes the old cookie before setting the new session; the browser keeps the last one.
  const current = changed.cookie.split("; ").at(-1);
  assert.ok((await request("/get-session", undefined, current)).data.user);
  assert.equal((await request("/sign-in/email", { email: "ana@example.test", password })).response.status, 401);
  assert.equal((await request("/sign-in/email", { email: "ana@example.test", password: "Nova-senha-2026!" })).response.status, 200);
});
