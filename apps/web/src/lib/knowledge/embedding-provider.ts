import 'server-only';
import { resolveModelConfig } from '@/lib/ai-connections';
import { AiConnectionError, type AiProvider } from '@/lib/ai-connections-core';
import { CapabilityError } from '@/lib/capabilities/errors';
import { recordUsage } from '@/lib/ai-runtime';

export type EmbeddingProfile = { provider: AiProvider; modelId: string; apiKey: string; connectionId: string };

/**
 * Providers with no embeddings endpoint are a configuration error, not a silent downgrade to
 * another provider: swapping credentials behind the operator's back is exactly what the plan
 * forbids, so an unsupported profile says so and the search stays lexical.
 */
const OPENAI_COMPATIBLE: Partial<Record<AiProvider, string>> = {
  openai: 'https://api.openai.com/v1/embeddings',
  openrouter: 'https://openrouter.ai/api/v1/embeddings',
  vercel: 'https://ai-gateway.vercel.sh/v1/embeddings',
};

const UNSUPPORTED: Partial<Record<AiProvider, string>> = {
  anthropic: 'A Anthropic não oferece endpoint de embeddings. Cadastre uma conexão OpenAI, Google ou AI Gateway para a busca semântica.',
  deepseek: 'A DeepSeek não oferece endpoint de embeddings. Cadastre uma conexão OpenAI, Google ou AI Gateway para a busca semântica.',
  inception: 'A Inception não oferece endpoint de embeddings. Cadastre uma conexão OpenAI, Google ou AI Gateway para a busca semântica.',
  openrouter: 'O OpenRouter não expõe modelos de embedding. Cadastre uma conexão OpenAI, Google ou AI Gateway para a busca semântica.',
};

export class EmbeddingUnavailableError extends Error {
  constructor(message: string) { super(message); }
}

/** Resolves the platform's embedding profile, or explains why semantic search is unavailable. */
export async function embeddingProfile(): Promise<EmbeddingProfile> {
  let config;
  try {
    // Awaited inside the try: the resolution is asynchronous, so a rejection reaches this catch
    // only if the promise is settled here. Left un-awaited, the AiConnectionError would escape
    // past it and reach callers that only know how to answer EmbeddingUnavailableError.
    config = await resolveModelConfig('embedding');
  } catch (error) {
    if (error instanceof AiConnectionError) {
      throw new EmbeddingUnavailableError('Nenhuma conexão de IA compatível com embeddings está ativa na plataforma.');
    }
    throw error;
  }
  const reason = UNSUPPORTED[config.provider];
  if (reason) throw new EmbeddingUnavailableError(reason);
  if (!OPENAI_COMPATIBLE[config.provider] && config.provider !== 'google') {
    throw new EmbeddingUnavailableError('O provedor configurado para embedding não é compatível.');
  }
  return config;
}

/** Who the vectors were computed for; usage is recorded per office, like every other model call. */
export type EmbeddingOwner = { officeId: string; userId: string | null };
type Embedded = { vectors: Float32Array[]; inputTokens?: number };

async function embedOpenAiCompatible(profile: EmbeddingProfile, url: string, inputs: string[]): Promise<Embedded> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${profile.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: profile.modelId, input: inputs }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    // Provider bodies can echo the request or a masked key; only the status leaves this function.
    throw new EmbeddingUnavailableError(`O provedor de embedding respondeu ${response.status}.`);
  }
  const body = await response.json() as { data?: Array<{ embedding: number[]; index: number }>; usage?: { prompt_tokens?: number } };
  const rows = body.data ?? [];
  if (rows.length !== inputs.length) throw new EmbeddingUnavailableError('O provedor de embedding devolveu menos vetores que o solicitado.');
  const ordered = [...rows].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return { vectors: ordered.map((row) => Float32Array.from(row.embedding)), inputTokens: body.usage?.prompt_tokens };
}

async function embedGoogle(profile: EmbeddingProfile, inputs: string[]): Promise<Embedded> {
  const model = profile.modelId.startsWith('models/') ? profile.modelId : `models/${profile.modelId}`;
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/${model}:batchEmbedContents`,
    {
      method: 'POST',
      headers: { 'x-goog-api-key': profile.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: inputs.map((text) => ({ model, content: { parts: [{ text }] } })) }),
      signal: AbortSignal.timeout(120_000),
    },
  );
  if (!response.ok) throw new EmbeddingUnavailableError(`O provedor de embedding respondeu ${response.status}.`);
  const body = await response.json() as { embeddings?: Array<{ values: number[] }> };
  const rows = body.embeddings ?? [];
  if (rows.length !== inputs.length) throw new EmbeddingUnavailableError('O provedor de embedding devolveu menos vetores que o solicitado.');
  return { vectors: rows.map((row) => Float32Array.from(row.values)) };
}

export async function embedTexts(profile: EmbeddingProfile, inputs: string[], owner?: EmbeddingOwner): Promise<Float32Array[]> {
  if (!inputs.length) return [];
  const url = OPENAI_COMPATIBLE[profile.provider];
  const started = performance.now();
  let embedded: Embedded;
  try {
    embedded = url ? await embedOpenAiCompatible(profile, url, inputs) : await embedGoogle(profile, inputs);
  } catch (error) {
    if (owner) await recordEmbeddingUsage(owner, profile, 'failed', started, inputs.length);
    throw error;
  }
  if (owner) await recordEmbeddingUsage(owner, profile, 'completed', started, inputs.length, embedded.inputTokens);
  const vectors = embedded.vectors;
  const dimension = vectors[0]?.length ?? 0;
  if (!dimension) throw new EmbeddingUnavailableError('O provedor de embedding devolveu um vetor vazio.');
  if (vectors.some((vector) => vector.length !== dimension)) {
    throw new EmbeddingUnavailableError('O provedor de embedding devolveu dimensões inconsistentes.');
  }
  return vectors;
}

// recordUsage reports its own write failures, so the search or indexing it describes is never lost.
async function recordEmbeddingUsage(owner: EmbeddingOwner, profile: EmbeddingProfile, status: string, started: number, inputs: number, inputTokens?: number) {
  await recordUsage({ ...owner, config: { ...profile, profile: 'embedding' }, task: 'embedding', status, usage: { inputTokens },
    durationMs: performance.now() - started, validation: { inputs } });
}

/** One query vector. The model never supplies this: the server embeds the query it was given. */
export async function embedQuery(query: string, owner?: EmbeddingOwner): Promise<{ embedding: Float32Array; profile: EmbeddingProfile }> {
  const profile = await embeddingProfile();
  const [embedding] = await embedTexts(profile, [query], owner);
  if (!embedding) throw new EmbeddingUnavailableError('Não foi possível gerar o vetor da consulta.');
  return { embedding, profile };
}

export function embeddingConfigurationError(error: unknown): CapabilityError | undefined {
  if (error instanceof EmbeddingUnavailableError) return new CapabilityError('NOT_READY', error.message);
  return undefined;
}
