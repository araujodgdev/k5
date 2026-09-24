import { postgresFixture } from './postgres-fixture';
import assert from "node:assert/strict";
import { createCipheriv, randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  AI_PROVIDERS, AiConnectionError, connectionInputSchema, connectionPatchSchema, connectionTestSchema, createAiConnection, deleteAiConnection,
  listAiConnections, resolveModelConfigFromDatabase, testAiConnection, updateAiConnection,
} from "../src/lib/ai-connections-core";
import {
  assertPlatformAdmin, findUserForPlatformGrant, grantPlatformAdmin, isPlatformAdmin, platformErrorResponse, PlatformRequestError, readPlatformJson, revokePlatformAdmin,
} from "../src/lib/platform-core";
import {
  createCredentialKeyring, CredentialDecryptError, CredentialKeyError, credentialKeyId, credentialNeedsReencryption, decryptCredential, encryptCredential,
  parseCredentialKey, parseCredentialKeyring,
} from "../src/lib/platform-crypto";
import { resolveModelConfig as resolveMastraModel } from "@mastra/core/llm";
import { DEFAULT_CHAT_MODEL } from "../src/lib/ai-defaults";
import { modelFor } from "../src/lib/ai-providers";

async function fixture() {
  const { db } = await postgresFixture();
  const admin = randomUUID(), outsider = randomUUID(), officeA = randomUUID(), officeB = randomUUID();
  (await db.prepare("INSERT INTO user (id,email,name) VALUES (?,?,?),(?,?,?)").run(admin, "admin@example.test", "Admin", outsider, "other@example.test", "Other"));
  (await db.prepare("INSERT INTO office (id,name) VALUES (?,?),(?,?)").run(officeA, "Alfa Advocacia", officeB, "Beta Advocacia"));
  return { db, database: db, admin, outsider, officeA, officeB, key: randomBytes(32) };
}

test("AES-256-GCM round trips and rejects wrong master keys and malformed env values", () => {
  const key = randomBytes(32), secret = "sk-sensitive-never-log";
  const payload = encryptCredential(secret, key);
  assert.equal(decryptCredential(payload, key), secret);
  assert.equal(payload.includes(secret), false);
  assert.throws(() => decryptCredential(payload, randomBytes(32)), CredentialDecryptError);
  assert.deepEqual(parseCredentialKey(key.toString("base64")), key);
  assert.throws(() => parseCredentialKey("not-base64"), /base64/);
  assert.throws(() => parseCredentialKey(randomBytes(31).toString("base64")), /32 bytes/);
});

test("platform role is independent and revocation takes effect immediately", async () => {
  const { database, admin, outsider } = (await fixture());
  assert.equal(await isPlatformAdmin(database, admin), false);
  assert.equal(await grantPlatformAdmin(database, admin), true);
  assert.equal(await grantPlatformAdmin(database, admin), false);
  assert.equal(await isPlatformAdmin(database, admin), true);
  await assert.doesNotReject(() => assertPlatformAdmin(database, admin));
  assert.equal(await isPlatformAdmin(database, outsider), false);
  await assert.rejects(() => assertPlatformAdmin(database, outsider), (error: unknown) => error instanceof Error && "status" in error && error.status === 403);
  assert.equal(await revokePlatformAdmin(database, admin), true);
  assert.equal(await isPlatformAdmin(database, admin), false);
  await assert.rejects(() => assertPlatformAdmin(database, admin), /Acesso restrito/);
  assert.equal((await findUserForPlatformGrant(database, { email: " ADMIN@example.test " }))?.id, admin);
  await assert.rejects(() => findUserForPlatformGrant(database, { email: "a", id: "b" }), /exatamente/);
});

test("platform connections are masked, audited, rotated and serve every office", async () => {
  const { db, database, admin, key } = (await fixture());
  await grantPlatformAdmin(database, admin);
  const a = await createAiConnection(database, key, admin, { name: "Principal", provider: "openai", apiKey: "sk-platform-secret", models: { chat: "gpt-chat", extraction: null, drafting: "gpt-draft" } });
  assert.equal((await listAiConnections(database)).length, 1);
  assert.equal((await listAiConnections(database))[0].keyHint.includes("platform-secret"), false);
  assert.equal(JSON.stringify(await listAiConnections(database)).includes("sk-platform-secret"), false);
  assert.equal("officeId" in (await listAiConnections(database))[0], false, "a platform connection belongs to no office");
  assert.equal((await resolveModelConfigFromDatabase(database, key, "chat")).apiKey, "sk-platform-secret");
  await assert.rejects(() => createAiConnection(database, key, admin, { name: "Principal", provider: "google", apiKey: "sk-x" }), (error) => error instanceof AiConnectionError && error.code === "conflict");
  const rotated = await updateAiConnection(database, key, admin, a.id, { apiKey: "sk-rotated-newkey" });
  assert.notEqual(rotated.keyHint, a.keyHint);
  assert.equal((await resolveModelConfigFromDatabase(database, key, "chat")).apiKey, "sk-rotated-newkey");
  await updateAiConnection(database, key, admin, a.id, { enabled: false });
  await assert.rejects(() => resolveModelConfigFromDatabase(database, key, "chat"), (error) => error instanceof AiConnectionError && error.code === "not_found");
  await updateAiConnection(database, key, admin, a.id, { enabled: true });
  const audited = await db.prepare("SELECT count(*) total FROM platform_audit_log WHERE connection_id = ? AND office_id IS NULL").get(a.id);
  assert.ok(Number(audited?.total) >= 3);
  await db.prepare('UPDATE ai_connection SET encrypted_api_key=? WHERE id=?').run(encryptCredential('sk-damaged-key', randomBytes(32)), a.id);
  await assert.rejects(() => resolveModelConfigFromDatabase(database, key, 'chat'),
    (error) => error instanceof AiConnectionError && error.code === 'credential' && !error.message.includes('sk-'));
});

test("per-office rows from before 0022 are never read, and the migration adopts the most recent office's", async () => {
  const { db, database, officeA, officeB, key } = (await fixture());
  // What an office configured before the move looks like: rows that carry the office.
  const legacy = async (officeId: string, name: string, provider: string, secret: string, chat: string, updatedAt: string) =>
    db.prepare(`INSERT INTO ai_connection (id, office_id, name, provider, encrypted_api_key, api_key_hint, chat_model, updated_at)
      VALUES (?, ?, ?, ?, ?, '••••', ?, ?)`).run(randomUUID(), officeId, name, provider, encryptCredential(secret, key), chat, updatedAt);
  await legacy(officeA, "Antiga", "anthropic", "sk-office-a-old", "claude-a", "2026-01-01T00:00:00Z");
  await legacy(officeB, "Recente", "openai", "sk-office-b-new", "gpt-b", "2026-06-01T00:00:00Z");
  await assert.rejects(() => resolveModelConfigFromDatabase(database, key, "chat"), (error) => error instanceof AiConnectionError && error.code === "not_found");
  assert.equal((await listAiConnections(database)).length, 0);
  // Run the adoption statement of the migration against these rows.
  const migration = readFileSync(new URL("../db/postgres/0022_platform_ai_connections.sql", import.meta.url), "utf8");
  await db.exec(migration.slice(migration.indexOf("WITH source AS")));
  const adopted = await listAiConnections(database);
  assert.deepEqual(adopted.map((item) => [item.name, item.provider, item.models.chat]), [["Recente", "openai", "gpt-b"]]);
  const config = await resolveModelConfigFromDatabase(database, key, "chat");
  assert.equal(config.apiKey, "sk-office-b-new", "the ciphertext is copied as is and still reads");
  assert.equal(config.connectionId, adopted[0].id);
});

test("task assignment is exclusive and deletion erases the secret after assignments are removed", async () => {
  const { db, database, admin, key } = (await fixture());
  const first = await createAiConnection(database, key, admin, { name: "Primeira", provider: "openai", apiKey: "first-secret", models: { chat: "first-model", extraction: null, drafting: null } });
  const second = await createAiConnection(database, key, admin, { name: "Segunda", provider: "google", apiKey: "second-secret", models: { chat: "second-model", extraction: null, drafting: null } });
  assert.equal((await listAiConnections(database)).find((item) => item.id === first.id)?.models.chat, null);
  assert.equal((await resolveModelConfigFromDatabase(database, key, "chat")).connectionId, second.id);
  await assert.rejects(() => deleteAiConnection(database, admin, second.id), (error) => error instanceof AiConnectionError && error.code === "in_use");
  await updateAiConnection(database, key, admin, second.id, { models: { chat: null, extraction: null, drafting: null } });
  await deleteAiConnection(database, admin, second.id);
  assert.equal((await listAiConnections(database)).length, 1);
  const deleted = (await db.prepare("SELECT encrypted_api_key, deleted_at FROM ai_connection WHERE id = ?").get(second.id)) as { encrypted_api_key: string | null; deleted_at: string | null };
  assert.equal(deleted.encrypted_api_key, null);
  assert.ok(deleted.deleted_at);
});

test("the Lume's model choice applies to chat, extraction and drafting on the platform", async () => {
  const { database, admin, key } = (await fixture());
  const old = await createAiConnection(database, key, admin, {
    name: "Anterior", provider: "anthropic", apiKey: "sk-old",
    models: { chat: "claude-old", extraction: "claude-old", drafting: "claude-old" },
  });
  const chosen = await createAiConnection(database, key, admin, {
    name: "Nova", provider: "openai", apiKey: "sk-new",
    models: { embedding: "text-embedding-3-small" },
  });
  await updateAiConnection(database, key, admin, chosen.id, {
    models: { chat: "gpt-6-sol", extraction: "gpt-6-sol", drafting: "gpt-6-sol" },
  });
  for (const task of ["chat", "extraction", "drafting"] as const) {
    const config = await resolveModelConfigFromDatabase(database, key, task);
    assert.equal(config.connectionId, chosen.id);
    assert.equal(config.modelId, "gpt-6-sol");
  }
  assert.deepEqual((await listAiConnections(database)).find(item => item.id === old.id)?.models, {
    chat: null, extraction: null, drafting: null, embedding: null,
  });
  await updateAiConnection(database, key, admin, chosen.id, {
    models: { chat: "modelo-digitado", extraction: "modelo-digitado", drafting: "modelo-digitado" },
  });
  assert.equal((await resolveModelConfigFromDatabase(database, key, "chat")).modelId, "modelo-digitado");
  assert.equal((await resolveModelConfigFromDatabase(database, key, "embedding")).modelId, "text-embedding-3-small");
});

function legacyV1(plaintext: string, key: Uint8Array) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return JSON.stringify({ v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") });
}

test("master key versioning: key id in envelope, previous keys decrypt, legacy v1 payloads still work", () => {
  const oldKey = randomBytes(32), newKey = randomBytes(32), secret = "sk-versioned-secret";
  const payload = JSON.parse(encryptCredential(secret, oldKey));
  assert.equal(payload.v, 2);
  assert.equal(payload.kid, credentialKeyId(oldKey));
  const rotated = createCredentialKeyring(newKey, [oldKey]);
  assert.equal(decryptCredential(JSON.stringify(payload), rotated), secret);
  assert.equal(credentialNeedsReencryption(JSON.stringify(payload), rotated), true);
  assert.equal(credentialNeedsReencryption(encryptCredential(secret, rotated), rotated), false);
  assert.equal(JSON.parse(encryptCredential(secret, rotated)).kid, credentialKeyId(newKey));
  assert.throws(() => decryptCredential(JSON.stringify(payload), newKey), /não está configurada/);
  const legacy = legacyV1(secret, oldKey);
  assert.equal(decryptCredential(legacy, oldKey), secret);
  assert.equal(decryptCredential(legacy, rotated), secret);
  assert.equal(credentialNeedsReencryption(legacy, oldKey), true);
  assert.throws(() => decryptCredential(legacy, newKey), CredentialDecryptError);
  assert.throws(() => decryptCredential("{}", newKey), CredentialDecryptError);
  const fromEnv = parseCredentialKeyring(newKey.toString("base64"), ` ${oldKey.toString("base64")} ,, `);
  assert.equal(fromEnv.current.id, credentialKeyId(newKey));
  assert.equal(fromEnv.keys.size, 2);
  assert.equal(parseCredentialKeyring(newKey.toString("base64"), "").keys.size, 1);
  assert.throws(() => parseCredentialKeyring(newKey.toString("base64"), "invalida"), (error) => error instanceof CredentialKeyError && /PREVIOUS_KEYS/.test(error.message) && !error.message.includes("invalida"));
});

test("connection test accepts any enabled connection, hides provider failures and audits without secrets", async () => {
  const { db, database, admin, officeB, key } = (await fixture());
  const chat = await createAiConnection(database, key, admin, { name: "Conversa", provider: "openai", apiKey: "sk-chat-test-secret", models: { chat: "gpt-chat", extraction: null, drafting: null } });
  const extraction = await createAiConnection(database, key, admin, { name: "Extração", provider: "anthropic", apiKey: "sk-extract-test-secret", models: { chat: null, extraction: "claude-extract", drafting: null } });
  // A per-office row from before 0022 cannot be tested through the platform.
  const legacy = randomUUID();
  await db.prepare(`INSERT INTO ai_connection (id, office_id, name, provider, encrypted_api_key, api_key_hint, chat_model) VALUES (?, ?, 'Outro', 'google', ?, '••••', 'gem')`)
    .run(legacy, officeB, encryptCredential("sk-office-b-test", key));
  const sent: string[] = [];
  const ok = async (config: { apiKey: string; modelId: string }) => { sent.push(`${config.apiKey}:${config.modelId}`); };
  assert.deepEqual(await testAiConnection(database, key, admin, extraction.id, undefined, ok), { task: "extraction", modelId: "claude-extract" });
  assert.deepEqual(sent, ["sk-extract-test-secret:claude-extract"]);
  // No chat assignment: the test uses the model Lume would use for this provider.
  assert.deepEqual(await testAiConnection(database, key, admin, extraction.id, "chat", ok), { task: "chat", modelId: DEFAULT_CHAT_MODEL.anthropic });
  await assert.rejects(testAiConnection(database, key, admin, legacy, undefined, ok), (error) => error instanceof AiConnectionError && error.code === "not_found");
  const leaky = async () => { throw new Error("401 Incorrect API key provided: sk-cha****cret"); };
  await assert.rejects(testAiConnection(database, key, admin, chat.id, "chat", leaky), (error) => error instanceof AiConnectionError && error.code === "provider"
    && error.message === "O provider recusou a requisição de teste. Confira a chave e o modelo.");
  await updateAiConnection(database, key, admin, chat.id, { enabled: false });
  await assert.rejects(testAiConnection(database, key, admin, chat.id, "chat", ok), (error) => error instanceof AiConnectionError && error.code === "disabled");
  const rows = (await db.prepare("SELECT actor_user_id, office_id, connection_id, details_json FROM platform_audit_log WHERE action = 'ai_connection.tested' ORDER BY created_at,id").all()) as Array<{ actor_user_id: string; office_id: string | null; connection_id: string; details_json: string }>;
  assert.deepEqual(rows.map((row) => [row.actor_user_id, row.office_id, row.connection_id, JSON.parse(row.details_json).task, JSON.parse(row.details_json).result]), [
    [admin, null, extraction.id, "extraction", "ok"], [admin, null, extraction.id, "chat", "ok"], [admin, null, chat.id, "chat", "failed"],
  ]);
  assert.equal(/sk-|Incorrect/.test(JSON.stringify(rows)), false);
});

test("request bodies are size-capped and schema-validated", async () => {
  const body = (value: unknown) => new Request("https://k5.example/api", { method: "POST", body: typeof value === "string" ? value : JSON.stringify(value) });
  const status = async (promise: Promise<unknown>) => { try { await promise; return 200; } catch (error) { return error instanceof PlatformRequestError ? error.status : 500; } };
  const valid = { name: "Principal", provider: "openai", apiKey: "sk-x", models: { chat: "gpt", extraction: null } };
  assert.deepEqual(await readPlatformJson(body(valid), connectionInputSchema), valid);
  assert.equal(await status(readPlatformJson(body({ ...valid, provider: "mistral" }), connectionInputSchema)), 400);
  assert.equal(await status(readPlatformJson(body({ ...valid, models: { summarizing: "x" } }), connectionInputSchema)), 400);
  assert.equal(await status(readPlatformJson(body({ ...valid, officeId: "outro" }), connectionInputSchema)), 400);
  assert.equal(await status(readPlatformJson(body({ enabled: "sim" }), connectionPatchSchema)), 400);
  assert.equal(await status(readPlatformJson(body({ task: "summary" }), connectionTestSchema)), 400);
  assert.deepEqual(await readPlatformJson(body({ task: "drafting" }), connectionTestSchema), { task: "drafting" });
  assert.equal(await status(readPlatformJson(body("{not json"), connectionPatchSchema)), 400);
  assert.equal(await status(readPlatformJson(new Request("https://k5.example/api", { method: "POST" }), connectionPatchSchema)), 400);
  assert.equal(await status(readPlatformJson(body({ ...valid, apiKey: "x".repeat(20_000) }), connectionInputSchema)), 413);
  const stream = new ReadableStream({ start(controller) { for (let i = 0; i < 20; i++) controller.enqueue(new TextEncoder().encode("x".repeat(1000))); controller.close(); } });
  assert.equal(await status(readPlatformJson(new Request("https://k5.example/api", { method: "POST", body: stream, duplex: "half" } as RequestInit), connectionPatchSchema)), 413);
});

test("error responses never log or return secret-bearing messages", async (t) => {
  const logged: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => { logged.push(args); });
  const generic = platformErrorResponse(new Error("database failure near sk-live-leaked-secret"));
  assert.equal(generic.status, 500);
  assert.equal((await generic.text()).includes("sk-live"), false);
  assert.equal((await platformErrorResponse({ apiKey: "sk-live-object" }).text()).includes("sk-live"), false);
  assert.ok(logged.length > 0);
  assert.equal(JSON.stringify(logged).includes("sk-live"), false);
  assert.equal(platformErrorResponse(new AiConnectionError("provider", "x")).status, 422);
  assert.equal(platformErrorResponse(new AiConnectionError("credential", "x")).status, 503);
  assert.equal(platformErrorResponse(new CredentialKeyError("K5_CREDENTIALS_KEY deve estar em base64.")).status, 503);
  assert.equal(platformErrorResponse(new PlatformRequestError(403, "Acesso restrito.")).status, 403);
});

test("concurrent resolution binds the platform credential to the model, and disabling it stops every office", async () => {
  const { database, admin, key } = (await fixture());
  const platform = await createAiConnection(database, key, admin, { name: "Plataforma", provider: "anthropic", apiKey: "sk-platform-only", models: { chat: "claude-p", extraction: null, drafting: null } });
  const resolve = async () => {
    await new Promise((done) => setImmediate(done));
    const config = await resolveModelConfigFromDatabase(database, key, "chat");
    // The router keeps the credential on the resolved model, so serializing it proves which key was bound.
    const model = await resolveMastraModel(modelFor(config)) as { provider: string; modelId: string; config?: unknown };
    return { apiKey: config.apiKey, provider: model.provider, modelId: model.modelId, resolved: JSON.stringify(model.config) };
  };
  for (const result of await Promise.all([resolve(), resolve(), resolve(), resolve()])) {
    assert.equal(result.apiKey, "sk-platform-only");
    assert.equal(result.modelId, "claude-p");
    assert.equal(result.provider, "anthropic");
    assert.ok(result.resolved.includes(result.apiKey));
  }
  await updateAiConnection(database, key, admin, platform.id, { enabled: false });
  const disabled = await Promise.allSettled([resolve(), resolve()]);
  assert.ok(disabled.every((item) => item.status === "rejected" && item.reason instanceof AiConnectionError && item.reason.code === "not_found"));
  // Clearing the assignment does not disable the Lume: it supplies the model for the provider.
  await updateAiConnection(database, key, admin, platform.id, { enabled: true, models: { chat: null, extraction: null, drafting: null } });
  const cleared = await resolve();
  assert.equal(cleared.modelId, DEFAULT_CHAT_MODEL.anthropic);
});

test("every supported provider can be stored and resolved with its own credential", async () => {
  const { database, admin, key } = (await fixture());
  for (const provider of AI_PROVIDERS) {
    const created = await createAiConnection(database, key, admin, {
      name: `Conexão ${provider}`, provider, apiKey: `sk-${provider}-live`,
      models: { chat: `${provider}-chat-model`, extraction: null, drafting: null },
    });
    assert.equal(created.provider, provider);
    const config = await resolveModelConfigFromDatabase(database, key, "chat");
    assert.deepEqual(modelFor(config), { providerId: provider, modelId: `${provider}-chat-model`, apiKey: `sk-${provider}-live` });
    assert.equal(JSON.stringify(created).includes(`sk-${provider}-live`), false);
    await updateAiConnection(database, key, admin, created.id, { models: { chat: null } });
    await deleteAiConnection(database, admin, created.id);
  }
});

test("dynamic model resolution supports an internally pinned run model", async () => {
  const { database, admin, key } = (await fixture());
  // Admin creates connection with only provider and apiKey, no assigned models
  await createAiConnection(database, key, admin, {
    name: "Inception Principal",
    provider: "inception",
    apiKey: "sk-inception-test-key",
    models: { chat: null, extraction: null, drafting: null },
  });

  // Without a requested model the platform still resolves: Lume owns the default for the provider.
  const fallback = await resolveModelConfigFromDatabase(database, key, "chat");
  assert.equal(fallback.provider, "inception");
  assert.equal(fallback.modelId, DEFAULT_CHAT_MODEL.inception);

  // Embedding is stricter: a provider with no embeddings endpoint is not silently substituted.
  await assert.rejects(() => resolveModelConfigFromDatabase(database, key, "embedding"),
    (err) => err instanceof AiConnectionError && err.code === "not_found"
  );

  // Queued runs can pin the model chosen by the administrator when the run was created.
  const resolved = await resolveModelConfigFromDatabase(database, key, "chat", {
    provider: "inception",
    modelId: "mercury-2.5",
  });
  assert.equal(resolved.provider, "inception");
  assert.equal(resolved.modelId, "mercury-2.5");
  assert.equal(resolved.apiKey, "sk-inception-test-key");

  // Calling with unconfigured provider throws not_found
  await assert.rejects(() => resolveModelConfigFromDatabase(database, key, "chat", {
      provider: "openai",
      modelId: "gpt-4o",
    }),
    (err) => err instanceof AiConnectionError && err.code === "not_found"
  );
});
