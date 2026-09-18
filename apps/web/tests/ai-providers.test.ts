import assert from "node:assert/strict";
import test from "node:test";
import { resolveModelConfig } from "@mastra/core/llm";
import { modelFor, providerCatalog, providerLabels, type ModelCredential } from "../src/lib/ai-providers";
import { AI_PROVIDERS } from "../src/lib/ai-connections-core";

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
