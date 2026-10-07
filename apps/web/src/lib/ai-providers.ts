import { createHash, randomUUID } from 'node:crypto';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogle } from '@ai-sdk/google';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createGateway } from '@ai-sdk/gateway';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
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

  if (provider === 'cliproxyapi') return { openai: { ...reasoning, store: false } };
  return reasoning ? { openai: reasoning } : undefined;
}

/** Model ids the router knows for each provider; the admin may still type one that is not listed. */
export function providerCatalog(): Record<AiProvider, string[]> {

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

/** Public V4 adapters preserve each native wire protocol and guard every concrete request. */
export function protectedModelFor(config: ModelCredential, fetch: typeof globalThis.fetch): ReturnType<ReturnType<typeof createOpenAI>['responses']> {
  switch (config.provider) {
    case 'openai': return createOpenAI({ apiKey: config.apiKey, fetch }).responses(config.modelId);
    case 'cliproxyapi': return createOpenAI({ apiKey: config.apiKey, baseURL: CLIPROXYAPI_BASE_URL,
      headers: { 'Session-Id': config.session ?? taskSession() }, fetch }).responses(config.modelId);
    case 'anthropic': return createAnthropic({ apiKey: config.apiKey, fetch })(config.modelId);
    case 'google': return createGoogle({ apiKey: config.apiKey, fetch }).generativeAI(config.modelId);
    case 'deepseek': return createDeepSeek({ apiKey: config.apiKey, fetch })(config.modelId);
    case 'inception': return createOpenAICompatible({ name: 'inception', apiKey: config.apiKey,
      baseURL: 'https://api.inceptionlabs.ai/v1/', supportsStructuredOutputs: true, fetch }).chatModel(config.modelId);
    case 'openrouter': return createOpenRouter({ apiKey: config.apiKey, fetch })(config.modelId);
    case 'vercel': return createGateway({ apiKey: config.apiKey, fetch })(config.modelId);
  }
}

const fetchProxyWithoutRedirects: typeof fetch = async (input, init) => {
  const response = await globalThis.fetch(input, { ...init, redirect: 'manual' });
  if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error('CLIProxyAPI redirect refused.');
  }
  return response;
};

export function modelFor(config: ModelCredential & { provider: Exclude<AiProvider, 'cliproxyapi'> }): RouterModel;
export function modelFor(config: ModelCredential & { provider: 'cliproxyapi' }): ReturnType<ReturnType<typeof createOpenAI>['responses']>;
export function modelFor(config: ModelCredential): MastraModelConfig;
export function modelFor(config: ModelCredential): MastraModelConfig {
  if (!AI_PROVIDERS.includes(config.provider)) throw new Error('Provider não suportado.');

  if (config.provider === 'cliproxyapi') {
    return protectedModelFor(config, fetchProxyWithoutRedirects);
  }
  return { providerId: config.provider, modelId: config.modelId, apiKey: config.apiKey };
}
