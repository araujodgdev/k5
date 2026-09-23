// Opt-in network evaluation. Uses an isolated PostgreSQL schema and synthetic data only.
import { testDb } from './typesafe-eval-store';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ragCorpus, documentCorpus, agendaCorpus } from '../tests/fixtures/typesafe-corpus';
import { saveConnection } from '../src/lib/typesafe/config';
import { connectionSettings } from '../src/lib/typesafe/contracts';
import { evaluate } from '../src/lib/typesafe/client';
import { supportQuestions, supportVersion } from '../src/lib/typesafe/verification';
import { interpretAgenda } from '../src/lib/typesafe/agenda';
import { searchKnowledgeEngine } from '../src/lib/knowledge/retrieval';

async function main() {
const keyFile = process.env.TYPESAFE_EVAL_KEY_FILE;
const apiKey = keyFile ? readFileSync(keyFile, 'utf8').trim() : process.env.TYPESAFE_API_KEY;
if (!apiKey) throw new Error('Defina TYPESAFE_API_KEY ou TYPESAFE_EVAL_KEY_FILE para a avaliação opcional.');
const limitArg = process.argv.indexOf('--limit');
const limit = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : Infinity;
const officeId = randomUUID(); const userId = randomUUID();
const context = { officeId, userId, role: 'lawyer' as const };
(await testDb.prepare('INSERT INTO office(id,name) VALUES(?,?)').run(officeId, 'Avaliação sintética'));
(await testDb.prepare('INSERT INTO user(id,email,name) VALUES(?,?,?)').run(userId, `${userId}@example.test`, 'Avaliador'));
(await testDb.prepare('INSERT INTO office_member(id,office_id,user_id,role) VALUES(?,?,?,?)').run(randomUUID(), officeId, userId, 'lawyer'));
(await testDb.prepare('INSERT INTO platform_admin(user_id) VALUES(?)').run(userId));
await saveConnection(userId, connectionSettings.parse({ apiKey, version: 0, enabled: true, rag: 'enabled', documents: 'enabled', agenda: 'enabled', dailyTokens: 5000000 }));
const rows: Array<Record<string, unknown>> = [];
const dcg = (grades: number[]) => grades.reduce((sum, grade, i) => sum + (2 ** grade - 1) / Math.log2(i + 2), 0);
async function budget() {
  const used = Number((await testDb.prepare('SELECT coalesce(sum(input_tokens),0) AS n FROM typesafe_evaluation').get())!.n);
  if (used > 1_000_000) throw new Error('Orçamento da avaliação atingido.');
}
for (const sample of ragCorpus.slice(0, limit)) {
  await budget(); const ids: string[] = []; const grades = new Map<string, number>();
  for (const [n, item] of sample.texts.entries()) {
    const id = randomUUID(); const chunk = randomUUID(); ids.push(id); grades.set(chunk, item.relevance);
    (await testDb.prepare("INSERT INTO vault_document(id,office_id,scope,original_name,stored_name,mime_type,byte_size,sha256,status,created_by) VALUES(?,?,'library',?,?,'text/plain',100,?,'ready',?)").run(id, officeId, `fonte-${n}.txt`, id, id, userId));
    (await testDb.prepare("INSERT INTO vault_document_chunk(id,document_id,office_id,ordinal,stable_reference,content) VALUES(?,?,?,0,'parágrafo:1',?)").run(chunk, id, officeId, item.text));
  }
  const input = { query: sample.query, documentIds: ids, limit: 8 };
  (await testDb.prepare("UPDATE typesafe_platform_connection SET rag_mode='off' WHERE id=1").run());
  const baseline = await searchKnowledgeEngine(context, input);
  (await testDb.prepare("UPDATE typesafe_platform_connection SET rag_mode='enabled' WHERE id=1").run());
  const start = performance.now(); const ranked = await searchKnowledgeEngine(context, input);
  const ideal = dcg([...grades.values()].sort((a, b) => b - a).slice(0, 8));
  const metric = (sources: typeof baseline.sources) => dcg(sources.map(source => grades.get(source.sourceId) ?? 0)) / ideal;
  const recall = (sources: typeof baseline.sources) => sources.filter(source => (grades.get(source.sourceId) ?? 0) > 0).length / 2;
  rows.push({ id: sample.id, split: sample.split, purpose: 'rag', baseline: metric(baseline.sources), ranked: metric(ranked.sources), baselineRecall: recall(baseline.sources), recall: recall(ranked.sources), applied: ranked.reranking?.applied, ms: Math.round(performance.now() - start) });
  if (rows.length % 10 === 0) console.log(`Avaliadas ${rows.length} amostras.`);
}
for (let i = 0; i < Math.min(documentCorpus.length, limit); i += 4) {
  await budget(); const samples = documentCorpus.slice(i, Math.min(i + 4, limit));
  const start = performance.now(); const result = await evaluate(context, 'documents', { state: { units: samples.map(sample => ({ text: sample.text, evidence: [{ quote: sample.evidence, text: sample.evidence }] })) }, questions: supportQuestions(samples.length), questionVersion: supportVersion });
  samples.forEach((sample, n) => {
    const answer = result.response?.answers[`unit_${n}`]; const actual = answer?.type === 'choice' ? answer.choice : result.status;
    rows.push({ id: sample.id, split: sample.split, purpose: 'documents', expected: sample.expected, actual, correct: actual === sample.expected, falseSupport: actual === 'supported' && sample.expected !== 'supported', ms: Math.round(performance.now() - start) });
  });
  if (rows.length % 10 === 0) console.log(`Avaliadas ${rows.length} amostras.`);
}
for (const sample of agendaCorpus.slice(0, limit)) {
  await budget(); const start = performance.now(); const result = await interpretAgenda(context, { message: sample.message, timeZone: 'America/Sao_Paulo' });
  rows.push({ id: sample.id, split: sample.split, purpose: 'agenda', expected: sample.expected, actual: result.proposal.operation, correct: result.proposal.operation === sample.expected, status: result.proposal.evaluationStatus, ms: Math.round(performance.now() - start) });
  if (rows.length % 10 === 0) console.log(`Avaliadas ${rows.length} amostras.`);
}
const usage = (await testDb.prepare('SELECT count(*) AS calls,coalesce(sum(input_tokens),0) AS inputTokens,coalesce(sum(output_tokens),0) AS outputTokens FROM typesafe_evaluation').get());
const mean = (data: Record<string, unknown>[], field: string) => data.reduce((sum, row) => sum + Number(row[field] ?? 0), 0) / Math.max(1, data.length);
const summary = Object.fromEntries(['rag', 'documents', 'agenda'].map(purpose => {
  const data = rows.filter(row => row.purpose === purpose); const times = data.map(row => Number(row.ms)).sort((a, b) => a - b);
  return [purpose, { samples: data.length, p95Ms: times[Math.ceil(times.length * 0.95) - 1] ?? 0,
    ...(purpose === 'rag' ? { baselineNdcg8: mean(data, 'baseline'), ndcg8: mean(data, 'ranked'), baselineRecall8: mean(data, 'baselineRecall'), recall8: mean(data, 'recall'), applied: data.filter(row => row.applied).length } : { accuracy: mean(data, 'correct'), falseSupport: data.filter(row => row.falseSupport).length }) }];
}));
const report = { date: new Date().toISOString(), model: 'jev-1.13.0', limitations: ['Dados sintéticos sem revisão humana independente.', 'Baseline RAG lexical; embedding não configurado nesta avaliação.', 'Famílias repetem estrutura; não representa precisão em documentos reais.', 'Amostras de Agenda avaliam intenção; testes de integração verificam confirmação, datas e isolamento.'], usage, summary, rows };
mkdirSync('.data', { recursive: true });
const path = resolve('.data/typesafe-eval.json'); writeFileSync(path, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ report: path, usage, summary }, null, 2));

}
main().catch(() => { console.error('A avaliação falhou. Confira a configuração local; detalhes do provider foram ocultados.'); process.exitCode = 1; }).finally(()=>testDb.close());
