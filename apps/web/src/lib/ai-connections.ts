import "server-only";
import { database } from "./database";
import { resolveEmbeddingConfigFromDatabase } from "./ai-connections-core";
import {
  loadAssignmentSnapshot, planTask, resolveLegacyRunModel, resolvePinnedTaskModel, resolveTaskModelFromDatabase,
} from "./ai-assignments-core";
import type { AiTaskKey } from "./ai-tasks";
import { parseCredentialKeyring } from "./platform-crypto";

/** The connection, model and effort that serve a task. The configuration is the platform's, the same for every office. */
export function resolveTaskModel(task: AiTaskKey) {
  return resolveTaskModelFromDatabase(database, parseCredentialKeyring(), task);
}

/** What a task resolves to, without reading any credential: for pages that only need to know. */
export async function planTaskModel(task: AiTaskKey) {
  return planTask(task, await loadAssignmentSnapshot(database));
}

/** The model a queued run pinned for one of its tasks (see pinRunModelPlan). */
export function resolveRunTaskModel(run: { model_plan: unknown; model_provider: string | null; model_id: string | null }, task: AiTaskKey) {
  const key = parseCredentialKeyring();
  if (run.model_plan) return resolvePinnedTaskModel(database, key, run.model_plan, task);
  if (run.model_provider && run.model_id) return resolveLegacyRunModel(database, key, task, run.model_provider, run.model_id);
  return resolveTaskModelFromDatabase(database, key, task);
}

/** The connection and model of semantic search. */
export function resolveEmbeddingConfig() {
  return resolveEmbeddingConfigFromDatabase(database, parseCredentialKeyring());
}
