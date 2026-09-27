import { z } from "zod";
import type { Database } from "./database";
import { AiConnectionError, auditStatement, readSecret, type AiProvider, type MasterKey, type ResolvedModelConfig } from "./ai-connections-core";
import { defaultChatModel, isChatModel } from "./ai-defaults";
import { chatHearsAudio, modelModalities } from "./ai-modalities";
import {
  AI_TASK_DEFINITIONS, AI_TASK_GROUP_DEFINITIONS, AI_TASK_GROUPS, AI_TASK_KEYS, REASONING_EFFORTS, groupChain, isAiTaskGroup, isAiTaskKey,
  isTranscriptionModel, supportsReasoningEffort, type AiTaskGroup, type AiTaskKey, type ExecutionKind, type ReasoningEffort,
} from "./ai-tasks";

/**
 * Which connection, model and reasoning effort serve each task (catalog in ai-tasks.ts).
 *
 * Resolution walks from the task to its group and up the group's parents. The model and the effort
 * are looked up separately: the first level that sets a model decides the model, and the first level
 * that sets an effort decides the effort. A level that sets nothing inherits.
 *
 * Missing and broken are different. A task with no model anywhere in its chain uses the default of
 * its root group. A task whose chosen connection is disabled or deleted fails with a clear error:
 * it never moves to another provider on its own.
 */

export type AssignmentScope = "group" | "task";
export type ModelMode = "inherit" | "explicit" | "disabled";
export type EffortMode = "inherit" | "provider_default" | "explicit";

export type AssignmentRow = {
  scope: AssignmentScope; target: string; model_mode: ModelMode; connection_id: string | null; model_id: string | null;
  effort_mode: EffortMode; reasoning_effort: ReasoningEffort | null; updated_at: string; updated_by: string | null;
};

type ConnectionSummary = { id: string; name: string; provider: AiProvider; enabled: boolean; deleted: boolean; hasKey: boolean };

/** Everything resolution reads, loaded once. No secret is part of it. */
export type AssignmentSnapshot = { rows: AssignmentRow[]; connections: ConnectionSummary[] };

export type Level = { scope: AssignmentScope; target: string };
/** Where a value came from: an assignment row, or the default of the chain's root group. */
export type Origin = Level | { scope: "default" };
/** Why an effort set up the chain was not sent: the provider takes none, or it was chosen for another provider. */
export type EffortNote = "unsupported" | "other_provider";

export type TaskModelPlan =
  | { status: "ready"; connectionId: string; connectionName: string; provider: AiProvider; modelId: string; effort: ReasoningEffort | null;
      modelOrigin: Origin; effortOrigin: Origin; effortNote?: EffortNote }
  | { status: "disabled"; modelOrigin: Origin; reason: "assignment" | "unsupported" }
  | { status: "unavailable"; modelOrigin: Origin; message: string }
  | { status: "unconfigured"; message: string };

export type ResolvedTaskModel = ResolvedModelConfig & {
  task: AiTaskKey;
  effort: ReasoningEffort | null;
  /** `task:<key>`, `group:<key>`, `default` or `run`; recorded with the usage. */
  modelSource: string;
  effortSource: string;
};

/** The transcription endpoint model used when the agent runs on OpenAI and transcription is unassigned. */
export const DEFAULT_TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";
const UNCONFIGURED = "Nenhuma conexão de IA ativa na plataforma.";

export async function loadAssignmentSnapshot(db: Database): Promise<AssignmentSnapshot> {
  const [rows, connections] = await Promise.all([
    db.prepare("SELECT scope, target, model_mode, connection_id, model_id, effort_mode, reasoning_effort, updated_at, updated_by FROM ai_model_assignment").all() as Promise<AssignmentRow[]>,
    db.prepare(`SELECT id, name, provider, enabled, deleted_at IS NOT NULL AS deleted, encrypted_api_key IS NOT NULL AS has_key
      FROM ai_connection WHERE office_id IS NULL ORDER BY updated_at DESC, id`).all() as Promise<Array<{ id: string; name: string; provider: AiProvider; enabled: number; deleted: boolean; has_key: boolean }>>,
  ]);
  return { rows, connections: connections.map(row => ({ id: row.id, name: row.name, provider: row.provider, enabled: Boolean(row.enabled), deleted: row.deleted, hasKey: row.has_key })) };
}

const rowOf = (snapshot: AssignmentSnapshot, level: Level) => snapshot.rows.find(row => row.scope === level.scope && row.target === level.target);
export const originKey = (origin: Origin) => origin.scope === "default" ? "default" : `${origin.scope}:${origin.target}`;

export function taskLevels(task: AiTaskKey): Level[] {
  return [{ scope: "task", target: task }, ...groupChain(AI_TASK_DEFINITIONS[task].group).map(group => ({ scope: "group" as const, target: group }))];
}
export function groupLevels(group: AiTaskGroup): Level[] {
  return groupChain(group).map(target => ({ scope: "group" as const, target }));
}

function levelLabel(level: Level | Origin): string {
  if (level.scope === "task" && isAiTaskKey(level.target)) return AI_TASK_DEFINITIONS[level.target].label;
  if (level.scope === "group" && isAiTaskGroup(level.target)) return AI_TASK_GROUP_DEFINITIONS[level.target].label;
  return "Tises";
}

const usable = (connection: ConnectionSummary | undefined): boolean =>
  Boolean(connection && connection.enabled && !connection.deleted && connection.hasKey);

type ModelPart =
  | { status: "ready"; index: number; origin: Origin; connection: ConnectionSummary; modelId: string }
  | Exclude<TaskModelPlan, { status: "ready" }>;

/** The model a chain resolves to, and the position of the level that decided it. */
function modelPart(levels: Level[], snapshot: AssignmentSnapshot): ModelPart {
  for (const [index, level] of levels.entries()) {
    const row = rowOf(snapshot, level);
    if (!row || row.model_mode === "inherit") continue;
    if (row.model_mode === "disabled") return { status: "disabled", modelOrigin: level, reason: "assignment" };
    const connection = snapshot.connections.find(item => item.id === row.connection_id);
    if (!connection || !usable(connection)) {
      const state = !connection || connection.deleted ? "foi excluída" : !connection.enabled ? "está desativada" : "está sem credencial";
      return { status: "unavailable", modelOrigin: level,
        message: `A conexão escolhida para ${levelLabel(level)} ${state}. Escolha outra em Administração › IA.` };
    }
    return { status: "ready", index, origin: level, connection, modelId: row.model_id! };
  }
  return rootDefault(levels.at(-1)!.target as AiTaskGroup, snapshot, levels.length);
}

/**
 * The model of a chain with no assignment. Transcription follows the agent's provider, as it did
 * before tasks had models: the transcription endpoint on OpenAI, the agent's own model when it hears
 * audio, and nothing otherwise. Every other chain uses the provider default of the first active
 * connection.
 */
function rootDefault(root: AiTaskGroup, snapshot: AssignmentSnapshot, index: number): ModelPart {
  const origin = { scope: "default" } as const;
  if (root === "transcription") {
    const agent = modelPart(groupLevels("agent"), snapshot);
    if (agent.status !== "ready") return agent.status === "unavailable" ? { ...agent, modelOrigin: origin } : agent;
    if (agent.connection.provider === "openai") return { status: "ready", index, origin, connection: agent.connection, modelId: DEFAULT_TRANSCRIPTION_MODEL };
    if (chatHearsAudio(agent.connection.provider, agent.modelId)) return { status: "ready", index, origin, connection: agent.connection, modelId: agent.modelId };
    return { status: "disabled", modelOrigin: origin, reason: "unsupported" };
  }
  const connection = snapshot.connections.find(item => usable(item));
  if (!connection) return { status: "unconfigured", message: UNCONFIGURED };
  return { status: "ready", index, origin, connection, modelId: defaultChatModel(connection.provider) };
}

function planLevels(levels: Level[], snapshot: AssignmentSnapshot): TaskModelPlan {
  const model = modelPart(levels, snapshot);
  if (model.status !== "ready") return model;
  const base = { status: "ready" as const, connectionId: model.connection.id, connectionName: model.connection.name, provider: model.connection.provider,
    modelId: model.modelId, modelOrigin: model.origin };
  const effortIndex = levels.findIndex(level => (rowOf(snapshot, level)?.effort_mode ?? "inherit") !== "inherit");
  if (effortIndex < 0) return { ...base, effort: null, effortOrigin: { scope: "default" } };
  const level = levels[effortIndex];
  const row = rowOf(snapshot, level)!;
  if (row.effort_mode === "provider_default") return { ...base, effort: null, effortOrigin: level };
  // An effort set above the level that chose the model was chosen for whatever that upper level
  // resolves to. It carries over to another model of the same provider, never to another provider.
  if (effortIndex > model.index) {
    const upper = modelPart(levels.slice(effortIndex), snapshot);
    if (upper.status !== "ready" || upper.connection.provider !== model.connection.provider) {
      return { ...base, effort: null, effortOrigin: level, effortNote: "other_provider" };
    }
  }
  if (!supportsReasoningEffort(model.connection.provider)) return { ...base, effort: null, effortOrigin: level, effortNote: "unsupported" };
  return { ...base, effort: row.reasoning_effort, effortOrigin: level };
}

export const planTask = (task: AiTaskKey, snapshot: AssignmentSnapshot) => planLevels(taskLevels(task), snapshot);
export const planGroup = (group: AiTaskGroup, snapshot: AssignmentSnapshot) => planLevels(groupLevels(group), snapshot);

function planError(task: AiTaskKey, plan: Exclude<TaskModelPlan, { status: "ready" }>): AiConnectionError {
  if (plan.status === "disabled") return new AiConnectionError("task_disabled", plan.reason === "unsupported"
    ? `${AI_TASK_DEFINITIONS[task].label} não está disponível com o modelo do Agente.`
    : `${AI_TASK_DEFINITIONS[task].label} está desativada em Administração › IA.`);
  if (plan.status === "unavailable") return new AiConnectionError("unavailable", plan.message);
  return new AiConnectionError("not_found", plan.message);
}

async function connectionSecret(db: Database, key: MasterKey, connectionId: string) {
  const row = await db.prepare("SELECT encrypted_api_key FROM ai_connection WHERE id = ? AND office_id IS NULL AND deleted_at IS NULL AND enabled = 1")
    .get(connectionId) as { encrypted_api_key: string | null } | undefined;
  return row?.encrypted_api_key ? readSecret(row.encrypted_api_key, key) : undefined;
}

/** The connection, credential, model and effort for one task, right now. */
export async function resolveTaskModelFromDatabase(db: Database, key: MasterKey, task: AiTaskKey): Promise<ResolvedTaskModel> {
  const plan = planTask(task, await loadAssignmentSnapshot(db));
  if (plan.status !== "ready") throw planError(task, plan);
  const apiKey = await connectionSecret(db, key, plan.connectionId);
  // The connection changed between the two reads: report it rather than guess.
  if (!apiKey) throw new AiConnectionError("unavailable", `A conexão escolhida para ${AI_TASK_DEFINITIONS[task].label} ficou indisponível. Tente de novo.`);
  return {
    task, provider: plan.provider, modelId: plan.modelId, apiKey, connectionId: plan.connectionId, effort: plan.effort,
    modelSource: originKey(plan.modelOrigin), effortSource: `${originKey(plan.effortOrigin)}${plan.effortNote ? `:${plan.effortNote}` : ""}`,
  };
}

// ---------- Runs: the plan a queued run keeps ----------

export const RUN_MODEL_PLAN_VERSION = 1;
const pinnedTaskSchema = z.object({
  connectionId: z.string().min(1), provider: z.string().min(1), modelId: z.string().min(1), effort: z.enum(REASONING_EFFORTS).nullable(),
});
const runModelPlanSchema = z.object({ version: z.literal(RUN_MODEL_PLAN_VERSION), tasks: z.record(z.string(), pinnedTaskSchema) });
export type RunModelPlan = z.infer<typeof runModelPlanSchema>;

/** Fixes the models of a run's tasks when it is queued, so an admin change never alters a run halfway. */
export function pinRunModelPlan(snapshot: AssignmentSnapshot, tasks: AiTaskKey[]): RunModelPlan {
  const pinned: RunModelPlan["tasks"] = {};
  for (const task of tasks) {
    const plan = planTask(task, snapshot);
    if (plan.status !== "ready") throw planError(task, plan);
    pinned[task] = { connectionId: plan.connectionId, provider: plan.provider, modelId: plan.modelId, effort: plan.effort };
  }
  return { version: RUN_MODEL_PLAN_VERSION, tasks: pinned };
}

const RUN_UNAVAILABLE = "A conexão de IA fixada para esta tarefa foi desativada, excluída ou mudou de provider. Inicie a tarefa de novo.";

/**
 * The pinned model of one of a run's tasks. The credential is read now, so a rotated key keeps
 * working; a disabled or deleted connection, or one whose provider changed, stops the run.
 */
export async function resolvePinnedTaskModel(db: Database, key: MasterKey, rawPlan: unknown, task: AiTaskKey): Promise<ResolvedTaskModel> {
  const parsed = runModelPlanSchema.safeParse(typeof rawPlan === "string" ? JSON.parse(rawPlan) : rawPlan);
  const entry = parsed.success ? parsed.data.tasks[task] : undefined;
  if (!entry) throw new AiConnectionError("unavailable", "Esta tarefa foi criada por outra versão do Tises. Inicie a tarefa de novo.");
  const row = await db.prepare("SELECT provider, enabled, deleted_at, encrypted_api_key FROM ai_connection WHERE id = ? AND office_id IS NULL")
    .get(entry.connectionId) as { provider: string; enabled: number; deleted_at: string | null; encrypted_api_key: string | null } | undefined;
  if (!row || row.deleted_at || !row.enabled || !row.encrypted_api_key || row.provider !== entry.provider) throw new AiConnectionError("unavailable", RUN_UNAVAILABLE);
  return {
    task, provider: entry.provider as AiProvider, modelId: entry.modelId, apiKey: readSecret(row.encrypted_api_key, key), connectionId: entry.connectionId,
    effort: entry.effort, modelSource: "run", effortSource: "run",
  };
}

/**
 * Runs queued before migration 0029 pinned a provider and a model, and took the most recent active
 * connection of that provider, with the xhigh effort every OpenAI call carried then.
 */
export async function resolveLegacyRunModel(db: Database, key: MasterKey, task: AiTaskKey, provider: string, modelId: string): Promise<ResolvedTaskModel> {
  const row = await db.prepare("SELECT id, provider, encrypted_api_key FROM ai_connection WHERE office_id IS NULL AND enabled = 1 AND deleted_at IS NULL AND provider = ? ORDER BY updated_at DESC, id LIMIT 1")
    .get(provider) as { id: string; provider: AiProvider; encrypted_api_key: string | null } | undefined;
  if (!row?.encrypted_api_key) throw new AiConnectionError("unavailable", RUN_UNAVAILABLE);
  return {
    task, provider: row.provider, modelId, apiKey: readSecret(row.encrypted_api_key, key), connectionId: row.id,
    effort: supportsReasoningEffort(row.provider) ? "xhigh" : null, modelSource: "run:legacy", effortSource: "run:legacy",
  };
}

// ---------- Administration ----------

const levelSchema = { scope: z.enum(["group", "task"]), target: z.string().min(1).max(80) };
export const assignmentUpdateSchema = z.strictObject({
  ...levelSchema,
  model: z.discriminatedUnion("mode", [
    z.strictObject({ mode: z.literal("inherit") }),
    z.strictObject({ mode: z.literal("disabled") }),
    z.strictObject({ mode: z.literal("explicit"), connectionId: z.string().min(1).max(80), modelId: z.string().max(200) }),
  ]),
  effort: z.discriminatedUnion("mode", [
    z.strictObject({ mode: z.literal("inherit") }),
    z.strictObject({ mode: z.literal("provider_default") }),
    z.strictObject({ mode: z.literal("explicit"), value: z.enum(REASONING_EFFORTS) }),
  ]),
});
export type AssignmentUpdate = z.infer<typeof assignmentUpdateSchema>;
export const assignmentTestSchema = z.strictObject(levelSchema);

function validLevel(scope: AssignmentScope, target: string): Level & { group: AiTaskGroup; levels: Level[] } {
  if (scope === "group" && isAiTaskGroup(target)) return { scope, target, group: target, levels: groupLevels(target) };
  if (scope === "task" && isAiTaskKey(target)) return { scope, target, group: AI_TASK_DEFINITIONS[target].group, levels: taskLevels(target) };
  throw new AiConnectionError("invalid", "Tarefa desconhecida.");
}

/** Whether a model can run a task of this kind. Transcription models answer on their own endpoint. */
export function modelFitsExecution(execution: ExecutionKind, provider: AiProvider, modelId: string): boolean {
  if (execution === "transcription") return isTranscriptionModel(provider, modelId) || chatHearsAudio(provider, modelId);
  return isChatModel(modelId) && !isTranscriptionModel(provider, modelId);
}

const rowSummary = (row: AssignmentRow | undefined) => row
  ? { model: row.model_mode, connectionId: row.connection_id, modelId: row.model_id, effort: row.effort_mode, reasoningEffort: row.reasoning_effort }
  : null;

/** Saves one level's model and effort. Inheriting both removes the row. */
export async function updateModelAssignment(db: Database, actorUserId: string, input: AssignmentUpdate) {
  const level = validLevel(input.scope, input.target);
  const definition = AI_TASK_GROUP_DEFINITIONS[level.group];
  const snapshot = await loadAssignmentSnapshot(db);
  const before = rowOf(snapshot, level);
  let connectionId: string | null = null, modelId: string | null = null;
  if (input.model.mode === "explicit") {
    const chosen = input.model;
    const connection = snapshot.connections.find(item => item.id === chosen.connectionId && !item.deleted);
    if (!connection) throw new AiConnectionError("not_found", "Conexão não encontrada.");
    if (!connection.enabled) throw new AiConnectionError("disabled", "Ative a conexão antes de escolhê-la para uma tarefa.");
    if (!connection.hasKey) throw new AiConnectionError("credential", "Esta conexão está sem credencial. Cadastre a chave antes de escolhê-la.");
    modelId = chosen.modelId.trim();
    if (!modelId || modelId.length > 160) throw new AiConnectionError("invalid", "Informe o ID do modelo.");
    if (!modelFitsExecution(definition.execution, connection.provider, modelId)) {
      throw new AiConnectionError("invalid", definition.execution === "transcription"
        ? "Escolha um modelo de transcrição, ou um modelo que ouça áudio fora da OpenAI."
        : "Escolha um modelo de conversa para esta tarefa.");
    }
    connectionId = connection.id;
  }
  if (input.model.mode === "disabled" && !definition.canDisable) throw new AiConnectionError("invalid", `${definition.label} não pode ser desativada.`);
  if (input.effort.mode === "explicit" && definition.execution === "transcription") throw new AiConnectionError("invalid", "A transcrição não usa esforço de raciocínio.");

  const next: AssignmentRow = {
    scope: level.scope, target: level.target, model_mode: input.model.mode, connection_id: connectionId, model_id: modelId,
    effort_mode: input.effort.mode, reasoning_effort: input.effort.mode === "explicit" ? input.effort.value : null,
    updated_at: new Date().toISOString(), updated_by: actorUserId,
  };
  if (next.effort_mode === "explicit") {
    // Judged against the model this level ends up with, with the new row in place.
    const simulated = planLevels(level.levels, { ...snapshot, rows: [...snapshot.rows.filter(row => row !== before), next] });
    if (simulated.status !== "ready") throw new AiConnectionError("invalid", "Escolha um modelo disponível antes de definir o esforço.");
    if (!supportsReasoningEffort(simulated.provider)) throw new AiConnectionError("invalid", "Este provider usa o próprio esforço padrão. Escolha “Padrão do provider”.");
  }

  const details = { scope: level.scope, target: level.target, before: rowSummary(before), after: next.model_mode === "inherit" && next.effort_mode === "inherit" ? null : rowSummary(next) };
  await db.batch([
    next.model_mode === "inherit" && next.effort_mode === "inherit"
      ? db.prepare("DELETE FROM ai_model_assignment WHERE scope = ? AND target = ?").bind(level.scope, level.target)
      : db.prepare(`INSERT INTO ai_model_assignment (scope, target, model_mode, connection_id, model_id, effort_mode, reasoning_effort, updated_by, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT (scope, target) DO UPDATE SET model_mode = excluded.model_mode, connection_id = excluded.connection_id, model_id = excluded.model_id,
            effort_mode = excluded.effort_mode, reasoning_effort = excluded.reasoning_effort, updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`)
        .bind(next.scope, next.target, next.model_mode, next.connection_id, next.model_id, next.effort_mode, next.reasoning_effort, actorUserId),
    auditStatement(db, actorUserId, null, connectionId ?? before?.connection_id ?? null, "ai_assignment.updated", details),
  ]);
}

/** Probes the model a level resolves to, the way its tasks call it. Provider errors are never echoed. */
export async function testModelAssignment(
  db: Database, key: MasterKey, actorUserId: string, input: { scope: AssignmentScope; target: string },
  send: (config: ResolvedModelConfig & { effort: ReasoningEffort | null }, execution: ExecutionKind) => Promise<unknown>,
) {
  const level = validLevel(input.scope, input.target);
  const execution = AI_TASK_GROUP_DEFINITIONS[level.group].execution;
  const plan = planLevels(level.levels, await loadAssignmentSnapshot(db));
  if (plan.status !== "ready") {
    if (plan.status === "disabled") throw new AiConnectionError("task_disabled", "Não há modelo para testar: a tarefa está desativada.");
    throw new AiConnectionError(plan.status === "unavailable" ? "unavailable" : "not_found", plan.message);
  }
  const details = { scope: level.scope, target: level.target, provider: plan.provider, modelId: plan.modelId, effort: plan.effort, execution };
  const apiKey = await connectionSecret(db, key, plan.connectionId);
  if (!apiKey) throw new AiConnectionError("unavailable", "A conexão escolhida ficou indisponível. Tente de novo.");
  try {
    await send({ provider: plan.provider, modelId: plan.modelId, apiKey, connectionId: plan.connectionId, effort: plan.effort }, execution);
  } catch {
    await db.batch([auditStatement(db, actorUserId, null, plan.connectionId, "ai_assignment.tested", { ...details, result: "failed" })]);
    throw new AiConnectionError("provider", execution === "tool_agent"
      ? "O teste falhou: o modelo não respondeu ou não chamou a ferramenta de teste."
      : execution === "transcription" ? "O teste falhou: o modelo não transcreveu o áudio de teste." : "O teste falhou: o modelo não devolveu a resposta estruturada.");
  }
  await db.batch([auditStatement(db, actorUserId, null, plan.connectionId, "ai_assignment.tested", { ...details, result: "ok" })]);
  return { provider: plan.provider, modelId: plan.modelId, effort: plan.effort };
}

export type AssignmentView = { model: { mode: ModelMode; connectionId: string | null; modelId: string | null }; effort: { mode: EffortMode; value: ReasoningEffort | null }; updatedAt: string } | null;
const viewOf = (row: AssignmentRow | undefined): AssignmentView => row
  ? { model: { mode: row.model_mode, connectionId: row.connection_id, modelId: row.model_id }, effort: { mode: row.effort_mode, value: row.reasoning_effort }, updatedAt: row.updated_at }
  : null;

/** What the administration shows: each group and task, its own assignment and what it resolves to. */
export async function assignmentOverview(db: Database) {
  const snapshot = await loadAssignmentSnapshot(db);
  return {
    connections: snapshot.connections.filter(item => !item.deleted).map(({ id, name, provider, enabled, hasKey }) => ({ id, name, provider, enabled, hasKey })),
    groups: AI_TASK_GROUPS.map(group => ({ ...AI_TASK_GROUP_DEFINITIONS[group], assignment: viewOf(rowOf(snapshot, { scope: "group", target: group })), plan: planGroup(group, snapshot) })),
    tasks: AI_TASK_KEYS.map(task => ({ ...AI_TASK_DEFINITIONS[task], assignment: viewOf(rowOf(snapshot, { scope: "task", target: task })), plan: planTask(task, snapshot) })),
  };
}
export type AssignmentOverview = Awaited<ReturnType<typeof assignmentOverview>>;

/** Whether the model reads images; the composer's camera and image picker depend on it. */
export function planReadsImages(plan: TaskModelPlan): boolean {
  return plan.status === "ready" && modelModalities(plan.provider, plan.modelId).image;
}
