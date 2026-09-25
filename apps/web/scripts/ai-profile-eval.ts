// Opt-in paid evaluation of chronology extraction settings. Isolated PostgreSQL schema, synthetic
// passages only (tests/fixtures/chronology-corpus.ts). It compares model and reasoning effort on
// the same prompt, schema and checks the product uses, reading cost and latency from ai_usage.
//
//   TEST_DATABASE_URL=... OPENAI_EVAL_KEY_FILE=... pnpm ai:eval -- --configs gpt-6-sol:xhigh,gpt-6-sol:medium --repeat 3
import { testDb } from './typesafe-eval-store';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chronologyCorpus } from '../tests/fixtures/chronology-corpus';
import { generateStructured, StructuredGenerationError } from '../src/lib/ai-runtime';
import { extractionPrompt, extractionSchema } from '../src/lib/document-workflows';
import { needsEscalation } from '../src/lib/document-composition';
import { quoteIsPresent } from '../src/lib/ai-policy';
import { PROFILE_DEFINITIONS, REASONING_EFFORTS, type ReasoningEffort } from '../src/lib/ai-profiles';
import type { ProfileConfig } from '../src/lib/ai-profiles-core';

// Stops before the next call once this many tokens (input + output) were spent.
const TOKEN_BUDGET = Number(process.env.AI_EVAL_TOKEN_BUDGET ?? 2_000_000);

function argument(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function parseConfigs(value: string) {
  return value.split(',').map(item => {
    const [modelId, effort] = item.trim().split(':');
    if (!modelId || !(REASONING_EFFORTS as readonly string[]).includes(effort)) throw new Error(`Configuração inválida: ${item}. Use modelo:esforço.`);
    return { modelId, reasoningEffort: effort as ReasoningEffort };
  });
}

async function main() {
  const keyFile = process.env.OPENAI_EVAL_KEY_FILE;
  const apiKey = keyFile ? readFileSync(keyFile, 'utf8').trim() : process.env.OPENAI_EVAL_KEY;
  if (!apiKey) throw new Error('Defina OPENAI_EVAL_KEY ou OPENAI_EVAL_KEY_FILE para a avaliação opcional.');
  const configs = parseConfigs(argument('configs') ?? 'gpt-6-sol:xhigh,gpt-6-sol:high,gpt-6-sol:medium');
  const repeat = Math.max(1, Number(argument('repeat') ?? 1));
  const officeId = randomUUID(), userId = randomUUID();
  await testDb.prepare('INSERT INTO office(id,name) VALUES(?,?)').run(officeId, 'Avaliação sintética');
  await testDb.prepare('INSERT INTO user(id,email,name) VALUES(?,?,?)').run(userId, `${userId}@example.test`, 'Avaliador');

  const spent = async () => Number((await testDb.prepare('SELECT coalesce(sum(input_tokens),0)+coalesce(sum(output_tokens),0) AS n FROM ai_usage').get<{ n: number }>())!.n);
  const rows: Array<Record<string, unknown>> = [];
  for (const setting of configs) {
    const config: ProfileConfig = { provider: 'openai', modelId: setting.modelId, apiKey, connectionId: 'avaliacao', profile: 'extraction_chunk',
      reasoningEffort: setting.reasoningEffort, maxOutputTokens: PROFILE_DEFINITIONS.extraction_chunk.maxOutputTokens };
    for (let round = 0; round < repeat; round++) for (const sample of chronologyCorpus) {
      if (await spent() > TOKEN_BUDGET) throw new Error('Orçamento da avaliação atingido.');
      const source = { id: sample.id, sourceLabel: sample.label, text: sample.text };
      const started = performance.now();
      const base = { config: `${setting.modelId}:${setting.reasoningEffort}`, sample: sample.id, round };
      try {
        const raw = await generateStructured(officeId, userId, 'extraction_chunk', extractionPrompt(source), extractionSchema,
          { config, meta: { runId: 'avaliacao', stepKey: `${sample.id}:${round}` } });
        const kept = raw.events.filter(event => quoteIsPresent(event.quote, sample.text));
        const found = new Set(kept.flatMap(event => event.date && /^\d{4}-\d{2}-\d{2}$/.test(event.date) ? [event.date] : []));
        rows.push({ ...base, ok: true, ms: Math.round(performance.now() - started),
          expected: sample.dates.length, recalled: sample.dates.filter(date => found.has(date)).length,
          unexpectedDates: [...found].filter(date => !sample.dates.includes(date)).length,
          discarded: raw.events.length - kept.length, escalation: needsEscalation({ returned: raw.events.length, kept, sourceText: sample.text }) });
      } catch (error) {
        rows.push({ ...base, ok: false, ms: Math.round(performance.now() - started), error: error instanceof StructuredGenerationError ? error.kind : 'unknown' });
      }
    }
    console.log(`Concluída a configuração ${setting.modelId}:${setting.reasoningEffort}.`);
  }

  const usage = await testDb.prepare(`SELECT model_id, reasoning_effort, count(*) AS calls, sum(input_tokens) AS input_tokens, sum(cached_input_tokens) AS cached_input_tokens,
      sum(output_tokens) AS output_tokens, sum(reasoning_tokens) AS reasoning_tokens,
      percentile_disc(0.5) WITHIN GROUP (ORDER BY duration_ms) AS p50_ms, percentile_disc(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_ms
    FROM ai_usage GROUP BY 1, 2 ORDER BY 1, 2`).all();
  const summary = Object.fromEntries(configs.map(({ modelId, reasoningEffort }) => {
    const data = rows.filter(row => row.config === `${modelId}:${reasoningEffort}`);
    const done = data.filter(row => row.ok);
    const sum = (field: string) => done.reduce((total, row) => total + Number(row[field] ?? 0), 0);
    return [`${modelId}:${reasoningEffort}`, {
      calls: data.length, failures: data.length - done.length,
      dateRecall: sum('expected') ? sum('recalled') / sum('expected') : null,
      unexpectedDates: sum('unexpectedDates'), discardedEvents: sum('discarded'),
      wouldEscalate: done.filter(row => row.escalation).length,
    }];
  }));
  const report = { date: new Date().toISOString(), limitations: [
    'Amostra sintética pequena, sem revisão humana: serve para conferir o script, não para aprovar troca de modelo.',
    'Recall mede só datas completas; omissão de fatos sem data exige revisão humana.',
  ], summary, usage, rows };
  mkdirSync('.data', { recursive: true });
  const path = resolve('.data/ai-profile-eval.json');
  writeFileSync(path, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ report: path, summary }, null, 2));
}

main().catch((error) => {
  // Provider errors may echo request data; only our own messages are printed.
  console.error(error instanceof Error && /^(Defina|Configuração|Orçamento)/.test(error.message) ? error.message : 'A avaliação falhou. Confira a configuração local; detalhes do provider foram ocultados.');
  process.exitCode = 1;
}).finally(() => testDb.close());
