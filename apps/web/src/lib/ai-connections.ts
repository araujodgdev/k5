import "server-only";
import { database } from "./database";
import { resolveOfficeModelConfigFromDatabase, type AiTask } from "./ai-connections-core";
import { parseCredentialKeyring } from "./platform-crypto";

export function resolveOfficeModelConfig(
  officeId: string,
  task: AiTask,
  requestedModel?: { provider?: string; modelId?: string }
) {
  return resolveOfficeModelConfigFromDatabase(database, parseCredentialKeyring(), officeId, task, requestedModel);
}
