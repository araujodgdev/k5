import "server-only";
import { database } from "./database";
import { resolveOfficeModelConfigFromDatabase, listAiConnections, type AiTask } from "./ai-connections-core";
import { parseCredentialKeyring } from "./platform-crypto";
import { providerCatalog, providerLabels } from "./ai-providers";

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
};

export function listOfficeAvailableModels(officeId: string): OfficeModelOption[] {
  const connections = listAiConnections(database, officeId).filter((c) => c.enabled);
  if (connections.length === 0) return [];
  const catalog = providerCatalog();
  const options: OfficeModelOption[] = [];
  const seen = new Set<string>();

  const defaultConnection = connections.find((c) => c.models.chat) ?? connections[0];
  const defaultModelId = defaultConnection?.models.chat ?? (catalog[defaultConnection.provider]?.[0] || "");

  for (const conn of connections) {
    const models = catalog[conn.provider] ?? [];
    for (const mId of models) {
      const key = `${conn.provider}:${mId}`;
      if (!seen.has(key)) {
        seen.add(key);
        options.push({
          provider: conn.provider,
          providerLabel: providerLabels[conn.provider] ?? conn.provider,
          modelId: mId,
          label: `${providerLabels[conn.provider] ?? conn.provider} - ${mId}`,
          isDefault: conn.provider === defaultConnection.provider && mId === defaultModelId,
        });
      }
    }
    for (const custom of [conn.models.chat, conn.models.extraction, conn.models.drafting]) {
      if (custom && !seen.has(`${conn.provider}:${custom}`)) {
        seen.add(`${conn.provider}:${custom}`);
        options.push({
          provider: conn.provider,
          providerLabel: providerLabels[conn.provider] ?? conn.provider,
          modelId: custom,
          label: `${providerLabels[conn.provider] ?? conn.provider} - ${custom}`,
          isDefault: conn.provider === defaultConnection.provider && custom === defaultModelId,
        });
      }
    }
  }

  if (options.length > 0 && !options.some((o) => o.isDefault)) {
    options[0].isDefault = true;
  }

  return options;
}
