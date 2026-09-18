import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import {
  credentialHint, credentialNeedsReencryption, CredentialDecryptError, decryptCredential, encryptCredential, type CredentialKeyring,
} from "./platform-crypto";

type MasterKey = Uint8Array | CredentialKeyring;

export const AI_PROVIDERS = ["openai", "anthropic", "google", "deepseek", "inception", "openrouter", "vercel"] as const;
export const AI_TASKS = ["chat", "extraction", "drafting"] as const;
export type AiProvider = typeof AI_PROVIDERS[number];
export type AiTask = typeof AI_TASKS[number];

export type ConnectionInput = {
  name: string;
  provider: AiProvider;
  apiKey: string;
  enabled?: boolean;
  models: Record<AiTask, string | null>;
};

export type ConnectionPatch = Partial<Omit<ConnectionInput, "apiKey" | "models">> & { apiKey?: string; models?: Partial<Record<AiTask, string | null>> };

// Shape and size checks for HTTP bodies; business rules and their messages stay in the functions below.
const modelField = z.string().max(160).nullable().optional();
const modelsSchema = z.strictObject({ chat: modelField, extraction: modelField, drafting: modelField });
const nameField = z.string().max(200);
const apiKeyField = z.string().max(4096);
export const connectionInputSchema = z.strictObject({
  name: nameField, provider: z.enum(AI_PROVIDERS), apiKey: apiKeyField, enabled: z.boolean().optional(), models: modelsSchema.optional(),
});
export const connectionPatchSchema = z.strictObject({
  name: nameField.optional(), provider: z.enum(AI_PROVIDERS).optional(), apiKey: apiKeyField.optional(), enabled: z.boolean().optional(), models: modelsSchema.optional(),
});
export const connectionTestSchema = z.strictObject({ task: z.enum(AI_TASKS).optional() });

type Row = {
  id: string; office_id: string; name: string; provider: AiProvider; encrypted_api_key: string | null; api_key_hint: string;
  chat_model: string | null; extraction_model: string | null; drafting_model: string | null; enabled: number;
  created_at: string; updated_at: string; deleted_at: string | null;
};

export type AiConnectionView = ReturnType<typeof toView>;

export class AiConnectionError extends Error {
  constructor(public readonly code: "invalid" | "not_found" | "conflict" | "in_use" | "disabled" | "credential" | "provider", message: string) { super(message); }
}

function cleanModel(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || value.trim().length > 160) throw new AiConnectionError("invalid", "Modelo inválido.");
  return value.trim();
}

function validateName(value: unknown): string {
  if (typeof value !== "string" || value.trim().length < 2 || value.trim().length > 80) throw new AiConnectionError("invalid", "Use um nome entre 2 e 80 caracteres.");
  return value.trim();
}

function validateProvider(value: unknown): AiProvider {
  if (!AI_PROVIDERS.includes(value as AiProvider)) throw new AiConnectionError("invalid", "Provider não suportado.");
  return value as AiProvider;
}

function cleanModels(models: Partial<Record<AiTask, unknown>> | undefined): Record<AiTask, string | null> {
  return { chat: cleanModel(models?.chat), extraction: cleanModel(models?.extraction), drafting: cleanModel(models?.drafting) };
}

function toView(row: Row) {
  return {
    id: row.id, officeId: row.office_id, name: row.name, provider: row.provider, keyHint: row.api_key_hint,
    models: { chat: row.chat_model, extraction: row.extraction_model, drafting: row.drafting_model },
    enabled: Boolean(row.enabled), createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function audit(db: DatabaseSync, actorUserId: string, officeId: string | null, connectionId: string | null, action: string, details: object = {}) {
  db.prepare("INSERT INTO platform_audit_log (id, actor_user_id, office_id, connection_id, action, details_json) VALUES (?, ?, ?, ?, ?, ?)")
    .run(randomUUID(), actorUserId, officeId, connectionId, action, JSON.stringify(details));
}

function assignTasksExclusively(db: DatabaseSync, officeId: string, connectionId: string, models: Record<AiTask, string | null>) {
  for (const task of AI_TASKS) {
    if (models[task]) db.prepare(`UPDATE ai_connection SET ${task}_model = NULL, updated_at = CURRENT_TIMESTAMP WHERE office_id = ? AND id <> ? AND deleted_at IS NULL AND ${task}_model IS NOT NULL`).run(officeId, connectionId);
  }
}

export function listOfficesForPlatform(db: DatabaseSync) {
  return db.prepare(`SELECT o.id, o.name, o.created_at AS createdAt,
    count(c.id) AS connectionCount,
    sum(CASE WHEN c.enabled = 1 AND c.deleted_at IS NULL THEN 1 ELSE 0 END) AS enabledConnectionCount
    FROM office o LEFT JOIN ai_connection c ON c.office_id = o.id AND c.deleted_at IS NULL
    GROUP BY o.id ORDER BY o.name COLLATE NOCASE`).all() as Array<{ id: string; name: string; createdAt: string; connectionCount: number; enabledConnectionCount: number }>;
}

export function getOfficeForPlatform(db: DatabaseSync, officeId: string) {
  return db.prepare("SELECT id, name, created_at AS createdAt FROM office WHERE id = ?").get(officeId) as { id: string; name: string; createdAt: string } | undefined;
}

export function listAiConnections(db: DatabaseSync, officeId: string): AiConnectionView[] {
  return (db.prepare("SELECT * FROM ai_connection WHERE office_id = ? AND deleted_at IS NULL ORDER BY name COLLATE NOCASE").all(officeId) as Row[]).map(toView);
}

export function createAiConnection(db: DatabaseSync, key: MasterKey, actorUserId: string, officeId: string, input: Omit<ConnectionInput, "models"> & { models?: ConnectionPatch["models"] }): AiConnectionView {
  if (!getOfficeForPlatform(db, officeId)) throw new AiConnectionError("not_found", "Escritório não encontrado.");
  const id = randomUUID();
  const name = validateName(input.name);
  const provider = validateProvider(input.provider);
  const models = cleanModels(input.models);
  const apiKey = input.apiKey?.trim();
  if (!apiKey) throw new AiConnectionError("invalid", "Informe a chave do provider.");
  db.exec("SAVEPOINT create_ai_connection");
  try {
    assignTasksExclusively(db, officeId, id, models);
    db.prepare(`INSERT INTO ai_connection
      (id, office_id, name, provider, encrypted_api_key, api_key_hint, chat_model, extraction_model, drafting_model, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, officeId, name, provider, encryptCredential(apiKey, key), credentialHint(apiKey), models.chat, models.extraction, models.drafting, input.enabled === false ? 0 : 1);
    audit(db, actorUserId, officeId, id, "ai_connection.created", { name, provider, enabled: input.enabled !== false, models });
    db.exec("RELEASE create_ai_connection");
  } catch (error) {
    db.exec("ROLLBACK TO create_ai_connection; RELEASE create_ai_connection");
    if (String(error).includes("UNIQUE constraint failed")) throw new AiConnectionError("conflict", "Já existe uma conexão com esse nome neste escritório.");
    throw error;
  }
  return listAiConnections(db, officeId).find((item) => item.id === id)!;
}

export function updateAiConnection(db: DatabaseSync, key: MasterKey, actorUserId: string, officeId: string, connectionId: string, patch: ConnectionPatch): AiConnectionView {
  const current = db.prepare("SELECT * FROM ai_connection WHERE id = ? AND office_id = ? AND deleted_at IS NULL").get(connectionId, officeId) as Row | undefined;
  if (!current) throw new AiConnectionError("not_found", "Conexão não encontrada.");
  const name = patch.name === undefined ? current.name : validateName(patch.name);
  const provider = patch.provider === undefined ? current.provider : validateProvider(patch.provider);
  const models = patch.models === undefined ? { chat: current.chat_model, extraction: current.extraction_model, drafting: current.drafting_model } : cleanModels(patch.models);
  const apiKey = patch.apiKey?.trim();
  if (patch.apiKey !== undefined && !apiKey) throw new AiConnectionError("invalid", "A nova chave não pode estar vazia.");
  const encrypted = apiKey ? encryptCredential(apiKey, key) : current.encrypted_api_key;
  const hint = apiKey ? credentialHint(apiKey) : current.api_key_hint;
  const enabled = patch.enabled === undefined ? current.enabled : patch.enabled ? 1 : 0;
  db.exec("SAVEPOINT update_ai_connection");
  try {
    assignTasksExclusively(db, officeId, connectionId, models);
    db.prepare(`UPDATE ai_connection SET name = ?, provider = ?, encrypted_api_key = ?, api_key_hint = ?, chat_model = ?, extraction_model = ?, drafting_model = ?, enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND office_id = ?`)
      .run(name, provider, encrypted, hint, models.chat, models.extraction, models.drafting, enabled, connectionId, officeId);
    audit(db, actorUserId, officeId, connectionId, apiKey ? "ai_connection.key_rotated" : "ai_connection.updated", { name, provider, enabled: Boolean(enabled), models });
    db.exec("RELEASE update_ai_connection");
  } catch (error) {
    db.exec("ROLLBACK TO update_ai_connection; RELEASE update_ai_connection");
    if (String(error).includes("UNIQUE constraint failed")) throw new AiConnectionError("conflict", "Já existe uma conexão com esse nome neste escritório.");
    throw error;
  }
  return listAiConnections(db, officeId).find((item) => item.id === connectionId)!;
}

export function deleteAiConnection(db: DatabaseSync, actorUserId: string, officeId: string, connectionId: string): void {
  const current = db.prepare("SELECT * FROM ai_connection WHERE id = ? AND office_id = ? AND deleted_at IS NULL").get(connectionId, officeId) as Row | undefined;
  if (!current) throw new AiConnectionError("not_found", "Conexão não encontrada.");
  if (current.chat_model || current.extraction_model || current.drafting_model) throw new AiConnectionError("in_use", "Remova as atribuições de modelos antes de excluir a conexão.");
  db.exec("SAVEPOINT delete_ai_connection");
  try {
    db.prepare("UPDATE ai_connection SET encrypted_api_key = NULL, enabled = 0, deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND office_id = ?").run(connectionId, officeId);
    audit(db, actorUserId, officeId, connectionId, "ai_connection.deleted", { name: current.name, provider: current.provider });
    db.exec("RELEASE delete_ai_connection");
  } catch (error) { db.exec("ROLLBACK TO delete_ai_connection; RELEASE delete_ai_connection"); throw error; }
}

function readSecret(payload: string, key: MasterKey) {
  try { return decryptCredential(payload, key); } catch (error) {
    if (error instanceof CredentialDecryptError) throw new AiConnectionError("credential", "Não foi possível ler a credencial armazenada. Confira a chave mestra ou substitua a chave da conexão.");
    throw error;
  }
}

export function resolveOfficeModelConfigFromDatabase(
  db: DatabaseSync,
  key: MasterKey,
  officeId: string,
  task: AiTask,
  requestedModel?: { provider?: string; modelId?: string }
) {
  if (!AI_TASKS.includes(task)) throw new AiConnectionError("invalid", "Perfil de tarefa inválido.");

  if (requestedModel?.provider && requestedModel?.modelId) {
    const row = db.prepare(
      "SELECT * FROM ai_connection WHERE office_id = ? AND enabled = 1 AND deleted_at IS NULL AND provider = ? ORDER BY updated_at DESC, id LIMIT 1"
    ).get(officeId, requestedModel.provider) as Row | undefined;
    if (!row || !row.encrypted_api_key) {
      throw new AiConnectionError("not_found", `Nenhum provedor ${requestedModel.provider} ativo configurado no escritório.`);
    }
    return {
      provider: row.provider,
      modelId: requestedModel.modelId,
      apiKey: readSecret(row.encrypted_api_key, key),
      connectionId: row.id,
    };
  }

  const column = `${task}_model`;
  const row = db.prepare(`SELECT * FROM ai_connection WHERE office_id = ? AND enabled = 1 AND deleted_at IS NULL AND ${column} IS NOT NULL ORDER BY updated_at DESC, id LIMIT 1`).get(officeId) as Row | undefined;
  if (!row || !row.encrypted_api_key) throw new AiConnectionError("not_found", `Nenhum modelo ativo configurado para ${task}.`);
  return { provider: row.provider, modelId: row[column as keyof Row] as string, apiKey: readSecret(row.encrypted_api_key, key), connectionId: row.id };
}

export type ResolvedModelConfig = {
  provider: AiProvider;
  modelId: string;
  apiKey: string;
  connectionId: string;
};

// Tests any enabled connection of the office with its own model, independent of which connection currently serves the task.
export async function testAiConnection(
  db: DatabaseSync, key: MasterKey, actorUserId: string, officeId: string, connectionId: string, requestedTask: AiTask | undefined,
  send: (config: ResolvedModelConfig) => Promise<unknown>,
) {
  const row = db.prepare("SELECT * FROM ai_connection WHERE id = ? AND office_id = ? AND deleted_at IS NULL").get(connectionId, officeId) as Row | undefined;
  if (!row || !row.encrypted_api_key) throw new AiConnectionError("not_found", "Conexão não encontrada.");
  if (!row.enabled) throw new AiConnectionError("disabled", "Ative a conexão antes de testar.");
  const task = requestedTask ?? AI_TASKS.find((item) => row[`${item}_model`]);
  const modelId = task ? row[`${task}_model`] : null;
  if (!task || !modelId) throw new AiConnectionError("invalid", "Salve um modelo para a tarefa antes de testar.");
  const details = { task, provider: row.provider, modelId };
  let config: ResolvedModelConfig;
  try { config = { provider: row.provider, modelId, apiKey: readSecret(row.encrypted_api_key, key), connectionId: row.id }; } catch (error) {
    audit(db, actorUserId, officeId, connectionId, "ai_connection.tested", { ...details, result: "failed", reason: "credential" });
    throw error;
  }
  try { await send(config); } catch {
    // Provider errors may echo request data or masked keys: never propagate or log their text.
    audit(db, actorUserId, officeId, connectionId, "ai_connection.tested", { ...details, result: "failed", reason: "provider" });
    throw new AiConnectionError("provider", "O provider recusou a requisição de teste. Confira a chave e o modelo.");
  }
  audit(db, actorUserId, officeId, connectionId, "ai_connection.tested", { ...details, result: "ok" });
  return { task, modelId };
}

function pendingReencryption(db: DatabaseSync, keyring: CredentialKeyring) {
  const rows = db.prepare("SELECT id, office_id, encrypted_api_key FROM ai_connection WHERE deleted_at IS NULL AND encrypted_api_key IS NOT NULL").all() as Array<{ id: string; office_id: string; encrypted_api_key: string }>;
  return { total: rows.length, pending: rows.filter((row) => { try { return credentialNeedsReencryption(row.encrypted_api_key, keyring); } catch { return true; } }) };
}

export function countSecretsNeedingReencryption(db: DatabaseSync, keyring: CredentialKeyring): number {
  return pendingReencryption(db, keyring).pending.length;
}

// Re-encrypts every stored secret with the current master key in one transaction; any unreadable secret aborts all changes.
export function reencryptAiConnectionSecrets(db: DatabaseSync, keyring: CredentialKeyring, actorUserId: string) {
  const { total, pending } = pendingReencryption(db, keyring);
  db.exec("SAVEPOINT reencrypt_ai_connections");
  try {
    for (const row of pending) {
      db.prepare("UPDATE ai_connection SET encrypted_api_key = ? WHERE id = ?").run(encryptCredential(readSecret(row.encrypted_api_key, keyring), keyring), row.id);
      audit(db, actorUserId, row.office_id, row.id, "ai_connection.master_key_reencrypted", { keyId: keyring.current.id });
    }
    db.exec("RELEASE reencrypt_ai_connections");
  } catch (error) { db.exec("ROLLBACK TO reencrypt_ai_connections; RELEASE reencrypt_ai_connections"); throw error; }
  return { total, reencrypted: pending.length, keyId: keyring.current.id };
}
