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
import { resolveModelConfig } from './ai-connections';
import { groundedInstructions } from './ai-policy';
import { modelFor, modelProviderOptions, type ModelCredential } from './ai-providers';
import type { AiProvider } from './ai-connections-core';
import { captureOperationalError, traceAgentTurn } from './observability/report';

export { modelFor, type ModelCredential, RequestContext };
export type ModelTask = 'chat' | 'extraction' | 'drafting';
/** Optional Mastra features: the chat adds working memory and the guard over third-party tool results. */
export type AgentFeatures = { memory?: MastraMemory; outputProcessors?: OutputProcessor[] };

function agentFor(config: ModelCredential, instructions: string, tools?: Record<string, unknown>, features: AgentFeatures = {}) {
  const agent = new Agent({
    id: 'k5',
    name: 'Lume',
    instructions,
    defaultOptions: ({ requestContext }) => ({
      providerOptions: modelProviderOptions((requestContext?.get('provider') as AiProvider | undefined) ?? config.provider),
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

/** An agent on the platform's model for the task; usage is still recorded per office by the caller. */
export async function createAgent(
  task: ModelTask,
  instructions = groundedInstructions,
  tools?: Record<string, unknown>,
  requestedModel?: { provider?: string; modelId?: string },
  features?: AgentFeatures,
) {
  const config = await resolveModelConfig(task, requestedModel);
  return { agent: agentFor(config, instructions, tools, features), config };
}

export async function testModelCredential(config: ModelCredential) {
  const ctx = new RequestContext();
  ctx.set('provider', config.provider);
  ctx.set('modelId', config.modelId);
  ctx.set('apiKey', config.apiKey);
  const result = await agentFor(config, 'Responda apenas OK.').generate('Teste de conexão.', {
    requestContext: ctx,
    maxSteps: 1,
    abortSignal: AbortSignal.timeout(30_000),
    modelSettings: { maxOutputTokens: 32 },
  });
  // Mastra may resolve with the provider failure instead of rejecting.
  if (result.error || result.finishReason === 'error') throw new Error('Provider test failed.');
}

export async function recordUsage(officeId: string, userId: string | null, config: ModelCredential & { connectionId: string }, task: string, status: string, usage?: { inputTokens?: number; outputTokens?: number }) {
  await database.prepare('INSERT INTO ai_usage(id,office_id,user_id,connection_id,provider,model_id,task,status,input_tokens,output_tokens) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(randomUUID(), officeId, userId, config.connectionId, config.provider, config.modelId, task, status, usage?.inputTokens ?? null, usage?.outputTokens ?? null);
}

/**
 * Quick features (e-mail summaries, reply suggestions) pass their own instructions and a lighter
 * reasoning effort; the defaults keep the grounded legal instructions and the full effort.
 */
export type StructuredOptions = { instructions?: string; reasoningEffort?: 'low' | 'medium' | 'high'; timeoutMs?: number; maxOutputTokens?: number; signal?: AbortSignal };

export async function generateStructured<T extends z.ZodType>(officeId: string, userId: string, task: ModelTask, prompt: string, schema: T, requestedModel?: { provider?: string; modelId?: string }, options: StructuredOptions = {}): Promise<z.output<T>> {
  const { agent, config } = await createAgent(task, options.instructions, undefined, requestedModel);
  const ctx = new RequestContext();
  ctx.set('provider', config.provider);
  ctx.set('modelId', config.modelId);
  ctx.set('apiKey', config.apiKey);
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 180_000);
  return traceAgentTurn({ task, provider: config.provider, modelId: config.modelId }, async span => {
    try {
      const result = await agent.generate(prompt, {
        requestContext: ctx,
        structuredOutput: { schema },
        maxSteps: 1,
        abortSignal: options.signal ? AbortSignal.any([timeout, options.signal]) : timeout,
        modelSettings: { maxOutputTokens: options.maxOutputTokens ?? 12000 },
        ...(options.reasoningEffort && config.provider === 'openai' ? { providerOptions: { openai: { reasoningEffort: options.reasoningEffort } } } : {}),
      });
      await recordUsage(officeId, userId, config, task, 'completed', result.usage);
      span.setAttributes({ 'gen_ai.usage.input_tokens': result.usage?.inputTokens ?? 0, 'gen_ai.usage.output_tokens': result.usage?.outputTokens ?? 0, 'lume.outcome': 'completed' });
      return schema.parse(result.object);
    } catch (error) {
      captureOperationalError(error, 'ai.structured');
      span.setAttribute('lume.outcome', 'failed');
      await recordUsage(officeId, userId, config, task, 'failed');
      throw new Error('A análise falhou. Confira a conexão de IA e tente novamente.');
    }
  });
}
