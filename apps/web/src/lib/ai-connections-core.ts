import { randomUUID } from "node:crypto";
import type { Database } from "./database";
import { z } from "zod";
import {
  credentialHint, credentialNeedsReencryption, CredentialDecryptError, decryptCredential, encryptCredential, type CredentialKeyring,
} from "./platform-crypto";
import { defaultChatModel, defaultEmbeddingModel } from "./ai-defaults";

type MasterKey = Uint8Array | CredentialKeyring;

export const AI_PROVIDERS = ["openai", "anthropic", "google", "deepseek", "inception", "openrouter", "vercel"] as const;
// Embedding is its own profile: model and dimension are fixed per index generation, so it must
// never inherit whatever the chat profile happens to point at.
export const AI_TASKS = ["chat", "extraction", "drafting", "embedding"] as const;
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
const modelsSchema = z.strictObject({ chat: modelField, extraction: modelField, drafting: modelField, embedding: modelField });
const nameField = z.string().max(200);
const apiKeyField = z.string().max(4096);
export const connectionInputSchema = z.strictObject({
  name: nameField, provider: z.enum(AI_PROVIDERS), apiKey: apiKeyField, enabled: z.boolean().optional(), models: modelsSchema.optional(),
});
export const connectionPatchSchema = z.strictObject({
  name: nameField.optional(), provider: z.enum(AI_PROVIDERS).optional(), apiKey: apiKeyField.optional(), enabled: z.boolean().optional(), models: modelsSchema.optional(),
});
export const connectionTestSchema = z.strictObject({ task: z.enum(AI_TASKS).optional() });

/**
 * Lume's AI connections belong to the platform: one set of providers and task models serves every
 * office (migration 0022). A platform connection is a row with no office; rows that still carry an
 * office are the per-office configuration from before, kept on record and never read.
 */
type Row = {
  id: string; office_id: string | null; name: string; provider: AiProvider; encrypted_api_key: string | null; api_key_hint: string;
  chat_model: string | null; extraction_model: string | null; drafting_model: string | null; embedding_model: string | null; enabled: number;
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
  return { chat: cleanModel(models?.chat), extraction: cleanModel(models?.extraction), drafting: cleanModel(models?.drafting), embedding: cleanModel(models?.embedding) };
}

function toView(row: Row) {
  return {
    id: row.id, name: row.name, provider: row.provider, keyHint: row.api_key_hint,
    models: { chat: row.chat_model, extraction: row.extraction_model, drafting: row.drafting_model, embedding: row.embedding_model },
    enabled: Boolean(row.enabled), createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

const AUDIT_SQL = "INSERT INTO platform_audit_log (id, actor_user_id, office_id, connection_id, action, details_json) VALUES (?, ?, ?, ?, ?, ?)";

async function audit(db: Database, actorUserId: string, officeId: string | null, connectionId: string | null, action: string, details: object = {}) {
  await db.prepare(AUDIT_SQL).run(randomUUID(), actorUserId, officeId, connectionId, action, JSON.stringify(details));
}

/** The same row as `audit`, bound rather than executed, for callers writing inside a batch. */
function auditStatement(db: Database, actorUserId: string, officeId: string | null, connectionId: string | null, action: string, details: object = {}) {
  return db.prepare(AUDIT_SQL).bind(randomUUID(), actorUserId, officeId, connectionId, action, JSON.stringify(details));
}

/**
 * Clears each task assignment from every other platform connection.
 *
 * Returns bound statements rather than running them, so the exclusivity, the write it protects
 * and the audit row all land in one batch: between them, two connections would otherwise claim
 * the same task, and whichever one a request read first would win.
 */
function releaseTaskAssignments(db: Database, connectionId: string, models: Record<AiTask, string | null>) {
  return AI_TASKS.filter((task) => models[task]).map((task) =>
    db.prepare(`UPDATE ai_connection SET ${task}_model = NULL, updated_at = CURRENT_TIMESTAMP WHERE office_id IS NULL AND id <> ? AND deleted_at IS NULL AND ${task}_model IS NOT NULL`)
      .bind(connectionId));
}

/** The offices on the platform, with how many people each one has. */
export async function listOfficesForPlatform(db: Database) {
  return await db.prepare(`SELECT o.id, o.name, o.created_at AS createdAt, count(m.id) AS memberCount
    FROM office o LEFT JOIN office_member m ON m.office_id = o.id
    GROUP BY o.id ORDER BY lower(o.name)`).all() as Array<{ id: string; name: string; createdAt: string; memberCount: number }>;
}

export async function listAiConnections(db: Database): Promise<AiConnectionView[]> {
  return (await db.prepare("SELECT * FROM ai_connection WHERE office_id IS NULL AND deleted_at IS NULL ORDER BY lower(name)").all() as Row[]).map(toView);
}

export async function createAiConnection(db: Database, key: MasterKey, actorUserId: string, input: Omit<ConnectionInput, "models"> & { models?: ConnectionPatch["models"] }): Promise<AiConnectionView> {
  const id = randomUUID();
  const name = validateName(input.name);
  const provider = validateProvider(input.provider);
  const models = cleanModels(input.models);
  const apiKey = input.apiKey?.trim();
  if (!apiKey) throw new AiConnectionError("invalid", "Informe a chave do provider.");
  try {
    await db.batch([
      ...releaseTaskAssignments(db, id, models),
      db.prepare(`INSERT INTO ai_connection
        (id, office_id, name, provider, encrypted_api_key, api_key_hint, chat_model, extraction_model, drafting_model, embedding_model, enabled)
        VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, name, provider, encryptCredential(apiKey, key), credentialHint(apiKey), models.chat, models.extraction, models.drafting, models.embedding, input.enabled === false ? 0 : 1),
      auditStatement(db, actorUserId, null, id, "ai_connection.created", { name, provider, enabled: input.enabled !== false, models }),
    ]);
  } catch (error) {
    if ((error as { code?: string })?.code === '23505') throw new AiConnectionError("conflict", "Já existe uma conexão com esse nome.");
    throw error;
  }
  return (await listAiConnections(db)).find((item) => item.id === id)!;
}

export async function updateAiConnection(db: Database, key: MasterKey, actorUserId: string, connectionId: string, patch: ConnectionPatch): Promise<AiConnectionView> {
  const current = await db.prepare("SELECT * FROM ai_connection WHERE id = ? AND office_id IS NULL AND deleted_at IS NULL").get(connectionId) as Row | undefined;
  if (!current) throw new AiConnectionError("not_found", "Conexão não encontrada.");
  const name = patch.name === undefined ? current.name : validateName(patch.name);
  const provider = patch.provider === undefined ? current.provider : validateProvider(patch.provider);
  const existingModels = { chat: current.chat_model, extraction: current.extraction_model, drafting: current.drafting_model, embedding: current.embedding_model };
  const models = patch.models === undefined ? existingModels : cleanModels({ ...existingModels, ...patch.models });
  const apiKey = patch.apiKey?.trim();
  if (patch.apiKey !== undefined && !apiKey) throw new AiConnectionError("invalid", "A nova chave não pode estar vazia.");
  const encrypted = apiKey ? encryptCredential(apiKey, key) : current.encrypted_api_key;
  const hint = apiKey ? credentialHint(apiKey) : current.api_key_hint;
  const enabled = patch.enabled === undefined ? current.enabled : patch.enabled ? 1 : 0;
  try {
    await db.batch([
      ...releaseTaskAssignments(db, connectionId, models),
      db.prepare(`UPDATE ai_connection SET name = ?, provider = ?, encrypted_api_key = ?, api_key_hint = ?, chat_model = ?, extraction_model = ?, drafting_model = ?, embedding_model = ?, enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND office_id IS NULL`)
        .bind(name, provider, encrypted, hint, models.chat, models.extraction, models.drafting, models.embedding, enabled, connectionId),
      auditStatement(db, actorUserId, null, connectionId, apiKey ? "ai_connection.key_rotated" : "ai_connection.updated", { name, provider, enabled: Boolean(enabled), models }),
    ]);
  } catch (error) {
    if ((error as { code?: string })?.code === '23505') throw new AiConnectionError("conflict", "Já existe uma conexão com esse nome.");
    throw error;
  }
  return (await listAiConnections(db)).find((item) => item.id === connectionId)!;
}

export async function deleteAiConnection(db: Database, actorUserId: string, connectionId: string): Promise<void> {
  const current = await db.prepare("SELECT * FROM ai_connection WHERE id = ? AND office_id IS NULL AND deleted_at IS NULL").get(connectionId) as Row | undefined;
  if (!current) throw new AiConnectionError("not_found", "Conexão não encontrada.");
  if (current.chat_model || current.extraction_model || current.drafting_model || current.embedding_model) throw new AiConnectionError("in_use", "Remova as atribuições de modelos antes de excluir a conexão.");
  const profiled = await db.prepare("SELECT 1 FROM ai_profile_override WHERE ? IN (connection_id, escalate_connection_id, shadow_connection_id) LIMIT 1").get(connectionId);
  if (profiled) throw new AiConnectionError("in_use", "Remova os ajustes por etapa que usam esta conexão antes de excluí-la.");
  // The secret is erased and the deletion is recorded together: a connection whose key is gone
  // with no audit row is a deletion nobody can account for.
  await db.batch([
    db.prepare("UPDATE ai_connection SET encrypted_api_key = NULL, enabled = 0, deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND office_id IS NULL")
      .bind(connectionId),
    auditStatement(db, actorUserId, null, connectionId, "ai_connection.deleted", { name: current.name, provider: current.provider }),
  ]);
}

function readSecret(payload: string, key: MasterKey) {
  try { return decryptCredential(payload, key); } catch (error) {
    if (error instanceof CredentialDecryptError) throw new AiConnectionError("credential", "Não foi possível ler a credencial armazenada. Confira a chave mestra ou substitua a chave da conexão.");
    throw error;
  }
}

/** The platform connection and model that serve a task, for every office. */
export async function resolveModelConfigFromDatabase(
  db: Database,
  key: MasterKey,
  task: AiTask,
  requestedModel?: { provider?: string; modelId?: string }
) {
  if (!AI_TASKS.includes(task)) throw new AiConnectionError("invalid", "Perfil de tarefa inválido.");

  if (requestedModel?.provider && requestedModel?.modelId) {
    const row = await db.prepare(
      "SELECT * FROM ai_connection WHERE office_id IS NULL AND enabled = 1 AND deleted_at IS NULL AND provider = ? ORDER BY updated_at DESC, id LIMIT 1"
    ).get(requestedModel.provider) as Row | undefined;
    if (!row || !row.encrypted_api_key) {
      throw new AiConnectionError("not_found", `Nenhum provedor ${requestedModel.provider} ativo configurado na plataforma.`);
    }
    return {
      provider: row.provider,
      modelId: requestedModel.modelId,
      apiKey: readSecret(row.encrypted_api_key, key),
      connectionId: row.id,
    };
  }

  const column = `${task}_model`;
  const assigned = await db.prepare(`SELECT * FROM ai_connection WHERE office_id IS NULL AND enabled = 1 AND deleted_at IS NULL AND ${column} IS NOT NULL ORDER BY updated_at DESC, id LIMIT 1`).get() as Row | undefined;
  if (assigned?.encrypted_api_key) {
    return { provider: assigned.provider, modelId: assigned[column as keyof Row] as string, apiKey: readSecret(assigned.encrypted_api_key, key), connectionId: assigned.id };
  }

  // Until the administrator assigns a model, Lume uses the provider fallback. Embedding is the
  // stricter case — only providers with an embeddings endpoint qualify, so
  // a platform whose single connection is Anthropic gets a clear "not configured" instead of a
  // request the provider cannot answer.
  const candidates = await db.prepare("SELECT * FROM ai_connection WHERE office_id IS NULL AND enabled = 1 AND deleted_at IS NULL ORDER BY updated_at DESC, id").all() as Row[];
  for (const row of candidates) {
    if (!row.encrypted_api_key) continue;
    const modelId = task === "embedding" ? defaultEmbeddingModel(row.provider) : defaultChatModel(row.provider);
    if (!modelId) continue;
    return { provider: row.provider, modelId, apiKey: readSecret(row.encrypted_api_key, key), connectionId: row.id };
  }
  throw new AiConnectionError("not_found", task === "embedding"
    ? "Nenhuma conexão ativa da plataforma oferece embeddings."
    : "Nenhuma conexão de IA ativa na plataforma.");
}

/** One enabled platform connection with an explicit model, or null when it is gone or disabled. */
export async function connectionModelConfig(db: Database, key: MasterKey, connectionId: string, modelId: string): Promise<ResolvedModelConfig | null> {
  const row = await db.prepare("SELECT * FROM ai_connection WHERE id = ? AND office_id IS NULL AND enabled = 1 AND deleted_at IS NULL").get(connectionId) as Row | undefined;
  if (!row?.encrypted_api_key) return null;
  return { provider: row.provider, modelId, apiKey: readSecret(row.encrypted_api_key, key), connectionId: row.id };
}

export type ResolvedModelConfig = {
  provider: AiProvider;
  modelId: string;
  apiKey: string;
  connectionId: string;
};

// Tests any enabled platform connection with its own model, independent of which connection currently serves the task.
export async function testAiConnection(
  db: Database, key: MasterKey, actorUserId: string, connectionId: string, requestedTask: AiTask | undefined,
  send: (config: ResolvedModelConfig) => Promise<unknown>,
) {
  const row = await db.prepare("SELECT * FROM ai_connection WHERE id = ? AND office_id IS NULL AND deleted_at IS NULL").get(connectionId) as Row | undefined;
  if (!row || !row.encrypted_api_key) throw new AiConnectionError("not_found", "Conexão não encontrada.");
  if (!row.enabled) throw new AiConnectionError("disabled", "Ative a conexão antes de testar.");
  const task = requestedTask ?? AI_TASKS.find((item) => row[`${item}_model`]) ?? "chat";
  // A connection with no assignment is tested with Lume's provider fallback.
  const modelId = row[`${task}_model`] ?? (task === "embedding" ? defaultEmbeddingModel(row.provider) : defaultChatModel(row.provider));
  if (!modelId) throw new AiConnectionError("invalid", "Este provider não tem um modelo padrão para esta tarefa.");
  const details = { task, provider: row.provider, modelId };
  let config: ResolvedModelConfig;
  try { config = { provider: row.provider, modelId, apiKey: readSecret(row.encrypted_api_key, key), connectionId: row.id }; } catch (error) {
    await audit(db, actorUserId, null, connectionId, "ai_connection.tested", { ...details, result: "failed", reason: "credential" });
    throw error;
  }
  try { await send(config); } catch {
    // Provider errors may echo request data or masked keys: never propagate or log their text.
    await audit(db, actorUserId, null, connectionId, "ai_connection.tested", { ...details, result: "failed", reason: "provider" });
    throw new AiConnectionError("provider", "O provider recusou a requisição de teste. Confira a chave e o modelo.");
  }
  await audit(db, actorUserId, null, connectionId, "ai_connection.tested", { ...details, result: "ok" });
  return { task, modelId };
}

async function pendingReencryption(db: Database, keyring: CredentialKeyring) {
  const rows = await db.prepare("SELECT 'ai_connection' AS kind,id,office_id,encrypted_api_key FROM ai_connection WHERE deleted_at IS NULL AND encrypted_api_key IS NOT NULL UNION ALL SELECT 'typesafe_connection' AS kind,office_id AS id,office_id,encrypted_api_key FROM typesafe_connection WHERE encrypted_api_key IS NOT NULL UNION ALL SELECT 'typesafe_platform' AS kind,'1' AS id,NULL AS office_id,encrypted_api_key FROM typesafe_platform_connection WHERE encrypted_api_key IS NOT NULL").all() as Array<{ kind: 'ai_connection' | 'typesafe_connection' | 'typesafe_platform'; id: string; office_id: string | null; encrypted_api_key: string }>;
  return { total: rows.length, pending: rows.filter((row) => { try { return credentialNeedsReencryption(row.encrypted_api_key, keyring); } catch { return true; } }) };
}

export async function countSecretsNeedingReencryption(db: Database, keyring: CredentialKeyring): Promise<number> {
  return (await pendingReencryption(db, keyring)).pending.length;
}
