import "server-only";
import { database } from "./database";
import { resolveOfficeModelConfigFromDatabase, listAiConnections, type AiProvider, type AiTask } from "./ai-connections-core";
import { parseCredentialKeyring } from "./platform-crypto";
import { providerCatalog, providerLabels } from "./ai-providers";
import { defaultChatModel, isChatModel } from "./ai-defaults";
import { modelModalities, type Modalities } from "./ai-modalities";

export function resolveOfficeModelConfig(
  officeId: string,
  task: AiTask,
  requestedModel?: { provider?: string; modelId?: string }
) {
  return resolveOfficeModelConfigFromDatabase(database, parseCredentialKeyring(), officeId, task, requestedModel);
}

export type OfficeModelOption = {
  provider: string;
  providerLabel: string;
  modelId: string;
  label: string;
  isDefault: boolean;
  modalities: Modalities;
};

/**
 * Every conversation model the office can reach, one entry per provider credential it holds.
 * Embedding, image, speech and moderation models are filtered out: the composer picks who answers,
 * and those cannot. Each entry carries what the model accepts as input so the composer can disable
 * the attachment and microphone controls instead of failing at the provider.
 */
export async function listOfficeAvailableModels(officeId: string): Promise<OfficeModelOption[]> {
  const connections = (await listAiConnections(database, officeId)).filter((c) => c.enabled);
  if (connections.length === 0) return [];
  const catalog = providerCatalog();
  const options: OfficeModelOption[] = [];
  const seen = new Set<string>();

  const defaultConnection = connections[0];
  const defaultModelId = defaultConnection.models.chat ?? defaultChatModel(defaultConnection.provider);

  const add = (provider: AiProvider, modelId: string) => {
    const key = `${provider}:${modelId}`;
    if (!modelId || seen.has(key)) return;
    seen.add(key);
    const providerLabel = providerLabels[provider] ?? provider;
    options.push({
      provider,
      providerLabel,
      modelId,
      label: `${providerLabel} — ${modelId}`,
      isDefault: provider === defaultConnection.provider && modelId === defaultModelId,
      modalities: modelModalities(provider, modelId),
    });
  };

  for (const conn of connections) {
    // The provider's own default comes first so it is easy to find in a long catalog.
    add(conn.provider, conn.models.chat ?? defaultChatModel(conn.provider));
    for (const modelId of catalog[conn.provider] ?? []) if (isChatModel(modelId)) add(conn.provider, modelId);
  }

  if (options.length > 0 && !options.some((option) => option.isDefault)) options[0].isDefault = true;
  return options;
}
