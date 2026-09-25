import { PROVIDER_REGISTRY } from '@mastra/core/llm';
import { AI_PROVIDERS, type AiProvider } from './ai-connections-core';
import { DEFAULT_REASONING_EFFORT, type ReasoningEffort } from './ai-profiles';

export type ModelCredential = { provider: AiProvider; modelId: string; apiKey: string };

/** Shared by chat, structured generation and credential checks. Each step may set its own effort. */
export function modelProviderOptions(provider: AiProvider, reasoningEffort: ReasoningEffort = DEFAULT_REASONING_EFFORT) {
  return provider === 'openai' ? { openai: { reasoningEffort } } : undefined;
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
