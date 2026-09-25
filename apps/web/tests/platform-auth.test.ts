import { postgresFixture } from './postgres-fixture';
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { listOfficesForPlatform } from "../src/lib/ai-connections-core";
import { createAuth } from "../src/lib/auth-core";
import { findOfficeForUser } from "../src/lib/offices";
import { authorizePlatformRequest, grantPlatformAdmin, platformErrorResponse, revokePlatformAdmin } from "../src/lib/platform-core";

const origin = "http://localhost:3000";
const password = "Senha-teste-2026!";

async function fixture() {
  const { db, database, pool } = await postgresFixture({seedDefaults:false});
  // validateSchema: other test files drop their schemas while this one runs (see auth-core.ts).
  const auth = createAuth(pool, database, { secret: randomBytes(48).toString("base64url"), baseURL: origin, idleSeconds: 3600, validateSchema: false });
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
      const { db: scoped } = await authorizePlatformRequest(database, (headers) => auth.api.getSession({ headers }), request, { mutation: request.method !== "GET" });
      return Response.json({ offices: await listOfficesForPlatform(scoped) });
    } catch (error) { return platformErrorResponse(error); }
  }
  return { db, database, auth, signup, handler };
}

test("anônimo e administrador de escritório sem papel de plataforma não acessam a API da plataforma", async (t) => {
  const { db, database, signup, handler } = await fixture();
  t.after(async () => (await db.close()));
  assert.equal((await handler()).status, 401);
  assert.equal((await handler("better-auth.session_token=inventado")).status, 401);
  const officeAdmin = await signup("ana@example.test");
  assert.equal((await findOfficeForUser(database, officeAdmin.user.id))?.role, "administrator");
  const denied = await handler(officeAdmin.cookie);
  assert.equal(denied.status, 403);
  assert.equal(JSON.stringify(await denied.json()).includes("Silva Advocacia"), false);
  assert.equal((await handler(officeAdmin.cookie, { method: "POST", origin })).status, 403);
});

test("papel de plataforma libera a API e a revogação vale na requisição seguinte", async (t) => {
  const { db, database, signup, handler } = await fixture();
  t.after(async () => (await db.close()));
  const admin = await signup("plataforma@example.test");
  await grantPlatformAdmin(database, admin.user.id);
  const allowed = await handler(admin.cookie);
  assert.equal(allowed.status, 200);
  assert.equal((await allowed.json()).offices.length, 1);
  assert.equal((await handler(admin.cookie, { method: "POST" })).status, 403);
  assert.equal((await handler(admin.cookie, { method: "POST", origin: "https://outra-origem.example" })).status, 403);
  assert.equal((await handler(admin.cookie, { method: "POST", origin })).status, 200);
  await revokePlatformAdmin(database, admin.user.id);
  assert.equal((await handler(admin.cookie)).status, 403);
  await grantPlatformAdmin(database, admin.user.id);
  (await db.prepare("DELETE FROM session WHERE userId = ?").run(admin.user.id));
  assert.equal((await handler(admin.cookie)).status, 401);
});
