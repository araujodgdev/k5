import 'server-only';
import { resolveOfficeModelConfig } from '@/lib/ai-connections';
import { AiConnectionError, type AiProvider } from '@/lib/ai-connections-core';
import { CapabilityError } from '@/lib/capabilities/errors';

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
  anthropic: 'A Anthropic não oferece endpoint de embeddings. Configure outro provedor no perfil de embedding.',
  deepseek: 'A DeepSeek não oferece endpoint de embeddings. Configure outro provedor no perfil de embedding.',
  inception: 'A Inception não oferece endpoint de embeddings. Configure outro provedor no perfil de embedding.',
};

export class EmbeddingUnavailableError extends Error {
  constructor(message: string) { super(message); }
}

/** Resolves the office's embedding profile, or explains why semantic search is unavailable. */
export function embeddingProfile(officeId: string): EmbeddingProfile {
  let config;
  try {
    config = resolveOfficeModelConfig(officeId, 'embedding');
  } catch (error) {
    if (error instanceof AiConnectionError) {
      throw new EmbeddingUnavailableError('Nenhum modelo de embedding está configurado para este escritório.');
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

async function embedOpenAiCompatible(profile: EmbeddingProfile, url: string, inputs: string[]): Promise<Float32Array[]> {
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
  const body = await response.json() as { data?: Array<{ embedding: number[]; index: number }> };
  const rows = body.data ?? [];
  if (rows.length !== inputs.length) throw new EmbeddingUnavailableError('O provedor de embedding devolveu menos vetores que o solicitado.');
  const ordered = [...rows].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return ordered.map((row) => Float32Array.from(row.embedding));
}

async function embedGoogle(profile: EmbeddingProfile, inputs: string[]): Promise<Float32Array[]> {
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
  return rows.map((row) => Float32Array.from(row.values));
}

export async function embedTexts(profile: EmbeddingProfile, inputs: string[]): Promise<Float32Array[]> {
  if (!inputs.length) return [];
  const url = OPENAI_COMPATIBLE[profile.provider];
  const vectors = url ? await embedOpenAiCompatible(profile, url, inputs) : await embedGoogle(profile, inputs);
  const dimension = vectors[0]?.length ?? 0;
  if (!dimension) throw new EmbeddingUnavailableError('O provedor de embedding devolveu um vetor vazio.');
  if (vectors.some((vector) => vector.length !== dimension)) {
    throw new EmbeddingUnavailableError('O provedor de embedding devolveu dimensões inconsistentes.');
  }
  return vectors;
}

/** One query vector. The model never supplies this: the server embeds the query it was given. */
export async function embedQuery(officeId: string, query: string): Promise<{ embedding: Float32Array; profile: EmbeddingProfile }> {
  const profile = embeddingProfile(officeId);
  const [embedding] = await embedTexts(profile, [query]);
  if (!embedding) throw new EmbeddingUnavailableError('Não foi possível gerar o vetor da consulta.');
  return { embedding, profile };
}

export function embeddingConfigurationError(error: unknown): CapabilityError | undefined {
  if (error instanceof EmbeddingUnavailableError) return new CapabilityError('NOT_READY', error.message);
  return undefined;
}
