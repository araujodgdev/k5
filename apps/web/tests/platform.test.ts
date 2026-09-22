import assert from "node:assert/strict";
import { createCipheriv, randomBytes, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  AI_PROVIDERS, AiConnectionError, connectionInputSchema, connectionPatchSchema, connectionTestSchema, countSecretsNeedingReencryption, createAiConnection, deleteAiConnection,
  listAiConnections, reencryptAiConnectionSecrets, resolveOfficeModelConfigFromDatabase, testAiConnection, updateAiConnection,
} from "../src/lib/ai-connections-core";
import {
  assertPlatformAdmin, assertSameOrigin, findUserForPlatformGrant, grantPlatformAdmin, isPlatformAdmin, platformErrorResponse, PlatformRequestError, readPlatformJson, revokePlatformAdmin,
} from "../src/lib/platform-core";
import {
  createCredentialKeyring, CredentialDecryptError, CredentialKeyError, credentialKeyId, credentialNeedsReencryption, decryptCredential, encryptCredential,
  parseCredentialKey, parseCredentialKeyring,
} from "../src/lib/platform-crypto";
import { resolveModelConfig } from "@mastra/core/llm";
import { DEFAULT_CHAT_MODEL } from "../src/lib/ai-defaults";
import { modelFor } from "../src/lib/ai-providers";
import { nodeSqliteDatabase } from "../src/lib/db/node-sqlite";

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON; CREATE TABLE user (id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL);");
  for (const file of readdirSync(new URL('../db/migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) {
    db.exec(readFileSync(new URL(`../db/migrations/${file}`, import.meta.url), 'utf8'));
  }
  const admin = randomUUID(), outsider = randomUUID(), officeA = randomUUID(), officeB = randomUUID();
  db.prepare("INSERT INTO user (id,email,name) VALUES (?,?,?),(?,?,?)").run(admin, "admin@example.test", "Admin", outsider, "other@example.test", "Other");
  db.prepare("INSERT INTO office (id,name) VALUES (?,?),(?,?)").run(officeA, "Alfa Advocacia", officeB, "Beta Advocacia");
  return { db, database: nodeSqliteDatabase(db), admin, outsider, officeA, officeB, key: randomBytes(32) };
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
  const { database, admin, outsider } = fixture();
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

test("writes require an allowed same origin", () => {
  const request = (origin?: string) => new Request("https://k5.example/api/platform", { method: "POST", headers: origin ? { origin } : {} });
  assert.doesNotThrow(() => assertSameOrigin(request("https://k5.example")));
  assert.throws(() => assertSameOrigin(request("https://admin.k5.example")), /não autorizada/);
  assert.throws(() => assertSameOrigin(request("https://evil.example")), /não autorizada/);
  assert.throws(() => assertSameOrigin(request()), /ausente/);
  assert.throws(() => assertSameOrigin(request("not a url")), /inválida/);
});

test("connections are office isolated, masked, audited, rotated and resolved by task", async () => {
  const { db, database, admin, officeA, officeB, key } = fixture();
  await grantPlatformAdmin(database, admin);
  const a = await createAiConnection(database, key, admin, officeA, { name: "Principal", provider: "openai", apiKey: "sk-office-a-secret", models: { chat: "gpt-chat", extraction: null, drafting: "gpt-draft" } });
  const b = await createAiConnection(database, key, admin, officeB, { name: "Principal", provider: "anthropic", apiKey: "sk-office-b-secret", models: { chat: "claude-chat", extraction: null, drafting: null } });
  assert.equal((await listAiConnections(database, officeA)).length, 1);
  assert.equal((await listAiConnections(database, officeA))[0].keyHint.includes("office-a-secret"), false);
  assert.equal(JSON.stringify(await listAiConnections(database, officeA)).includes("sk-office-a-secret"), false);
  assert.equal((await resolveOfficeModelConfigFromDatabase(database, key, officeA, "chat")).apiKey, "sk-office-a-secret");
  assert.equal((await resolveOfficeModelConfigFromDatabase(database, key, officeB, "chat")).connectionId, b.id);
  await assert.rejects(() => updateAiConnection(database, key, admin, officeA, b.id, { name: "Intrusão" }), (error) => error instanceof AiConnectionError && error.code === "not_found");
  const rotated = await updateAiConnection(database, key, admin, officeA, a.id, { apiKey: "sk-rotated-newkey" });
  assert.notEqual(rotated.keyHint, a.keyHint);
  assert.equal((await resolveOfficeModelConfigFromDatabase(database, key, officeA, "chat")).apiKey, "sk-rotated-newkey");
  await updateAiConnection(database, key, admin, officeA, a.id, { enabled: false });
  await assert.rejects(() => resolveOfficeModelConfigFromDatabase(database, key, officeA, "chat"), (error) => error instanceof AiConnectionError && error.code === "not_found");
  await updateAiConnection(database, key, admin, officeA, a.id, { enabled: true });
  assert.ok(Number(db.prepare("SELECT count(*) total FROM platform_audit_log WHERE office_id = ?").get(officeA)?.total) >= 2);
});

test("task assignment is exclusive and deletion erases the secret after assignments are removed", async () => {
  const { db, database, admin, officeA, key } = fixture();
  const first = await createAiConnection(database, key, admin, officeA, { name: "Primeira", provider: "openai", apiKey: "first-secret", models: { chat: "first-model", extraction: null, drafting: null } });
  const second = await createAiConnection(database, key, admin, officeA, { name: "Segunda", provider: "google", apiKey: "second-secret", models: { chat: "second-model", extraction: null, drafting: null } });
  assert.equal((await listAiConnections(database, officeA)).find((item) => item.id === first.id)?.models.chat, null);
  assert.equal((await resolveOfficeModelConfigFromDatabase(database, key, officeA, "chat")).connectionId, second.id);
  await assert.rejects(() => deleteAiConnection(database, admin, officeA, second.id), (error) => error instanceof AiConnectionError && error.code === "in_use");
  await updateAiConnection(database, key, admin, officeA, second.id, { models: { chat: null, extraction: null, drafting: null } });
  await deleteAiConnection(database, admin, officeA, second.id);
  assert.equal((await listAiConnections(database, officeA)).length, 1);
  const deleted = db.prepare("SELECT encrypted_api_key, deleted_at FROM ai_connection WHERE id = ?").get(second.id) as { encrypted_api_key: string | null; deleted_at: string | null };
  assert.equal(deleted.encrypted_api_key, null);
  assert.ok(deleted.deleted_at);
});

test("platform model choice applies to chat, extraction and drafting in one office", async () => {
  const { database, admin, officeA, officeB, key } = fixture();
  const old = await createAiConnection(database, key, admin, officeA, {
    name: "Anterior", provider: "anthropic", apiKey: "sk-old",
    models: { chat: "claude-old", extraction: "claude-old", drafting: "claude-old" },
  });
  const chosen = await createAiConnection(database, key, admin, officeA, {
    name: "Nova", provider: "openai", apiKey: "sk-new",
    models: { embedding: "text-embedding-3-small" },
  });
  await createAiConnection(database, key, admin, officeB, {
    name: "Outro escritório", provider: "google", apiKey: "sk-other",
    models: { chat: "gemini-other", extraction: "gemini-other", drafting: "gemini-other" },
  });
  await updateAiConnection(database, key, admin, officeA, chosen.id, {
    models: { chat: "gpt-6-sol", extraction: "gpt-6-sol", drafting: "gpt-6-sol" },
  });
  for (const task of ["chat", "extraction", "drafting"] as const) {
    const config = await resolveOfficeModelConfigFromDatabase(database, key, officeA, task);
    assert.equal(config.connectionId, chosen.id);
    assert.equal(config.modelId, "gpt-6-sol");
    assert.equal((await resolveOfficeModelConfigFromDatabase(database, key, officeB, task)).modelId, "gemini-other");
  }
  assert.deepEqual((await listAiConnections(database, officeA)).find(item => item.id === old.id)?.models, {
    chat: null, extraction: null, drafting: null, embedding: null,
  });
  await updateAiConnection(database, key, admin, officeA, chosen.id, {
    models: { chat: "modelo-digitado", extraction: "modelo-digitado", drafting: "modelo-digitado" },
  });
  assert.equal((await resolveOfficeModelConfigFromDatabase(database, key, officeA, "chat")).modelId, "modelo-digitado");
  assert.equal((await resolveOfficeModelConfigFromDatabase(database, key, officeA, "embedding")).modelId, "text-embedding-3-small");
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

test("rotation re-encrypts every live secret with the current key, audits without secrets and is atomic", async () => {
  const { db, database, admin, officeA, officeB } = fixture();
  const oldKey = randomBytes(32), newKey = randomBytes(32);
  const a = await createAiConnection(database, oldKey, admin, officeA, { name: "Alfa", provider: "openai", apiKey: "sk-alpha-rotation", models: { chat: "m-a", extraction: null, drafting: null } });
  const b = await createAiConnection(database, oldKey, admin, officeB, { name: "Beta", provider: "google", apiKey: "sk-beta-rotation", models: { chat: "m-b", extraction: null, drafting: null } });
  db.prepare("UPDATE ai_connection SET encrypted_api_key = ? WHERE id = ?").run(legacyV1("sk-beta-rotation", oldKey), b.id);
  const gone = await createAiConnection(database, oldKey, admin, officeA, { name: "Removida", provider: "anthropic", apiKey: "sk-gone", models: {} });
  await deleteAiConnection(database, admin, officeA, gone.id);
  const keyring = createCredentialKeyring(newKey, [oldKey]);
  assert.equal(await countSecretsNeedingReencryption(database, keyring), 2);
  assert.deepEqual(await reencryptAiConnectionSecrets(database, keyring, admin), { total: 2, reencrypted: 2, keyId: credentialKeyId(newKey) });
  assert.equal(await countSecretsNeedingReencryption(database, keyring), 0);
  assert.equal((await reencryptAiConnectionSecrets(database, keyring, admin)).reencrypted, 0);
  assert.equal((await resolveOfficeModelConfigFromDatabase(database, newKey, officeA, "chat")).apiKey, "sk-alpha-rotation");
  assert.equal((await resolveOfficeModelConfigFromDatabase(database, newKey, officeB, "chat")).apiKey, "sk-beta-rotation");
  const audit = JSON.stringify(db.prepare("SELECT * FROM platform_audit_log WHERE action = 'ai_connection.master_key_reencrypted'").all());
  assert.ok(audit.includes(a.id) && audit.includes(b.id));
  assert.equal(/sk-alpha|sk-beta/.test(audit) || audit.includes(newKey.toString("base64")) || audit.includes(oldKey.toString("base64")), false);

  db.prepare("UPDATE ai_connection SET encrypted_api_key = ? WHERE id = ?").run(encryptCredential("sk-alpha-rotation", randomBytes(32)), a.id);
  const before = db.prepare("SELECT encrypted_api_key FROM ai_connection ORDER BY id").all();
  await assert.rejects(() => reencryptAiConnectionSecrets(database, createCredentialKeyring(randomBytes(32), [newKey]), admin), (error) => error instanceof AiConnectionError && error.code === "credential" && !error.message.includes("sk-"));
  assert.deepEqual(db.prepare("SELECT encrypted_api_key FROM ai_connection ORDER BY id").all(), before);
  await assert.rejects(() => resolveOfficeModelConfigFromDatabase(database, newKey, officeA, "chat"), (error) => error instanceof AiConnectionError && error.code === "credential");
});

test("connection test accepts any enabled connection, hides provider failures and audits without secrets", async () => {
  const { db, database, admin, officeA, officeB, key } = fixture();
  const chat = await createAiConnection(database, key, admin, officeA, { name: "Conversa", provider: "openai", apiKey: "sk-chat-test-secret", models: { chat: "gpt-chat", extraction: null, drafting: null } });
  const extraction = await createAiConnection(database, key, admin, officeA, { name: "Extração", provider: "anthropic", apiKey: "sk-extract-test-secret", models: { chat: null, extraction: "claude-extract", drafting: null } });
  const other = await createAiConnection(database, key, admin, officeB, { name: "Outro", provider: "google", apiKey: "sk-office-b-test", models: { chat: "gem", extraction: null, drafting: null } });
  const sent: string[] = [];
  const ok = async (config: { apiKey: string; modelId: string }) => { sent.push(`${config.apiKey}:${config.modelId}`); };
  assert.deepEqual(await testAiConnection(database, key, admin, officeA, extraction.id, undefined, ok), { task: "extraction", modelId: "claude-extract" });
  assert.deepEqual(sent, ["sk-extract-test-secret:claude-extract"]);
  // No chat assignment: the test uses the model Lume would use for this provider.
  assert.deepEqual(await testAiConnection(database, key, admin, officeA, extraction.id, "chat", ok), { task: "chat", modelId: DEFAULT_CHAT_MODEL.anthropic });
  await assert.rejects(testAiConnection(database, key, admin, officeA, other.id, undefined, ok), (error) => error instanceof AiConnectionError && error.code === "not_found");
  const leaky = async () => { throw new Error("401 Incorrect API key provided: sk-cha****cret"); };
  await assert.rejects(testAiConnection(database, key, admin, officeA, chat.id, "chat", leaky), (error) => error instanceof AiConnectionError && error.code === "provider"
    && error.message === "O provider recusou a requisição de teste. Confira a chave e o modelo.");
  await updateAiConnection(database, key, admin, officeA, chat.id, { enabled: false });
  await assert.rejects(testAiConnection(database, key, admin, officeA, chat.id, "chat", ok), (error) => error instanceof AiConnectionError && error.code === "disabled");
  const rows = db.prepare("SELECT actor_user_id, office_id, connection_id, details_json FROM platform_audit_log WHERE action = 'ai_connection.tested' ORDER BY rowid").all() as Array<{ actor_user_id: string; office_id: string; connection_id: string; details_json: string }>;
  assert.deepEqual(rows.map((row) => [row.actor_user_id, row.office_id, row.connection_id, JSON.parse(row.details_json).task, JSON.parse(row.details_json).result]), [
    [admin, officeA, extraction.id, "extraction", "ok"], [admin, officeA, extraction.id, "chat", "ok"], [admin, officeA, chat.id, "chat", "failed"],
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
  const generic = platformErrorResponse(new Error("SQLITE failure near sk-live-leaked-secret"));
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

test("concurrent resolution per office uses its own credential and never falls back to another office", async () => {
  const { database, admin, officeA, officeB, key } = fixture();
  await createAiConnection(database, key, admin, officeA, { name: "Alfa", provider: "openai", apiKey: "sk-office-a-only", models: { chat: "gpt-a", extraction: null, drafting: null } });
  const b = await createAiConnection(database, key, admin, officeB, { name: "Beta", provider: "anthropic", apiKey: "sk-office-b-only", models: { chat: "claude-b", extraction: null, drafting: null } });
  const resolve = async (officeId: string) => {
    await new Promise((done) => setImmediate(done));
    const config = await resolveOfficeModelConfigFromDatabase(database, key, officeId, "chat");
    // The router keeps the credential on the resolved model, so serializing it proves which key was bound.
    const model = await resolveModelConfig(modelFor(config)) as { provider: string; modelId: string; config?: unknown };
    return { apiKey: config.apiKey, provider: model.provider, modelId: model.modelId, resolved: JSON.stringify(model.config) };
  };
  const results = await Promise.all([resolve(officeA), resolve(officeB), resolve(officeA), resolve(officeB)]);
  for (const [index, result] of results.entries()) {
    const isA = index % 2 === 0;
    assert.equal(result.apiKey, isA ? "sk-office-a-only" : "sk-office-b-only");
    assert.equal(result.modelId, isA ? "gpt-a" : "claude-b");
    assert.equal(result.provider, isA ? "openai" : "anthropic");
    assert.ok(result.resolved.includes(result.apiKey));
    assert.equal(result.resolved.includes(isA ? "sk-office-b-only" : "sk-office-a-only"), false);
  }
  await updateAiConnection(database, key, admin, officeB, b.id, { enabled: false });
  const disabled = await Promise.allSettled([resolve(officeA), resolve(officeB)]);
  assert.ok(disabled[0].status === "fulfilled" && disabled[0].value.apiKey === "sk-office-a-only");
  assert.ok(disabled[1].status === "rejected" && disabled[1].reason instanceof AiConnectionError && disabled[1].reason.code === "not_found");
  // Clearing the assignment no longer disables the office: Lume supplies the model for the provider,
  // and only the credential is the office's to configure.
  await updateAiConnection(database, key, admin, officeB, b.id, { enabled: true, models: { chat: null, extraction: null, drafting: null } });
  const cleared = await Promise.allSettled([resolve(officeB), resolve(officeA)]);
  assert.ok(cleared[0].status === "fulfilled" && cleared[0].value.modelId === DEFAULT_CHAT_MODEL.anthropic);
  assert.equal(cleared[1].status, "fulfilled");
});

test("every supported provider can be stored and resolved with its own credential", async () => {
  const { database, admin, officeA, key } = fixture();
  for (const provider of AI_PROVIDERS) {
    const created = await createAiConnection(database, key, admin, officeA, {
      name: `Conexão ${provider}`, provider, apiKey: `sk-${provider}-live`,
      models: { chat: `${provider}-chat-model`, extraction: null, drafting: null },
    });
    assert.equal(created.provider, provider);
    const config = await resolveOfficeModelConfigFromDatabase(database, key, officeA, "chat");
    assert.deepEqual(modelFor(config), { providerId: provider, modelId: `${provider}-chat-model`, apiKey: `sk-${provider}-live` });
    assert.equal(JSON.stringify(created).includes(`sk-${provider}-live`), false);
    await updateAiConnection(database, key, admin, officeA, created.id, { models: { chat: null } });
    await deleteAiConnection(database, admin, officeA, created.id);
  }
});

test("dynamic model resolution supports an internally pinned run model", async () => {
  const { database, admin, officeA, key } = fixture();
  // Admin creates connection with only provider and apiKey, no assigned models
  await createAiConnection(database, key, admin, officeA, {
    name: "Inception Principal",
    provider: "inception",
    apiKey: "sk-inception-test-key",
    models: { chat: null, extraction: null, drafting: null },
  });

  // Without a requested model the office still resolves: Lume owns the default for the provider.
  const fallback = await resolveOfficeModelConfigFromDatabase(database, key, officeA, "chat");
  assert.equal(fallback.provider, "inception");
  assert.equal(fallback.modelId, DEFAULT_CHAT_MODEL.inception);

  // Embedding is stricter: a provider with no embeddings endpoint is not silently substituted.
  await assert.rejects(() => resolveOfficeModelConfigFromDatabase(database, key, officeA, "embedding"),
    (err) => err instanceof AiConnectionError && err.code === "not_found"
  );

  // Queued runs can pin the model chosen by the administrator when the run was created.
  const resolved = await resolveOfficeModelConfigFromDatabase(database, key, officeA, "chat", {
    provider: "inception",
    modelId: "mercury-2.5",
  });
  assert.equal(resolved.provider, "inception");
  assert.equal(resolved.modelId, "mercury-2.5");
  assert.equal(resolved.apiKey, "sk-inception-test-key");

  // Calling with unconfigured provider throws not_found
  await assert.rejects(() => resolveOfficeModelConfigFromDatabase(database, key, officeA, "chat", {
      provider: "openai",
      modelId: "gpt-4o",
    }),
    (err) => err instanceof AiConnectionError && err.code === "not_found"
  );
});
