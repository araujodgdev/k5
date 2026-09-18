import 'server-only';
import { randomUUID } from 'node:crypto';
import { Agent } from '@mastra/core/agent';
import { Mastra } from '@mastra/core';
import { noopLogger } from '@mastra/core/logger';
import { RequestContext } from '@mastra/core/request-context';
import { z } from 'zod';
import { database } from './database';
import { resolveOfficeModelConfig } from './ai-connections';
import { groundedInstructions } from './ai-policy';
import { modelFor, type ModelCredential } from './ai-providers';
import type { AiProvider } from './ai-connections-core';

export { modelFor, type ModelCredential, RequestContext };
export type ModelTask = 'chat' | 'extraction' | 'drafting';

function agentFor(config: ModelCredential, instructions: string, tools?: Record<string, unknown>) {
  const agent = new Agent({
    id: 'k5',
    name: 'K5',
    instructions,
    model: ({ requestContext }: { requestContext?: RequestContext }) => {
      const provider = (requestContext?.get('provider') as AiProvider | undefined) ?? config.provider;
      const modelId = (requestContext?.get('modelId') as string | undefined) ?? config.modelId;
      const apiKey = (requestContext?.get('apiKey') as string | undefined) ?? config.apiKey;
      return modelFor({ provider, modelId, apiKey });
    },
    ...(tools ? { tools: tools as never } : {}),
  });
  // No raw provider errors, credentials or document contents are sent to telemetry.
  new Mastra({ agents: { k5: agent }, logger: noopLogger });
  return agent;
}

export async function createOfficeAgent(
  officeId: string,
  task: ModelTask,
  instructions = groundedInstructions,
  tools?: Record<string, unknown>,
  requestedModel?: { provider?: string; modelId?: string }
) {
  const config = await resolveOfficeModelConfig(officeId, task, requestedModel);
  return { agent: agentFor(config, instructions, tools), config };
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

export function recordUsage(officeId: string, userId: string | null, config: ModelCredential & { connectionId: string }, task: string, status: string, usage?: { inputTokens?: number; outputTokens?: number }) {
  database.prepare('INSERT INTO ai_usage(id,office_id,user_id,connection_id,provider,model_id,task,status,input_tokens,output_tokens) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(randomUUID(), officeId, userId, config.connectionId, config.provider, config.modelId, task, status, usage?.inputTokens ?? null, usage?.outputTokens ?? null);
}

export async function generateStructured<T extends z.ZodType>(officeId: string, userId: string, task: ModelTask, prompt: string, schema: T): Promise<z.output<T>> {
  const { agent, config } = await createOfficeAgent(officeId, task);
  const ctx = new RequestContext();
  ctx.set('provider', config.provider);
  ctx.set('modelId', config.modelId);
  ctx.set('apiKey', config.apiKey);
  try {
    const result = await agent.generate(prompt, {
      requestContext: ctx,
      structuredOutput: { schema },
      maxSteps: 1,
      abortSignal: AbortSignal.timeout(180_000),
      modelSettings: { maxOutputTokens: 12000 },
    });
    recordUsage(officeId, userId, config, task, 'completed', result.usage);
    return schema.parse(result.object);
  } catch {
    recordUsage(officeId, userId, config, task, 'failed');
    throw new Error('A análise falhou. Confira a conexão de IA e tente novamente.');
  }
}
