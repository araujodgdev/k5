import 'server-only';
import { randomUUID } from 'node:crypto';
import { Agent } from '@mastra/core/agent';
import { Mastra } from '@mastra/core';
import { noopLogger } from '@mastra/core/logger';
import { RequestContext } from '@mastra/core/request-context';
import type { MastraMemory } from '@mastra/core/memory';
import type { OutputProcessor } from '@mastra/core/processors';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { database } from './database';
import { resolveTaskModel } from './ai-connections';
import { AiConnectionError, type AiProvider } from './ai-connections-core';
import type { ResolvedTaskModel } from './ai-assignments-core';
import { groundedInstructions } from './ai-policy';
import { modelFor, reasoningOptions, type ModelCredential } from './ai-providers';
import type { AiTaskKey, ExecutionKind, ReasoningEffort } from './ai-tasks';
import { isTranscriptionModel } from './ai-tasks';
import { transcribeWithEndpoint } from './audio-transcription';
import { captureOperationalError, traceAgentTurn } from './observability/report';

export { modelFor, type ModelCredential, RequestContext };
export type { ResolvedTaskModel };
/** Optional Mastra features: the chat adds working memory and the guard over third-party tool results. */
export type AgentFeatures = { memory?: MastraMemory; outputProcessors?: OutputProcessor[] };
type EffortCredential = ModelCredential & { effort?: ReasoningEffort | null };

function agentFor(config: EffortCredential, instructions: string, tools?: Record<string, unknown>, features: AgentFeatures = {}) {
  const agent = new Agent({
    id: 'k5',
    name: 'Lume',
    instructions,
    defaultOptions: ({ requestContext }) => {
      const provider = (requestContext?.get('provider') as AiProvider | undefined) ?? config.provider;
      const effort = requestContext?.get('reasoningEffort') as ReasoningEffort | null | undefined;
      return { providerOptions: reasoningOptions(provider, effort === undefined ? config.effort : effort) };
    },
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

/** The request context that binds a call to one credential, model and effort. */
export function requestContextFor(config: EffortCredential) {
  const ctx = new RequestContext();
  ctx.set('provider', config.provider);
  ctx.set('modelId', config.modelId);
  ctx.set('apiKey', config.apiKey);
  ctx.set('reasoningEffort', config.effort ?? null);
  return ctx;
}

/**
 * An agent on the model of a task: resolved now from the platform's configuration, or the model a
 * run pinned when it was queued. Usage is still recorded per office by the caller.
 */
export async function createAgent(
  task: AiTaskKey | ResolvedTaskModel,
  instructions = groundedInstructions,
  tools?: Record<string, unknown>,
  features?: AgentFeatures,
) {
  const config = typeof task === 'string' ? await resolveTaskModel(task) : task;
  return { agent: agentFor(config, instructions, tools, features), config };
}

/** The connection test: a minimal request with a low effort where the provider takes one. */
export async function testModelCredential(config: ModelCredential, effort: ReasoningEffort | null = 'low') {
  const credential = { ...config, effort };
  const result = await agentFor(credential, 'Responda apenas OK.').generate('Teste de conexão.', {
    requestContext: requestContextFor(credential),
    maxSteps: 1,
    abortSignal: AbortSignal.timeout(30_000),
    modelSettings: { maxOutputTokens: 32 },
  });
  // Mastra may resolve with the provider failure instead of rejecting.
  if (result.error || result.finishReason === 'error') throw new Error('Provider test failed.');
}

/** Half a second of 16 kHz silence as WAV: enough for a transcription endpoint to accept the file. */
export function silentWav(): Buffer {
  const samples = 8000, data = samples * 2, wav = Buffer.alloc(44 + data);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + data, 4); wav.write('WAVE', 8); wav.write('fmt ', 12);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24);
  wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(data, 40);
  return wav;
}

/**
 * The test of a task's model, shaped like the task's own calls: a tool call for the agent, a
 * structured answer for the structured tasks, a short recording for transcription.
 */
export async function probeTaskModel(config: EffortCredential, execution: ExecutionKind) {
  const signal = AbortSignal.timeout(60_000);
  const requestContext = requestContextFor(config);
  if (execution === 'transcription') {
    if (isTranscriptionModel(config.provider, config.modelId)) {
      await transcribeWithEndpoint(config.apiKey, config.modelId, { mediaType: 'audio/wav', bytes: silentWav() }, signal);
      return;
    }
    const result = await agentFor(config, 'Transcreva o áudio. Se não houver fala, responda com nada.').generate(
      [{ role: 'user', content: [{ type: 'file', data: silentWav().toString('base64'), mediaType: 'audio/wav' }] }] as never,
      { requestContext, maxSteps: 1, abortSignal: signal, modelSettings: { maxOutputTokens: 200 } });
    if (result.error || result.finishReason === 'error') throw new Error('probe_failed');
    return;
  }
  if (execution === 'tool_agent') {
    let called = false;
    const probe = createTool({
      id: 'k5_probe', description: 'Ferramenta de teste da configuração. Chame-a uma vez, sem argumentos.',
      inputSchema: z.object({}), outputSchema: z.object({ ok: z.boolean() }),
      execute: async () => { called = true; return { ok: true }; },
    });
    const result = await agentFor(config, 'Você está num teste de configuração. Chame a ferramenta k5_probe uma vez e depois responda OK.', { k5_probe: probe })
      .generate('Faça o teste.', { requestContext, maxSteps: 2, abortSignal: signal, modelSettings: { maxOutputTokens: 2000 } });
    if (result.error || result.finishReason === 'error' || !called) throw new Error('probe_failed');
    return;
  }
  const result = await agentFor(config, 'Você está num teste de configuração.').generate('Responda com ok verdadeiro.', {
    requestContext, structuredOutput: { schema: z.object({ ok: z.boolean() }) }, maxSteps: 1, abortSignal: signal, modelSettings: { maxOutputTokens: 2000 },
  });
  if (result.error || !z.object({ ok: z.boolean() }).safeParse(result.object).success) throw new Error('probe_failed');
}

/** A short, stable label for what went wrong, safe to store: never the provider's message. */
export function errorClass(error: unknown): string {
  if (error instanceof AiConnectionError) return `config:${error.code}`;
  const name = (error as { name?: unknown } | null)?.name;
  if (name === 'TimeoutError') return 'timeout';
  if (name === 'AbortError') return 'aborted';
  if (name === 'ZodError') return 'invalid_output';
  const status = (error as { statusCode?: unknown; status?: unknown } | null);
  const code = typeof status?.statusCode === 'number' ? status.statusCode : typeof status?.status === 'number' ? status.status : undefined;
  return code ? `http_${code}` : 'error';
}

export type UsageDetails = { durationMs?: number; errorClass?: string; signals?: Record<string, unknown> };
type UsageConfig = ModelCredential & { connectionId: string; effort?: ReasoningEffort | null; modelSource?: string; effortSource?: string };

export async function recordUsage(officeId: string, userId: string | null, config: UsageConfig, task: string, status: string,
  usage?: { inputTokens?: number; outputTokens?: number }, details: UsageDetails = {}) {
  await database.prepare(`INSERT INTO ai_usage(id,office_id,user_id,connection_id,provider,model_id,task,status,input_tokens,output_tokens,
      reasoning_effort,model_source,effort_source,duration_ms,error_class,signals) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(randomUUID(), officeId, userId, config.connectionId, config.provider, config.modelId, task, status, usage?.inputTokens ?? null, usage?.outputTokens ?? null,
      config.effort ?? null, config.modelSource ?? null, config.effortSource ?? null,
      details.durationMs === undefined ? null : Math.round(details.durationMs), details.errorClass ?? null,
      details.signals ? JSON.stringify(details.signals) : null);
}

/** Quick features (e-mail summaries, reply suggestions) pass their own instructions; the default keeps the grounded legal ones. */
export type StructuredOptions<T = unknown> = {
  instructions?: string; timeoutMs?: number; maxOutputTokens?: number; signal?: AbortSignal;
  image?: { bytes: Uint8Array; mimeType: string };
  /** Cheap quality signals computed from the answer, stored with the usage (for example, rejected citations). */
  signals?: (output: T) => Record<string, unknown>;
};

export async function generateStructured<T extends z.ZodType>(officeId: string, userId: string, task: AiTaskKey | ResolvedTaskModel, prompt: string, schema: T,
  options: StructuredOptions<z.output<T>> = {}): Promise<z.output<T>> {
  const { agent, config } = await createAgent(task, options.instructions);
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 180_000);
  const started = performance.now();
  return traceAgentTurn({ task: config.task, provider: config.provider, modelId: config.modelId }, async span => {
    span.setAttribute('lume.reasoning_effort', config.effort ?? 'provider_default');
    // Kept outside the try: an answer that fails the schema was still billed, so its usage is recorded.
    let usage: { inputTokens?: number; outputTokens?: number } | undefined;
    try {
      const message = options.image ? [{ role: 'user' as const, content: [
        { type: 'text' as const, text: prompt },
        { type: 'image' as const, image: `data:${options.image.mimeType};base64,${Buffer.from(options.image.bytes).toString('base64')}`, mimeType:options.image.mimeType },
      ] }] : prompt;
      const result = await agent.generate(message, {
        requestContext: requestContextFor(config),
        // Mastra would throw on an invalid answer and drop its usage; the schema check below decides instead.
        structuredOutput: { schema, errorStrategy: 'warn' },
        maxSteps: 1,
        abortSignal: options.signal ? AbortSignal.any([timeout, options.signal]) : timeout,
        modelSettings: { maxOutputTokens: options.maxOutputTokens ?? 12000 },
      });
      usage = result.usage;
      const output = schema.parse(result.object);
      let signals: Record<string, unknown> | undefined;
      try { signals = options.signals?.(output); } catch (error) { captureOperationalError(error, 'ai.structured.signals'); }
      await recordUsage(officeId, userId, config, config.task, 'completed', result.usage, { durationMs: performance.now() - started, signals });
      span.setAttributes({ 'gen_ai.usage.input_tokens': result.usage?.inputTokens ?? 0, 'gen_ai.usage.output_tokens': result.usage?.outputTokens ?? 0, 'lume.outcome': 'completed' });
      return output;
    } catch (error) {
      captureOperationalError(error, 'ai.structured');
      span.setAttribute('lume.outcome', 'failed');
      await recordUsage(officeId, userId, config, config.task, 'failed', usage, { durationMs: performance.now() - started, errorClass: errorClass(error) });
      throw new Error('A análise falhou. Confira a conexão de IA e tente novamente.');
    }
  });
}
