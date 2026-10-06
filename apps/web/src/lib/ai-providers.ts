import { createHash, randomUUID } from 'node:crypto';
import { createOpenAI } from '@ai-sdk/openai';
import { PROVIDER_REGISTRY, type MastraModelConfig } from '@mastra/core/llm';
import { AI_PROVIDERS, providerLabels, type AiProvider } from './ai-provider-names';
import { supportsReasoningEffort, type ReasoningEffort } from './ai-tasks';

export { providerLabels };
/** `session` names the conversation for CLIProxyAPI; other providers never receive it. */
export type ModelCredential = { provider: AiProvider; modelId: string; apiKey: string; session?: string };
type RouterModel = { providerId: string; modelId: string; apiKey: string };

export const CLIPROXYAPI_BASE_URL = 'https://api.lume.software/v1';

export function modelProviderOptions(provider: AiProvider, effort: ReasoningEffort | null | undefined) {
  const reasoning = effort && supportsReasoningEffort(provider) ? { reasoningEffort: effort } : undefined;
  // store:false avoids replaying references to response items the stateless proxy cannot retrieve.
  if (provider === 'cliproxyapi') return { openai: { ...reasoning, store: false } };
  return reasoning ? { openai: reasoning } : undefined;
}

/** Model ids the router knows for each provider; the admin may still type one that is not listed. */
export function providerCatalog(): Record<AiProvider, string[]> {
  // The installed Mastra registry can lag newly released API model IDs, and has no entry for the proxy.
  const additions: Partial<Record<AiProvider, string[]>> = { openai: ['gpt-6-sol', 'gpt-6-luna'], cliproxyapi: ['gpt-6-luna', 'gpt-6.1-sol'] };
  return Object.fromEntries(AI_PROVIDERS.map((provider) => [
    provider,
    [...new Set([...(additions[provider] ?? []), ...(provider === 'cliproxyapi' ? [] : PROVIDER_REGISTRY[provider]?.models ?? [])])],
  ])) as Record<AiProvider, string[]>;
}

/** The proxy's session for one conversation: the same on every turn, opaque, derived only on the server. */
export function conversationSession(owner: { officeId: string; userId: string }, conversationId: string) {
  return `lume-${createHash('sha256').update(JSON.stringify(['cliproxyapi-session', owner.officeId, owner.userId, conversationId])).digest('hex').slice(0, 32)}`;
}

export const taskSession = () => `lume-task-${randomUUID()}`;

const fetchProxyWithoutRedirects: typeof fetch = async (input, init) => {
  const response = await globalThis.fetch(input, { ...init, redirect: 'manual' });
  if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error('CLIProxyAPI redirect refused.');
  }
  return response;
};

// Each call binds the model to this credential; no global env key or shared client is used.
export function modelFor(config: ModelCredential & { provider: Exclude<AiProvider, 'cliproxyapi'> }): RouterModel;
export function modelFor(config: ModelCredential & { provider: 'cliproxyapi' }): ReturnType<ReturnType<typeof createOpenAI>['responses']>;
export function modelFor(config: ModelCredential): MastraModelConfig;
export function modelFor(config: ModelCredential): MastraModelConfig {
  if (!AI_PROVIDERS.includes(config.provider)) throw new Error('Provider não suportado.');
  // The router would turn a custom URL into Chat Completions; the proxy keeps the Responses API that
  // tools, structured output and native search were proven on.
  if (config.provider === 'cliproxyapi') {
    return createOpenAI({ baseURL: CLIPROXYAPI_BASE_URL, apiKey: config.apiKey, headers: { 'Session-Id': config.session ?? taskSession() }, fetch: fetchProxyWithoutRedirects })
      .responses(config.modelId);
  }
  return { providerId: config.provider, modelId: config.modelId, apiKey: config.apiKey };
}
