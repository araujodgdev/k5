import { createServer } from 'node:http';
import * as Sentry from '@sentry/node';
import { serverOptions } from '../src/lib/observability/options';
import { captureOperationalError, observeWorkerTask } from './sentry-worker';

Sentry.init(serverOptions('processor', process.env));
let busy = false;
let maintenanceAt = 0;

async function documentPass() {
  const { processNextVaultDocument } = await import('../src/lib/vault');
  const { processNextRun } = await import('../src/lib/document-workflows');
  const { processNextVerification } = await import('../src/lib/typesafe/verification');
  const { processNextResearchAssessment } = await import('../src/lib/research/case-assessment');
  const { processNextFeedbackClassification } = await import('../src/lib/feedback-triage');
  const { processNextResearchExtraction } = await import('../src/lib/research/pdf');
  const { processNextIndexJob, processNextDeletion } = await import('../src/lib/knowledge/indexing');
  const outcomes = await Promise.all([
    (async () => {
      const ingested = await observeWorkerTask('vault.ingest', processNextVaultDocument);
      const indexed = await observeWorkerTask('knowledge.index', processNextIndexJob);
      const run = await observeWorkerTask('documents.run', processNextRun);
      const extracted = await observeWorkerTask('research.extract', processNextResearchExtraction);
      const deleted = await observeWorkerTask('vault.delete', processNextDeletion);
      return ingested || indexed || run || extracted || deleted;
    })(),
    (async () => {
      const verified = await observeWorkerTask('documents.verify', processNextVerification);
      const assessed = await observeWorkerTask('research.assess', processNextResearchAssessment);
      const triaged = await observeWorkerTask('feedback.triage', processNextFeedbackClassification);
      return Boolean(verified || assessed || triaged);
    })(),
  ]);
  if (Date.now() >= maintenanceAt) {
    const { sweepExpiredUploadRefs } = await import('../src/lib/application/uploads-service');
    const { sweepExpiredSecretRefs } = await import('../src/lib/application/secrets-service');
    const { database } = await import('../src/lib/database');
    await sweepExpiredUploadRefs();
    await sweepExpiredSecretRefs();
    await database.prepare('DELETE FROM research_quarantine WHERE expires_at<CURRENT_TIMESTAMP').run();
    maintenanceAt = Date.now() + 5 * 60_000;
  }
  return outcomes.some(Boolean);
}

async function judicialPass() {
  const { scheduleDueSubscriptions } = await import('../src/lib/judicial/jobs/scheduler');
  const { processNextJudicialJob } = await import('../src/lib/judicial/jobs/collector');
  const { processNextResearchExternalJob } = await import('../src/lib/research/worker');
  await scheduleDueSubscriptions();
  const judicial = await observeWorkerTask('judicial.collect', processNextJudicialJob);
  const research = await observeWorkerTask('research.collect', processNextResearchExternalJob);
  return Boolean(judicial || research);
}

const server = createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/health') { response.writeHead(200).end('ok'); return; }
  const role = request.url?.match(/^\/run\/(documents|judicial)$/)?.[1];
  if (request.method !== 'POST' || !role) { response.writeHead(404).end(); return; }
  if (busy) { response.writeHead(409).end(); return; }
  busy = true;
  try {
    const pass = role === 'documents' ? documentPass : judicialPass;
    const deadline = Date.now() + 45_000;
    // Never interrupt a claimed job just to satisfy a batch deadline. Its existing lease and
    // checkpoints handle crash recovery; the deadline only prevents claiming more work.
    while (await pass()) { if (Date.now() >= deadline) break; }
    response.writeHead(204).end();
  } catch (error) {
    captureOperationalError(error, `${role}.container`);
    console.error('Falha no processador.', { role, type: error instanceof Error ? error.name : typeof error });
    await Sentry.flush(5_000);
    response.writeHead(500).end();
  } finally { busy = false; }
});
server.requestTimeout = 0;
server.listen(8080, '0.0.0.0');

process.on('SIGTERM', () => {
  server.close(async () => { await Sentry.close(5_000); process.exit(0); });
});
