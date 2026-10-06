export const AI_PROVIDERS = ["openai", "anthropic", "google", "deepseek", "inception", "openrouter", "vercel", "cliproxyapi"] as const;
export type AiProvider = typeof AI_PROVIDERS[number];

export const providerLabels: Record<AiProvider, string> = {
  openai: "OpenAI", anthropic: "Anthropic", google: "Google", deepseek: "DeepSeek",
  inception: "Inception", openrouter: "OpenRouter", vercel: "AI Gateway", cliproxyapi: "CLIProxyAPI (Lume)",
};
