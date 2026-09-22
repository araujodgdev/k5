/** Synthetic integration exercise. Human labels are deliberately absent; this reports no accuracy. */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { TypeSafeClient } from '@typesafe-ai/sdk';
import { researchEvaluationPairs } from '../tests/fixtures/research-assessment-corpus';
import { researchAssessmentQuestions, researchAssessmentQuestionVersion } from '../src/lib/research/case-assessment-contracts';

const pairs = researchEvaluationPairs;
const holdout = pairs.filter(pair => pair.split === 'holdout');
if (pairs.length < 30 || holdout.length < 6 || pairs.some(pair => pair.reviewStatus !== 'needs_human_label' || pair.humanLabel !== null))
  throw new Error('O corpus precisa de 30+ pares e holdout sem rótulos automáticos.');
const limitIndex = process.argv.indexOf('--limit');
const limit = limitIndex >= 0 ? Number(process.argv[limitIndex + 1]) : pairs.length;
if (!Number.isInteger(limit) || limit < 1 || limit > pairs.length) throw new Error('Use --limit entre 1 e 36.');
const keyFile = process.env.TYPESAFE_EVAL_KEY_FILE;
if (!keyFile) {
  console.log(`Corpus validado: ${pairs.length} pares sintéticos, ${holdout.length} em holdout; todos aguardam revisão humana. Defina TYPESAFE_EVAL_KEY_FILE para executar chamadas.`);
  process.exit(0);
}
const apiKey = readFileSync(resolve(keyFile), 'utf8').trim();
if (apiKey.length < 12) throw new Error('Chave de avaliação ausente ou inválida.');
const model = 'jev-1.13.0';
const client = new TypeSafeClient({ apiKey, baseURL: 'https://api.typesafe.ai', logLevel: 'off', retry: { maxRetries: 0 }, timeout: 10_000 });
const results: Array<Record<string, unknown>> = [];
for (const pair of pairs.slice(0, limit)) {
  const start = performance.now();
  try {
    const response = await client.systemOne({ model,
      state: { profile: JSON.parse(JSON.stringify(pair.profile)), judgment: JSON.parse(JSON.stringify(pair.judgment)),
        coverage: { synthetic: true, textKind: pair.judgment.materialKind } },
      questions: researchAssessmentQuestions(Boolean(pair.profile.thesis)),
    });
    results.push({ id: pair.id, split: pair.split, reviewStatus: pair.reviewStatus, model, questionVersion: researchAssessmentQuestionVersion,
      durationMs: Math.round(performance.now() - start), answers: response.answers, usage: response.usage, status: 'evaluated' });
  } catch {
    results.push({ id: pair.id, split: pair.split, reviewStatus: pair.reviewStatus,
      durationMs: Math.round(performance.now() - start), status: 'unavailable' });
  }
}
mkdirSync(resolve('.data'), { recursive: true });
const output = resolve('.data/research-assessment-eval.json');
writeFileSync(output, JSON.stringify({ generatedAt: new Date().toISOString(), model, questionVersion: researchAssessmentQuestionVersion,
  corpusSize: pairs.length, holdoutSize: holdout.length, labels: 'needs_human_label', results }, null, 2));
console.log(`Resultados sintéticos gravados em ${output}. Rótulos humanos pendentes; nenhuma métrica de acurácia calculada.`);
