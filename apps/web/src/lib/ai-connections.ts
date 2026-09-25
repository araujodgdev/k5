import "server-only";
import { database } from "./database";
import { resolveModelConfigFromDatabase, type AiTask } from "./ai-connections-core";
import { resolveProfileConfigFromDatabase, resolveProfileVariantFromDatabase, type PinnedProfile } from "./ai-profiles-core";
import type { AiProfile, ProfileVariant } from "./ai-profiles";
import { parseCredentialKeyring } from "./platform-crypto";

/** The model that serves a task. The configuration is the platform's, the same for every office. */
export function resolveModelConfig(
  task: AiTask,
  requestedModel?: { provider?: string; modelId?: string }
) {
  return resolveModelConfigFromDatabase(database, parseCredentialKeyring(), task, requestedModel);
}

/** The model, reasoning effort and output budget of one step, the same for every office. */
export function resolveProfileConfig(profile: AiProfile, pinned?: Partial<PinnedProfile>) {
  return resolveProfileConfigFromDatabase(database, parseCredentialKeyring(), profile, pinned);
}

export function resolveProfileVariant(profile: AiProfile, variant: ProfileVariant) {
  return resolveProfileVariantFromDatabase(database, parseCredentialKeyring(), profile, variant);
}
