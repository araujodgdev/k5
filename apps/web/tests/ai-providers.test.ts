import assert from "node:assert/strict";
import test from "node:test";
import { resolveModelConfig } from "@mastra/core/llm";
import { modelFor, providerCatalog, providerLabels, type ModelCredential } from "../src/lib/ai-providers";
import { AI_PROVIDERS } from "../src/lib/ai-connections-core";
import { DEFAULT_CHAT_MODEL, DEFAULT_EMBEDDING_MODEL, isChatModel } from "../src/lib/ai-defaults";
import { modelModalities } from "../src/lib/ai-modalities";

test("modelFor binds the given key and model id to the provider, without network calls", () => {
  for (const provider of AI_PROVIDERS) {
    const config: ModelCredential = { provider, modelId: `${provider}-test-model`, apiKey: `key-${provider}` };
    assert.deepEqual(modelFor(config), { providerId: provider, modelId: config.modelId, apiKey: config.apiKey });
  }
  const [first, second] = [modelFor({ provider: "openai", modelId: "a", apiKey: "sk-one" }), modelFor({ provider: "openai", modelId: "b", apiKey: "sk-two" })];
  assert.equal(first.apiKey, "sk-one");
  assert.equal(second.apiKey, "sk-two");
  assert.throws(() => modelFor({ provider: "mistral" as ModelCredential["provider"], modelId: "x", apiKey: "k" }), /não suportado/);
});

test("every supported provider resolves through the model router and is named in the interface", async () => {
  const catalog = providerCatalog();
  for (const provider of AI_PROVIDERS) {
    const model = await resolveModelConfig(modelFor({ provider, modelId: catalog[provider][0], apiKey: `key-${provider}` }));
    assert.equal(model.provider, provider, `${provider} resolve com o próprio protocolo`);
    assert.ok(catalog[provider].length > 0, `${provider} tem modelos conhecidos`);
    assert.ok(providerLabels[provider], `${provider} tem nome de exibição`);
  }
});

test("GPT-6 Sol and Luna are available to the platform administrator", async () => {
  const catalog = providerCatalog();
  for (const modelId of ["gpt-6-sol", "gpt-6-luna"]) {
    assert.ok(catalog.openai.includes(modelId));
    assert.ok(isChatModel(modelId));
    assert.deepEqual(modelModalities("openai", modelId), { image: true, audio: false });
    const resolved = await resolveModelConfig(modelFor({ provider: "openai", modelId, apiKey: "test-key" }));
    assert.equal(resolved.modelId, modelId);
  }
});

test("Lume owns the default model of every provider, and it is a model the router knows", () => {
  const catalog = providerCatalog();
  for (const provider of AI_PROVIDERS) {
    const modelId = DEFAULT_CHAT_MODEL[provider];
    assert.ok(modelId, `${provider} tem modelo de conversa padrão`);
    assert.ok(catalog[provider].includes(modelId), `${modelId} está no catálogo de ${provider}`);
    assert.ok(isChatModel(modelId), `${modelId} é um modelo de conversa`);
  }
  // Embeddings are only claimed where the provider actually has the endpoint.
  for (const [provider, modelId] of Object.entries(DEFAULT_EMBEDDING_MODEL)) {
    assert.ok(modelId && /embedding/i.test(modelId), `${provider} aponta para um modelo de embedding`);
    assert.equal(isChatModel(modelId!), false, `${modelId} não aparece no seletor de conversa`);
  }
  assert.equal(DEFAULT_EMBEDDING_MODEL.anthropic, undefined, "a Anthropic não oferece embeddings");
});

test("modalities are read from the model id and fail closed on an unknown one", () => {
  assert.deepEqual(modelModalities("openai", "gpt-5"), { image: true, audio: false });
  assert.deepEqual(modelModalities("openai", "gpt-4o-audio-preview"), { image: true, audio: true });
  assert.deepEqual(modelModalities("google", "gemini-2.5-pro"), { image: true, audio: true });
  assert.deepEqual(modelModalities("anthropic", "claude-sonnet-4-5"), { image: true, audio: false });
  assert.deepEqual(modelModalities("deepseek", "deepseek-v4-pro"), { image: false, audio: false });
  // Aggregators prefix the family with a vendor; the family is what decides.
  assert.deepEqual(modelModalities("openrouter", "anthropic/claude-sonnet-4.5"), { image: true, audio: false });
  assert.deepEqual(modelModalities("vercel", "google/gemini-2.5-pro"), { image: true, audio: true });
  // Nothing is assumed about a model we do not recognise.
  assert.deepEqual(modelModalities("openai", "modelo-inexistente-9000"), { image: false, audio: false });
  assert.deepEqual(modelModalities("openai", ""), { image: false, audio: false });
});
