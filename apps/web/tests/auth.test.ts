import './server-only-fixture';
import { postgresFixture } from './postgres-fixture';
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import { createAuth } from "../src/lib/auth-core";
import { ensureOfficeForUser, findOfficeForUser } from "../src/lib/offices";
import { withClientRegistration } from '../src/lib/client-portal/registration';
import { invitationHash } from '../src/lib/client-portal/invitations';
import { hasAcceptedCurrent } from '../src/lib/legal-acceptance';
import { LEGAL_VERSION } from '../src/lib/legal-version';

const origin = "http://localhost:3000";
const password = "Senha-teste-2026!";

test('a real Better Auth session expires naturally without an update or logout', async t => {
  const { db, request, signup } = await fixture(undefined, undefined, undefined, undefined, 2);
  t.after(() => db.close());
  const result = await signup();
  assert.ok((await request('/get-session', undefined, result.cookie)).data?.user);
  for (let n = 0; ; n++) {
    const row = await db.prepare('SELECT expiresAt<clock_timestamp() AS expired FROM session WHERE userId=?').get<{ expired: boolean }>(result.data.user.id);
    if (row?.expired) break;
    assert.ok(n < 150, 'The endpoint-issued session must reach its natural expiry');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal((await request('/get-session', undefined, result.cookie)).data, null);
});

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
  assert.equal((await db.prepare('SELECT user_id FROM client_portal_access WHERE id=?').get(accessId))?.user_id, result.data.user.id);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM office').get())?.n, 1);
  const second = await request('/sign-in/email', { email: 'client@portal.test', password });
  await request('/sign-out', {}, result.cookie);
  assert.equal((await request('/get-session', undefined, second.cookie)).data, null);
});

for (const resetPath of ['/reset-password', '/client/reset-password']) {
test(`password recovery through ${resetPath} uses one-time tokens and revokes every previous session`, async () => {
  const deliveries: string[] = [];
  const { request, signup } = await fixture(undefined, { enabled: () => true, send: async input => { deliveries.push(input.url); } });
  const first = await signup('recover@portal.test');
  const second = await request('/sign-in/email', { email: 'recover@portal.test', password });
  assert.equal((await request('/request-password-reset', { email: 'unknown@portal.test', redirectTo: `${origin}${resetPath}` })).response.status, 200);
  assert.equal(deliveries.length, 0);
  assert.equal((await request('/request-password-reset', { email: 'recover@portal.test', redirectTo: `${origin}${resetPath}` })).response.status, 200);
  assert.equal(deliveries.length, 1);
  assert.equal(new URL(deliveries[0]).searchParams.get('callbackURL'), `${origin}${resetPath}`);
  const token = new URL(deliveries[0]).pathname.split('/').at(-1);
  const reset = await request('/reset-password', { token, newPassword: 'Nova-senha-segura-2026!' });
  assert.equal(reset.response.status, 200);
  assert.equal((await request('/get-session', undefined, first.cookie)).data, null);
  assert.equal((await request('/get-session', undefined, second.cookie)).data, null);
  assert.ok((await request('/reset-password', { token, newPassword: password })).response.status >= 400);
  assert.equal((await request('/sign-in/email', { email: 'recover@portal.test', password: 'Nova-senha-segura-2026!' })).response.status, 200);
});
}

test('where e-mail can be delivered, an account signs in only after confirming its address', async () => {
  const links: string[] = [];
  const { auth, db, request } = await fixture(undefined, undefined, { enabled: () => true, send: async input => { links.push(input.url); } });
  const created = await request('/sign-up/email', { name: 'Ana Silva', officeName: 'Silva Advocacia', email: 'confirma@example.test', password, callbackURL: '/app' });
  assert.equal(created.response.status, 200);
  assert.equal(created.data.token, null, 'no session before the address is confirmed');
  assert.equal(created.cookie.includes('session_token'), false);
  assert.equal(links.length, 1);
  assert.ok(await findOfficeForUser(db, created.data.user.id), 'the office exists and waits for its lawyer');

  const refused = await request('/sign-in/email', { email: 'confirma@example.test', password, callbackURL: '/app' });
  assert.equal(refused.response.status, 403);
  assert.equal(refused.data.code, 'EMAIL_NOT_VERIFIED');
  assert.equal(links.length, 2, 'signing in again sends a fresh link');

  const link = new URL(links[1]);
  assert.equal(link.searchParams.get('callbackURL'), '/app');
  const confirmed = await auth.handler(new Request(link, { headers: { origin } }));
  assert.equal(confirmed.status, 302);
  assert.equal(confirmed.headers.get('location'), '/app');
  const cookie = confirmed.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  assert.equal((await request('/get-session', undefined, cookie)).data.user.email, 'confirma@example.test', 'the link signs the person in');
  assert.equal((await request('/sign-in/email', { email: 'confirma@example.test', password })).response.status, 200);
});

test('where e-mail can be delivered, a new address replaces the current one only after opening its link', async () => {
  const sent: Array<{ to: string; url: string; previousEmail?: string }> = [];
  const { auth, request } = await fixture(undefined, undefined, { enabled: () => true, send: async input => { sent.push({ to: input.user.email, url: input.url, previousEmail: input.change?.previousEmail }); } });
  await request('/sign-up/email', { name: 'Ana Silva', officeName: 'Silva Advocacia', email: 'troca@example.test', password });
  const confirmed = await auth.handler(new Request(sent[0].url, { headers: { origin } }));
  const cookie = confirmed.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  assert.equal(sent[0].previousEmail, undefined, 'sign-up is not a change of address');

  const requested = await request('/change-email', { newEmail: 'Troca.Nova@example.test', currentPassword: password, callbackURL: '/app/profile' }, cookie);
  assert.equal(requested.response.status, 200, JSON.stringify(requested.data));
  assert.equal((await request('/get-session', undefined, cookie)).data.user.email, 'troca@example.test', 'nothing changes before the link');
  assert.deepEqual({ to: sent[1].to, previousEmail: sent[1].previousEmail }, { to: 'troca.nova@example.test', previousEmail: 'troca@example.test' });
  assert.equal((await request('/sign-in/email', { email: 'troca@example.test', password })).response.status, 200);

  const opened = await auth.handler(new Request(sent[1].url, { headers: { origin, cookie } }));
  assert.equal(opened.status, 302);
  assert.equal((await request('/sign-in/email', { email: 'troca.nova@example.test', password })).response.status, 200);
  assert.equal((await request('/sign-in/email', { email: 'troca@example.test', password })).response.status, 401);
});

test('with Turnstile on, sign-up needs a token the challenge accepts', async () => {
  const checked: Array<{ token: string; ip: string | null }> = [];
  const { auth, db } = await fixture(['cf-connecting-ip'], undefined, undefined, { enabled: () => true, verify: async (token, ip) => { checked.push({ token, ip }); return token === 'humano'; } });
  const body = JSON.stringify({ name: 'Ana Silva', officeName: 'Silva Advocacia', email: 'desafio@example.test', password });
  const attempt = (token?: string) => auth.handler(new Request(`${origin}/api/auth/sign-up/email`, { method: 'POST', body,
    headers: { 'content-type': 'application/json', origin, 'cf-connecting-ip': '203.0.113.9', ...(token ? { 'x-captcha-response': token } : {}) } }));
  for (const token of [undefined, 'robo']) {
    const refused = await attempt(token);
    assert.equal(refused.status, 400);
    assert.equal((await refused.json()).code, 'CAPTCHA_FAILED');
  }
  assert.equal(await db.prepare("SELECT 1 FROM \"user\" WHERE email='desafio@example.test'").get(), undefined, 'no account without the check');
  assert.equal((await attempt('humano')).status, 200);
  assert.deepEqual(checked.at(-1), { token: 'humano', ip: '203.0.113.9' });
});

test('sign-up records the accepted version of the terms, and only the version this server publishes', async () => {
  const { db, signup } = await fixture();
  const accepted = await signup('aceite@example.test', { acceptedLegalVersion: LEGAL_VERSION });
  const row = await db.prepare("SELECT version FROM legal_acceptance WHERE user_id=? AND document='terms'").get<{ version: string }>(accepted.data.user.id);
  assert.equal(row?.version, LEGAL_VERSION);
  assert.equal(await hasAcceptedCurrent(db, accepted.data.user.id, 'terms'), true);
  const stale = await signup('antiga@example.test', { acceptedLegalVersion: '0.9' });
  const plain = await signup('sem-aceite@example.test');
  for (const user of [stale.data.user.id, plain.data.user.id]) assert.equal(await hasAcceptedCurrent(db, user, 'terms'), false, 'the app asks again on entry');
});

test('disabled password delivery does not disclose whether an address is registered', async () => {
  const { request, signup } = await fixture(); await signup();
  for (const email of ['ana@example.test','unknown@example.test']) assert.equal((await request('/request-password-reset', { email, redirectTo: `${origin}/client/reset-password` })).response.status, 503);
});

test('cada advogado tem um único escritório, e ninguém entra no escritório de outro', async () => {
  const { db, database, request, signup } = await fixture();
  const first = await signup('first@multi.test');
  const second = await signup('second@multi.test');
  const user = (await request('/get-session', undefined, first.cookie)).data.user;
  const original = (await findOfficeForUser(db, user.id))!;
  const other = (await findOfficeForUser(db, second.data.user.id))!;
  await assert.rejects(async () => db.prepare('INSERT INTO office_member(id,office_id,user_id) VALUES(?,?,?)').run(randomUUID(), other.officeId, user.id));
  assert.equal((await ensureOfficeForUser(database, user)).officeId, original.officeId);
  assert.ok((await request('/get-session', undefined, first.cookie)).data.user);
  await request('/sign-out', {}, first.cookie);
  assert.equal((await request('/get-session', undefined, first.cookie)).data, null);
});

async function fixture(ipHeaders?: string[], passwordReset?: Parameters<typeof createAuth>[2]['passwordReset'], emailVerification?: Parameters<typeof createAuth>[2]['emailVerification'], signUpChallenge?: Parameters<typeof createAuth>[2]['signUpChallenge'], idleSeconds = 3600) {
  const { db, database, pool } = await postgresFixture({seedDefaults:false});
  const auth = createAuth(pool, database, { secret: randomBytes(48).toString("base64url"), baseURL: origin, idleSeconds, ipHeaders, passwordReset, emailVerification, signUpChallenge });
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

test("cadastro cria sessão, hash forte e escritório do advogado", async (t) => {
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
  assert.equal(await findOfficeForUser(database, "usuario-inexistente"), undefined);
  assert.equal((await db.prepare("SELECT count(*) AS total FROM office_member WHERE office_id=?").get(officeA.officeId))?.total, 1);
  await assert.rejects(async () => (await db.prepare("UPDATE office_member SET office_id = ? WHERE office_id = ?").run(officeA.officeId, officeB.officeId)));
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
