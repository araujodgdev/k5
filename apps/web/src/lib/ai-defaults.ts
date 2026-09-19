import type { AiProvider } from "./ai-connections-core";

/**
 * Models K5 picks, not the office.
 *
 * The administrator registers a provider and a credential. Which model answers a conversation is
 * the person's choice in the composer; which model builds the semantic index is ours, because the
 * index generation pins the model and its dimension and a change there invalidates every vector
 * already published. Neither belongs in a client's settings screen.
 */

/** Used when a conversation, a background run or a connection test does not name a model. */
export const DEFAULT_CHAT_MODEL: Record<AiProvider, string> = {
  openai: "gpt-5",
  anthropic: "claude-sonnet-4-5",
  google: "gemini-2.5-pro",
  deepseek: "deepseek-v4-pro",
  inception: "mercury-2.5",
  openrouter: "anthropic/claude-sonnet-4.5",
  vercel: "anthropic/claude-sonnet-4.5",
};

/** Providers without an embeddings endpoint are absent: semantic search needs another connection. */
export const DEFAULT_EMBEDDING_MODEL: Partial<Record<AiProvider, string>> = {
  openai: "text-embedding-3-small",
  google: "gemini-embedding-001",
  vercel: "openai/text-embedding-3-small",
};

export function defaultChatModel(provider: AiProvider): string {
  return DEFAULT_CHAT_MODEL[provider] ?? "";
}

export function defaultEmbeddingModel(provider: AiProvider): string | undefined {
  return DEFAULT_EMBEDDING_MODEL[provider];
}

/**
 * The provider catalogs mix conversation models with embedding, image, speech and moderation ones.
 * Only the first kind belongs in the composer's list.
 */
const NOT_A_CHAT_MODEL = /(embed|moderation|rerank|whisper|transcribe|-tts\b|tts-|text-to-speech|dall-e|sora|-image\b|image-|video|guard|realtime|audio-preview|codex-spark)/i;

export function isChatModel(modelId: string): boolean {
  return Boolean(modelId) && !NOT_A_CHAT_MODEL.test(modelId);
}
