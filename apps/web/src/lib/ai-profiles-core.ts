import { randomUUID } from "node:crypto";
import type { Database } from "./database";
import type { CredentialKeyring } from "./platform-crypto";
import {
  AiConnectionError, connectionModelConfig, resolveModelConfigFromDatabase, type AiProvider, type ResolvedModelConfig,
} from "./ai-connections-core";
import {
  AI_PROFILES, DEFAULT_REASONING_EFFORT, PROFILE_DEFINITIONS, profileOverrideSchema, REASONING_EFFORTS,
  type AiProfile, type ProfileOverrideInput, type ProfileOverrideView, type ProfileVariant, type ProfileVariantView, type ReasoningEffort,
} from "./ai-profiles";

type MasterKey = Uint8Array | CredentialKeyring;

type OverrideRow = {
  profile: AiProfile; connection_id: string | null; model_id: string | null;
  reasoning_effort: ReasoningEffort | null; max_output_tokens: number | null;
  escalate_connection_id: string | null; escalate_model_id: string | null; escalate_reasoning_effort: ReasoningEffort | null;
  shadow_connection_id: string | null; shadow_model_id: string | null; shadow_reasoning_effort: ReasoningEffort | null;
  updated_at: string;
};

/** A resolved model for one step: which credential and model, how hard it reasons, how much it may write. */
export type ProfileConfig = ResolvedModelConfig & { profile: AiProfile; reasoningEffort: ReasoningEffort; maxOutputTokens: number };

/**
 * What a run stores per step when it is queued, so a later change in the administration does not
 * reach it. `connectionId` is absent on pins written before it was stored; those resolve by provider.
 */
export type PinnedProfile = { provider: AiProvider; modelId: string; reasoningEffort: ReasoningEffort; maxOutputTokens: number; connectionId?: string };

const variantView = (connectionId: string | null, modelId: string | null, effort: ReasoningEffort | null): ProfileVariantView | null =>
  connectionId && modelId ? { connectionId, modelId, reasoningEffort: effort } : null;

function toView(profile: AiProfile, row: OverrideRow | undefined): ProfileOverrideView {
  return {
    profile,
    connectionId: row?.connection_id ?? null, modelId: row?.model_id ?? null,
    reasoningEffort: row?.reasoning_effort ?? null, maxOutputTokens: row?.max_output_tokens ?? null,
    escalate: variantView(row?.escalate_connection_id ?? null, row?.escalate_model_id ?? null, row?.escalate_reasoning_effort ?? null),
    shadow: variantView(row?.shadow_connection_id ?? null, row?.shadow_model_id ?? null, row?.shadow_reasoning_effort ?? null),
    updatedAt: row?.updated_at ?? null,
  };
}

async function overrideRow(db: Database, profile: AiProfile) {
  return await db.prepare("SELECT * FROM ai_profile_override WHERE profile = ?").get(profile) as OverrideRow | undefined;
}

/** Every profile, including the ones that only inherit, in a fixed order. */
export async function listProfileOverrides(db: Database): Promise<ProfileOverrideView[]> {
  const rows = await db.prepare("SELECT * FROM ai_profile_override").all() as OverrideRow[];
  return AI_PROFILES.map((profile) => toView(profile, rows.find((row) => row.profile === profile)));
}

async function assertConnection(db: Database, connectionId: string) {
  const exists = await db.prepare("SELECT 1 FROM ai_connection WHERE id = ? AND office_id IS NULL AND deleted_at IS NULL").get(connectionId);
  if (!exists) throw new AiConnectionError("not_found", "Conexão não encontrada.");
}

/**
 * Saves one profile's settings. Fields left out keep their value; `null` returns them to what the
 * task inherits. A profile with nothing left is deleted, so "Voltar ao padrão" leaves no trace but
 * the audit row.
 */
export async function updateProfileOverride(db: Database, actorUserId: string, profile: AiProfile, raw: ProfileOverrideInput): Promise<ProfileOverrideView> {
  if (!AI_PROFILES.includes(profile)) throw new AiConnectionError("invalid", "Etapa inválida.");
  const patch = profileOverrideSchema.parse(raw);
  const current = toView(profile, await overrideRow(db, profile));
  const pick = <K extends keyof ProfileOverrideView>(key: K) => (patch[key as keyof ProfileOverrideInput] === undefined ? current[key] : patch[key as keyof ProfileOverrideInput]) as ProfileOverrideView[K];
  const next = {
    connectionId: pick("connectionId"), modelId: pick("modelId"), reasoningEffort: pick("reasoningEffort"), maxOutputTokens: pick("maxOutputTokens"),
    escalate: pick("escalate"), shadow: pick("shadow"),
  };
  if ((next.connectionId === null) !== (next.modelId === null)) throw new AiConnectionError("invalid", "Informe a conexão e o modelo juntos.");
  const allowed = PROFILE_DEFINITIONS[profile].variants;
  for (const variant of ["escalate", "shadow"] as const) {
    if (next[variant] && !allowed.includes(variant)) throw new AiConnectionError("invalid", "Esta etapa não aceita um segundo modelo.");
  }
  for (const connectionId of [next.connectionId, next.escalate?.connectionId, next.shadow?.connectionId]) {
    if (connectionId) await assertConnection(db, connectionId);
  }
  const empty = !next.connectionId && !next.reasoningEffort && !next.maxOutputTokens && !next.escalate && !next.shadow;
  const audit = db.prepare("INSERT INTO platform_audit_log (id, actor_user_id, office_id, connection_id, action, details_json) VALUES (?, ?, NULL, ?, ?, ?)")
    .bind(randomUUID(), actorUserId, next.connectionId, empty ? "ai_profile.reset" : "ai_profile.updated", JSON.stringify({ profile, ...next }));
  await db.batch([
    empty
      ? db.prepare("DELETE FROM ai_profile_override WHERE profile = ?").bind(profile)
      : db.prepare(`INSERT INTO ai_profile_override (profile, connection_id, model_id, reasoning_effort, max_output_tokens,
          escalate_connection_id, escalate_model_id, escalate_reasoning_effort, shadow_connection_id, shadow_model_id, shadow_reasoning_effort, updated_by, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT (profile) DO UPDATE SET connection_id = excluded.connection_id, model_id = excluded.model_id, reasoning_effort = excluded.reasoning_effort,
            max_output_tokens = excluded.max_output_tokens, escalate_connection_id = excluded.escalate_connection_id, escalate_model_id = excluded.escalate_model_id,
            escalate_reasoning_effort = excluded.escalate_reasoning_effort, shadow_connection_id = excluded.shadow_connection_id, shadow_model_id = excluded.shadow_model_id,
            shadow_reasoning_effort = excluded.shadow_reasoning_effort, updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`)
        .bind(profile, next.connectionId, next.modelId, next.reasoningEffort, next.maxOutputTokens,
          next.escalate?.connectionId ?? null, next.escalate?.modelId ?? null, next.escalate?.reasoningEffort ?? null,
          next.shadow?.connectionId ?? null, next.shadow?.modelId ?? null, next.shadow?.reasoningEffort ?? null, actorUserId),
    audit,
  ]);
  return toView(profile, await overrideRow(db, profile));
}

const effortOf = (value: unknown): ReasoningEffort =>
  (REASONING_EFFORTS as readonly unknown[]).includes(value) ? value as ReasoningEffort : DEFAULT_REASONING_EFFORT;

/**
 * The model and settings for one step. A pinned run keeps what it was queued with. Otherwise the
 * administrator's per-step model applies while its connection is enabled; without one, the step
 * falls back to its task, exactly as the Lume resolved models before profiles existed.
 */
export async function resolveProfileConfigFromDatabase(db: Database, key: MasterKey, profile: AiProfile, pinned?: Partial<PinnedProfile>): Promise<ProfileConfig> {
  const definition = PROFILE_DEFINITIONS[profile];
  if (!definition) throw new AiConnectionError("invalid", "Etapa inválida.");
  if (pinned?.provider && pinned.modelId) {
    // The credential the run was queued with; if that connection is gone or off, another of the
    // same provider serves it, as pins without a connection always did.
    const exact = pinned.connectionId ? await connectionModelConfig(db, key, pinned.connectionId, pinned.modelId) : null;
    const base = exact ?? await resolveModelConfigFromDatabase(db, key, definition.task, { provider: pinned.provider, modelId: pinned.modelId });
    return { ...base, profile, reasoningEffort: effortOf(pinned.reasoningEffort), maxOutputTokens: pinned.maxOutputTokens ?? definition.maxOutputTokens };
  }
  const row = await overrideRow(db, profile);
  const assigned = row?.connection_id && row.model_id ? await connectionModelConfig(db, key, row.connection_id, row.model_id) : null;
  const base = assigned ?? await resolveModelConfigFromDatabase(db, key, definition.task);
  return { ...base, profile, reasoningEffort: effortOf(row?.reasoning_effort), maxOutputTokens: row?.max_output_tokens ?? definition.maxOutputTokens };
}

/** The escalation or shadow model of a step, or null when none is set or its connection is off. */
export async function resolveProfileVariantFromDatabase(db: Database, key: MasterKey, profile: AiProfile, variant: ProfileVariant): Promise<ProfileConfig | null> {
  const row = await overrideRow(db, profile);
  const connectionId = row?.[`${variant}_connection_id`];
  const modelId = row?.[`${variant}_model_id`];
  if (!row || !connectionId || !modelId) return null;
  const config = await connectionModelConfig(db, key, connectionId, modelId);
  if (!config) return null;
  return { ...config, profile, reasoningEffort: effortOf(row[`${variant}_reasoning_effort`]), maxOutputTokens: row.max_output_tokens ?? PROFILE_DEFINITIONS[profile].maxOutputTokens };
}

export const pinProfile = (config: ProfileConfig): PinnedProfile =>
  ({ provider: config.provider, modelId: config.modelId, reasoningEffort: config.reasoningEffort, maxOutputTokens: config.maxOutputTokens, connectionId: config.connectionId });
