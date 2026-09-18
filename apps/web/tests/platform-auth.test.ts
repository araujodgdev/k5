import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { getMigrations } from "better-auth/db/migration";
import { listOfficesForPlatform } from "../src/lib/ai-connections-core";
import { createAuth } from "../src/lib/auth-core";
import { findOfficeForUser } from "../src/lib/offices";
import { authorizePlatformRequest, grantPlatformAdmin, platformErrorResponse, revokePlatformAdmin } from "../src/lib/platform-core";

const origin = "http://localhost:3000";
const password = "Senha-teste-2026!";

async function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  const auth = createAuth(db, { secret: randomBytes(48).toString("base64url"), baseURL: origin, idleSeconds: 3600 });
  await (await getMigrations(auth.options)).runMigrations();
  for (const name of ["0001_offices.sql", "0002_platform.sql", "0005_ai_providers.sql"]) db.exec(readFileSync(new URL(`../db/migrations/${name}`, import.meta.url), "utf8"));
  async function signup(email: string) {
    const response = await auth.handler(new Request(`${origin}/api/auth/sign-up/email`, {
      method: "POST", headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ name: "Ana Silva", officeName: "Silva Advocacia", email, password }),
    }));
    assert.equal(response.status, 200);
    return { cookie: response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; "), user: (await response.json()).user as { id: string } };
  }
  // Mirrors a platform route handler: authorize with the real Better Auth session, then run the operation.
  async function handler(cookie?: string, init: { method?: string; origin?: string } = {}) {
    const request = new Request(`${origin}/api/platform/offices`, { method: init.method ?? "GET", headers: { ...(cookie ? { cookie } : {}), ...(init.origin ? { origin: init.origin } : {}) } });
    try {
      const { db: scoped } = await authorizePlatformRequest(db, (headers) => auth.api.getSession({ headers }), request, { mutation: request.method !== "GET" });
      return Response.json({ offices: listOfficesForPlatform(scoped) });
    } catch (error) { return platformErrorResponse(error); }
  }
  return { db, auth, signup, handler };
}

test("anônimo e administrador de escritório sem papel de plataforma não acessam a API da plataforma", async (t) => {
  const { db, signup, handler } = await fixture();
  t.after(() => db.close());
  assert.equal((await handler()).status, 401);
  assert.equal((await handler("better-auth.session_token=inventado")).status, 401);
  const officeAdmin = await signup("ana@example.test");
  assert.equal(findOfficeForUser(db, officeAdmin.user.id)?.role, "administrator");
  const denied = await handler(officeAdmin.cookie);
  assert.equal(denied.status, 403);
  assert.equal(JSON.stringify(await denied.json()).includes("Silva Advocacia"), false);
  assert.equal((await handler(officeAdmin.cookie, { method: "POST", origin })).status, 403);
});

test("papel de plataforma libera a API e a revogação vale na requisição seguinte", async (t) => {
  const { db, signup, handler } = await fixture();
  t.after(() => db.close());
  const admin = await signup("plataforma@example.test");
  grantPlatformAdmin(db, admin.user.id);
  const allowed = await handler(admin.cookie);
  assert.equal(allowed.status, 200);
  assert.equal((await allowed.json()).offices.length, 1);
  assert.equal((await handler(admin.cookie, { method: "POST" })).status, 403);
  assert.equal((await handler(admin.cookie, { method: "POST", origin: "https://outra-origem.example" })).status, 403);
  assert.equal((await handler(admin.cookie, { method: "POST", origin })).status, 200);
  revokePlatformAdmin(db, admin.user.id);
  assert.equal((await handler(admin.cookie)).status, 403);
  grantPlatformAdmin(db, admin.user.id);
  db.prepare("DELETE FROM session WHERE userId = ?").run(admin.user.id);
  assert.equal((await handler(admin.cookie)).status, 401);
});
