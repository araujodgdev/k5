import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AiUsageSummary } from '../src/components/ai-usage-summary';
import type { AiUsageRow } from '../src/lib/ai-usage';

const row = (overrides: Partial<AiUsageRow>): AiUsageRow => ({
  profile: 'extraction_chunk', modelId: 'gpt-6-luna', reasoningEffort: 'medium', completed: 1200, failed: 3, escalated: 40,
  p95Ms: 8450, inputTokens: 1_440_000, cachedInputTokens: 300_000, outputTokens: 2_000_000, reasoningTokens: 1_500_000, ...overrides,
});
const render = (props: Parameters<typeof AiUsageSummary>[0]) => renderToStaticMarkup(createElement(AiUsageSummary, props));

test('usage summary: empty and error states are plain sentences', () => {
  assert.match(render({ rows: [], days: 7 }), /Nenhuma chamada registrada no período\./);
  const failed = render({ rows: [], days: 7, failed: true });
  assert.match(failed, /role="alert"/);
  assert.match(failed, /Não foi possível ler o uso agora\./);
});

test('usage summary: steps are named in Portuguese and numbers use pt-BR formatting', () => {
  const html = render({ rows: [row({}), row({ profile: 'extraction', modelId: 'gpt-5', reasoningEffort: null, p95Ms: null })], days: 7 });
  assert.match(html, /Uso nos últimos 7 dias/);
  assert.match(html, /Cronologia: trechos/);
  assert.match(html, /Extração \(antes das etapas\)/, 'rows written before profiles keep a readable label');
  assert.match(html, /1\.440\.000/);
  assert.match(html, /8,5 s/);
  assert.match(html, /<th scope="row"/);
  assert.match(html, /tabindex="0"/, 'the scrollable table can be reached by keyboard');
});
