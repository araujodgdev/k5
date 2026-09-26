import { runObservedWorker, captureOperationalError, observeWorkerTask } from './sentry-worker';

async function main() {
  const { processNextVaultDocument } = await import('../src/lib/vault');
  const { processNextRun } = await import('../src/lib/document-workflows');
  const { processNextVerification } = await import('../src/lib/typesafe/verification');
  const { processNextResearchAssessment } = await import('../src/lib/research/case-assessment');
  const { processNextFeedbackClassification } = await import('../src/lib/feedback-triage');
  const { processNextResearchExtraction } = await import('../src/lib/research/pdf');
  const { processNextIndexJob, processNextDeletion } = await import('../src/lib/knowledge/indexing');
  const { sweepExpiredUploadRefs } = await import('../src/lib/application/uploads-service');
  const { sweepExpiredSecretRefs } = await import('../src/lib/application/secrets-service');
  const { runWorkerQueues } = await import('../src/lib/worker-scheduler');
  const { sweepResearchStaging, sweepResearchOrphans } = await import('../src/lib/research/storage');
  const { database } = await import('../src/lib/database');
  const { sweepAgentTraces } = await import('../src/lib/observability/agent-trace');

  let stopping = false;
  process.on('SIGINT', () => { stopping = true; });
  process.on('SIGTERM', () => { stopping = true; });
  console.log('Worker Lume ativo. Aguardando documentos, indexação e tarefas.');

  let sweepAt = 0;
  let researchSweepAt = 0;
  await runWorkerQueues({
    stopping: () => stopping,
    once: process.argv.includes('--once'),
    processDocuments: async () => {
      const ingested = await observeWorkerTask('vault.ingest', processNextVaultDocument);
      const indexed = await observeWorkerTask('knowledge.index', processNextIndexJob);
      const processed = await observeWorkerTask('documents.run', processNextRun);
      const extracted = await observeWorkerTask('research.extract', processNextResearchExtraction);
      return ingested || indexed || processed || extracted;
    },
    verifyDocuments: async () => {
      const verified = await observeWorkerTask('documents.verify', processNextVerification);
      const assessed = await observeWorkerTask('research.assess', processNextResearchAssessment);
      const triaged = await observeWorkerTask('feedback.triage', processNextFeedbackClassification);
      return Boolean(verified || assessed || triaged);
    },
    maintain: async () => {
      const deleted = await processNextDeletion();

      // Expired references are swept on a slow cadence; they are cleanup, not queue work.
      if (Date.now() > sweepAt) {
        await sweepExpiredUploadRefs();
        await sweepExpiredSecretRefs();
        sweepAt = Date.now() + 60_000;
      }
      if (Date.now() > researchSweepAt) {
        await sweepResearchStaging();
        await sweepResearchOrphans();
        await database.prepare('DELETE FROM research_quarantine WHERE expires_at<CURRENT_TIMESTAMP').run();
        await sweepAgentTraces();
        researchSweepAt = Date.now() + 60 * 60_000;
      }
      return deleted;
    },
    onError: error => {
      captureOperationalError(error, 'documents.worker');
      // The message is what makes an ingestion or indexing failure diagnosable; swallowing it
      // leaves a queue that stalls with no way to find out why.
      console.error('Falha no worker:', error instanceof Error ? error.message : error);
      if (process.argv.includes('--once')) process.exitCode = 1;
    },
  });
}

void runObservedWorker('documents-worker', main);
