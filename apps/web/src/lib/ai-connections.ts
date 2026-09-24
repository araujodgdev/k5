import "server-only";
import { database } from "./database";
import { resolveModelConfigFromDatabase, type AiTask } from "./ai-connections-core";
import { parseCredentialKeyring } from "./platform-crypto";

/** The model that serves a task. The configuration is the platform's, the same for every office. */
export function resolveModelConfig(
  task: AiTask,
  requestedModel?: { provider?: string; modelId?: string }
) {
  return resolveModelConfigFromDatabase(database, parseCredentialKeyring(), task, requestedModel);
}
