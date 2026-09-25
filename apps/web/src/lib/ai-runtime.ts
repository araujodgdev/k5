import 'server-only';
import { randomUUID } from 'node:crypto';
import { Agent } from '@mastra/core/agent';
import { Mastra } from '@mastra/core';
import { noopLogger } from '@mastra/core/logger';
import { RequestContext } from '@mastra/core/request-context';
import type { MastraMemory } from '@mastra/core/memory';
import type { OutputProcessor } from '@mastra/core/processors';
import { z } from 'zod';
import { database } from './database';
import { resolveProfileConfig } from './ai-connections';
import { groundedInstructions } from './ai-policy';
import { modelFor, modelProviderOptions, type ModelCredential } from './ai-providers';
import type { AiProvider } from './ai-connections-core';
import type { PinnedProfile, ProfileConfig } from './ai-profiles-core';
import { PROFILE_DEFINITIONS, type AiProfile, type ProfileVariant, type ReasoningEffort } from './ai-profiles';
import { captureOperationalError, traceAgentTurn } from './observability/report';

export { modelFor, type ModelCredential, RequestContext };
export type { ProfileConfig };
/** Optional Mastra features: the chat adds working memory and the guard over third-party tool results. */
export type AgentFeatures = { memory?: MastraMemory; outputProcessors?: OutputProcessor[] };

type AgentConfig = ModelCredential & { reasoningEffort?: ReasoningEffort };

function agentFor(config: AgentConfig, instructions: string, tools?: Record<string, unknown>, features: AgentFeatures = {}) {
  const agent = new Agent({
    id: 'k5',
    name: 'Lume',
    instructions,
    defaultOptions: ({ requestContext }) => ({
      providerOptions: modelProviderOptions(
        (requestContext?.get('provider') as AiProvider | undefined) ?? config.provider,
        (requestContext?.get('reasoningEffort') as ReasoningEffort | undefined) ?? config.reasoningEffort,
      ),
    }),
    model: ({ requestContext }: { requestContext?: RequestContext }) => {
      const provider = (requestContext?.get('provider') as AiProvider | undefined) ?? config.provider;
      const modelId = (requestContext?.get('modelId') as string | undefined) ?? config.modelId;
      const apiKey = (requestContext?.get('apiKey') as string | undefined) ?? config.apiKey;
      return modelFor({ provider, modelId, apiKey });
    },
    ...(tools ? { tools: tools as never } : {}),
    ...(features.memory ? { memory: features.memory } : {}),
    ...(features.outputProcessors?.length ? { outputProcessors: features.outputProcessors } : {}),
  });
  // No raw provider errors, credentials or document contents are sent to telemetry.
  new Mastra({ agents: { k5: agent }, logger: noopLogger });
  return agent;
}

/** The request context that binds one call to a credential, model and reasoning effort. */
export function profileContext(config: AgentConfig) {
  const ctx = new RequestContext();
  ctx.set('provider', config.provider);
  ctx.set('modelId', config.modelId);
  ctx.set('apiKey', config.apiKey);
  if (config.reasoningEffort) ctx.set('reasoningEffort', config.reasoningEffort);
  return ctx;
}

/** An agent on the platform's model for one step; usage is still recorded per office by the caller. */
export async function createAgent(
  profile: AiProfile,
  instructions = groundedInstructions,
  tools?: Record<string, unknown>,
  pinned?: Partial<PinnedProfile>,
  features?: AgentFeatures,
) {
  const config = await resolveProfileConfig(profile, pinned);
  return { agent: agentFor(config, instructions, tools, features), config };
}

// Room for reasoning models to think before answering "OK"; 32 tokens could end the call empty.
const CREDENTIAL_TEST_MAX_OUTPUT_TOKENS = 4096;

export async function testModelCredential(config: AgentConfig) {
  const result = await agentFor(config, 'Responda apenas OK.').generate('Teste de conexão.', {
    requestContext: profileContext(config),
    maxSteps: 1,
    abortSignal: AbortSignal.timeout(30_000),
    modelSettings: { maxOutputTokens: CREDENTIAL_TEST_MAX_OUTPUT_TOKENS },
  });
  // Mastra may resolve with the provider failure instead of rejecting, and a call cut off by the
  // output limit answers nothing: neither proves the model works.
  if (result.error || result.finishReason === 'error' || result.finishReason === 'length' || !result.text?.trim()) throw new Error('Provider test failed.');
}

export type ModelUsage = { inputTokens?: number; outputTokens?: number; reasoningTokens?: number; cachedInputTokens?: number };
export type ErrorKind = 'schema' | 'incomplete' | 'timeout' | 'provider' | 'cancelled';
export type UsageMeta = { runId?: string; stepKey?: string; attempt?: number; escalatedFrom?: string; variant?: ProfileVariant };
export type UsageRecord = UsageMeta & {
  officeId: string;
  userId: string | null;
  config: ModelCredential & { connectionId: string; profile?: string; reasoningEffort?: string };
  task: string;
  status: string;
  usage?: ModelUsage;
  durationMs?: number;
  finishReason?: string;
  errorKind?: ErrorKind;
  /** Counts only (discarded items, missing evidence): never prompt or answer text. */
  validation?: Record<string, number | boolean | string>;
};

const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null;

/** Telemetry never fails the call it measures: a failed write is reported and dropped. */
export async function recordUsage(record: UsageRecord) {
  try {
    const { config, usage } = record;
    await database.prepare(`INSERT INTO ai_usage(id,office_id,user_id,connection_id,provider,model_id,task,status,input_tokens,output_tokens,
        profile,reasoning_effort,duration_ms,reasoning_tokens,cached_input_tokens,finish_reason,error_kind,run_id,step_key,attempt,escalated_from,variant,validation_json)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(randomUUID(), record.officeId, record.userId, config.connectionId, config.provider, config.modelId, record.task, record.status,
        count(usage?.inputTokens), count(usage?.outputTokens),
        config.profile ?? null, config.provider === 'openai' ? config.reasoningEffort ?? null : null, count(record.durationMs),
        count(usage?.reasoningTokens), count(usage?.cachedInputTokens), record.finishReason ?? null, record.errorKind ?? null,
        record.runId ?? null, record.stepKey ?? null, count(record.attempt), record.escalatedFrom ?? null, record.variant ?? null,
        record.validation ? JSON.stringify(record.validation) : null);
  } catch (error) {
    captureOperationalError(error, 'ai.usage');
  }
}

/** A failed structured call, with a code the caller can act on; the message stays generic for people. */
export class StructuredGenerationError extends Error {
  constructor(public readonly kind: ErrorKind) { super('A análise falhou. Confira a conexão de IA e tente novamente.'); }
}

class IncompleteResponse extends Error {}
class ProviderFailure extends Error {}

export function errorKindOf(error: unknown): ErrorKind {
  if (error instanceof IncompleteResponse) return 'incomplete';
  if (error instanceof ProviderFailure) return 'provider';
  if (error instanceof z.ZodError) return 'schema';
  const name = error instanceof Error ? error.name : '';
  if (name === 'TimeoutError') return 'timeout';
  if (name === 'AbortError') return 'cancelled';
  if (/NoObjectGenerated|TypeValidation|JSONParse|StructuredOutput/i.test(name)) return 'schema';
  return 'provider';
}

export type StructuredOptions<T> = {
  pinned?: Partial<PinnedProfile>;
  /** A resolved model to use instead of the profile's own, for escalation and shadow calls. */
  config?: ProfileConfig;
  meta?: UsageMeta;
  /** Counts recorded with the call's usage, computed from the parsed output. */
  validate?: (output: T) => UsageRecord['validation'];
};

export async function generateStructured<T extends z.ZodType>(
  officeId: string, userId: string, profile: AiProfile, prompt: string, schema: T, options: StructuredOptions<z.output<T>> = {},
): Promise<z.output<T>> {
  const config = options.config ?? await resolveProfileConfig(profile, options.pinned);
  const agent = agentFor(config, groundedInstructions);
  const started = performance.now();
  // `task` keeps the values rows had before profiles; `profile` (from the config) names the step.
  const base = { officeId, userId, config, task: PROFILE_DEFINITIONS[profile].task, ...options.meta };
  let finishReason: string | undefined;
  let usage: ModelUsage | undefined;
  return traceAgentTurn({ task: profile, provider: config.provider, modelId: config.modelId }, async span => {
    try {
      const result = await agent.generate(prompt, {
        requestContext: profileContext(config),
        structuredOutput: { schema },
        maxSteps: 1,
        abortSignal: AbortSignal.timeout(180_000),
        modelSettings: { maxOutputTokens: config.maxOutputTokens },
      });
      finishReason = result.finishReason;
      usage = result.usage;
      if (result.error || result.finishReason === 'error') throw new ProviderFailure();
      // Reasoning tokens count against the output limit; a cut-off answer is not a schema problem.
      if (result.finishReason === 'length') throw new IncompleteResponse();
      const output = schema.parse(result.object);
      await recordUsage({ ...base, status: 'completed', usage, finishReason, durationMs: performance.now() - started, validation: options.validate?.(output) });
      span.setAttributes({ 'gen_ai.usage.input_tokens': usage?.inputTokens ?? 0, 'gen_ai.usage.output_tokens': usage?.outputTokens ?? 0, 'lume.outcome': 'completed' });
      return output;
    } catch (error) {
      const kind = errorKindOf(error);
      captureOperationalError(error, 'ai.structured');
      span.setAttribute('lume.outcome', 'failed');
      await recordUsage({ ...base, status: 'failed', usage, finishReason, errorKind: kind, durationMs: performance.now() - started });
      throw new StructuredGenerationError(kind);
    }
  });
}
