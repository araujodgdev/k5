import { PROVIDER_REGISTRY } from '@mastra/core/llm';
import { AI_PROVIDERS, type AiProvider } from './ai-connections-core';
import { supportsReasoningEffort, type ReasoningEffort } from './ai-tasks';

export type ModelCredential = { provider: AiProvider; modelId: string; apiKey: string };

/**
 * The reasoning effort as the provider's request option. Null, or a provider that takes none, sends
 * nothing and leaves the provider's own default. Shared by chat, structured generation and tests.
 */
export function reasoningOptions(provider: AiProvider, effort: ReasoningEffort | null | undefined) {
  if (!effort || !supportsReasoningEffort(provider)) return undefined;
  return { openai: { reasoningEffort: effort } };
}

// Provider ids match Mastra's model router, which already knows each endpoint, protocol and model catalog.
export const providerLabels: Record<AiProvider, string> = {
  openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google', deepseek: 'DeepSeek',
  inception: 'Inception', openrouter: 'OpenRouter', vercel: 'AI Gateway',
};

/** Model ids the router knows for each provider; the admin may still type one that is not listed. */
export function providerCatalog(): Record<AiProvider, string[]> {
  // The installed Mastra registry can lag newly released API model IDs.
  const additions: Partial<Record<AiProvider, string[]>> = { openai: ['gpt-6-sol', 'gpt-6-luna'] };
  return Object.fromEntries(AI_PROVIDERS.map((provider) => [
    provider,
    [...new Set([...(additions[provider] ?? []), ...(PROVIDER_REGISTRY[provider]?.models ?? [])])],
  ])) as Record<AiProvider, string[]>;
}

// Each call binds the model to this credential; no global env key or shared client is used.
export function modelFor(config: ModelCredential) {
  if (!AI_PROVIDERS.includes(config.provider)) throw new Error('Provider não suportado.');
  return { providerId: config.provider, modelId: config.modelId, apiKey: config.apiKey };
}
