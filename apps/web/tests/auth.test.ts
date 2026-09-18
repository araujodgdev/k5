import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { getMigrations } from "better-auth/db/migration";
import { createAuth } from "../src/lib/auth-core";
import { ensureOfficeForUser, findOfficeForUser } from "../src/lib/offices";

const origin = "http://localhost:3000";
const password = "Senha-teste-2026!";

async function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  const auth = createAuth(db, { secret: randomBytes(48).toString("base64url"), baseURL: origin, idleSeconds: 3600 });
  await (await getMigrations(auth.options)).runMigrations();
  db.exec(readFileSync(new URL("../db/migrations/0001_offices.sql", import.meta.url), "utf8"));
  async function request(path: string, body?: object, cookie = "", requestOrigin = origin) {
    const response = await auth.handler(new Request(`${origin}/api/auth${path}`, {
      method: body ? "POST" : "GET",
      headers: { "content-type": "application/json", origin: requestOrigin, cookie },
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
  return { db, auth, request, signup };
}

test("cadastro cria sessão, hash forte e escritório com administrador", async (t) => {
  const { db, request, signup } = await fixture();
  t.after(() => db.close());
  const result = await signup();
  assert.match(result.response.headers.get("set-cookie") ?? "", /HttpOnly/i);
  assert.match(result.response.headers.get("set-cookie") ?? "", /SameSite=Lax/i);
  const session = await request("/get-session", undefined, result.cookie);
  assert.equal(session.data.user.email, "ana@example.test");
  const account = db.prepare("SELECT password FROM account").get();
  assert.ok(account?.password);
  assert.notEqual(account.password, password);
  assert.ok(String(account.password).length > 80);
  const office = findOfficeForUser(db, result.data.user.id);
  assert.equal(office?.officeName, "Silva Advocacia");
  assert.equal(office?.role, "administrator");
  ensureOfficeForUser(db, { id: result.data.user.id, officeName: "Não deve duplicar" });
  assert.equal(db.prepare("SELECT count(*) AS total FROM office").get()?.total, 1);
});

test("dados inválidos e e-mail duplicado não criam contas ou escritórios extras", async (t) => {
  const { db, request, signup } = await fixture();
  t.after(() => db.close());
  for (const extra of [{ officeName: " " }, { name: " " }, { email: "invalido" }, { password: "123" }]) {
    const result = await request("/sign-up/email", { name: "Ana Silva", officeName: "Silva Advocacia", email: "ana@example.test", password, ...extra });
    assert.ok(result.response.status >= 400);
  }
  assert.equal(db.prepare("SELECT count(*) AS total FROM user").get()?.total, 0);
  await signup();
  const duplicate = await request("/sign-up/email", { name: "Outra pessoa", officeName: "Outro escritório", email: "ANA@example.test", password });
  assert.ok(duplicate.response.status >= 400);
  assert.equal(db.prepare("SELECT count(*) AS total FROM user").get()?.total, 1);
  assert.equal(db.prepare("SELECT count(*) AS total FROM office").get()?.total, 1);
});

test("login recusa senha incorreta e aceita credenciais válidas", async (t) => {
  const { db, request, signup } = await fixture();
  t.after(() => db.close());
  await signup();
  const rejected = await request("/sign-in/email", { email: "ana@example.test", password: "senha-incorreta" });
  assert.equal(rejected.response.status, 401);
  assert.equal(rejected.data.code, "INVALID_EMAIL_OR_PASSWORD");
  const accepted = await request("/sign-in/email", { email: "ana@example.test", password });
  assert.equal(accepted.response.status, 200);
  assert.ok((await request("/get-session", undefined, accepted.cookie)).data.user);
});

test("escritório A não acessa B e cadastro não aceita escritório ou papel fornecido pelo cliente", async (t) => {
  const { db, signup } = await fixture();
  t.after(() => db.close());
  const a = await signup();
  const officeA = findOfficeForUser(db, a.data.user.id)!;
  const b = await signup("bruno@example.test", { officeName: "Bruno Advocacia", officeId: officeA.officeId, role: "reviewer" });
  const officeB = findOfficeForUser(db, b.data.user.id)!;
  assert.notEqual(officeA.officeId, officeB.officeId);
  assert.equal(officeB.role, "administrator");
  assert.equal(findOfficeForUser(db, a.data.user.id, officeB.officeId), undefined);
  assert.equal(findOfficeForUser(db, b.data.user.id, officeA.officeId), undefined);
  assert.equal(findOfficeForUser(db, "usuario-inexistente", officeA.officeId), undefined);
  assert.throws(() => db.prepare("UPDATE office_member SET role = 'superadmin'").run());
});

test("logout invalida todos os dispositivos do usuário e preserva outras contas", async (t) => {
  const { db, request, signup } = await fixture();
  t.after(() => db.close());
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
  t.after(() => db.close());
  assert.equal((await request("/get-session")).data, null);
  assert.equal((await request("/get-session", undefined, "better-auth.session_token=inventado")).data, null);
  const result = await signup();
  const original = new Date(String(db.prepare("SELECT expiresAt FROM session").get()!.expiresAt)).getTime();
  db.prepare("UPDATE session SET expiresAt = ?, updatedAt = ?").run(new Date(original - 600000).toISOString(), new Date(Date.now() - 600000).toISOString());
  await request("/get-session", undefined, result.cookie);
  assert.ok(new Date(String(db.prepare("SELECT expiresAt FROM session").get()!.expiresAt)).getTime() > original - 600000);
  db.prepare("UPDATE session SET expiresAt = ?").run(new Date(Date.now() - 1000).toISOString());
  assert.equal((await request("/get-session", undefined, result.cookie)).data, null);
});

test("requisições de outra origem são recusadas", async (t) => {
  const { db, request } = await fixture();
  t.after(() => db.close());
  const result = await request("/sign-up/email", { name: "Ana Silva", officeName: "Silva Advocacia", email: "ana@example.test", password }, "", "https://outra-origem.example");
  assert.equal(result.response.status, 403);
  assert.equal(db.prepare("SELECT count(*) AS total FROM user").get()?.total, 0);
});

test("limita tentativas repetidas de login", async (t) => {
  const { db, request } = await fixture();
  t.after(() => db.close());
  for (let attempt = 0; attempt < 10; attempt++) {
    assert.equal((await request("/sign-in/email", { email: "ausente@example.test", password })).response.status, 401);
  }
  assert.equal((await request("/sign-in/email", { email: "ausente@example.test", password })).response.status, 429);
});

test("logout de outra origem não encerra a sessão legítima", async (t) => {
  const { db, request, signup } = await fixture();
  t.after(() => db.close());
  const user = await signup();
  const result = await request("/sign-out", {}, user.cookie, "https://outra-origem.example");
  assert.equal(result.response.status, 403);
  assert.ok((await request("/get-session", undefined, user.cookie)).data?.user);
});
