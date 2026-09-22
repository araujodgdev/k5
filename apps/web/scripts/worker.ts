import { runObservedWorker, captureOperationalError, observeWorkerTask } from './sentry-worker';

async function main() {
  const { processNextVaultDocument } = await import('../src/lib/vault');
  const { processNextRun } = await import('../src/lib/document-workflows');
  const { processNextVerification } = await import('../src/lib/typesafe/verification');
  const { processNextIndexJob, processNextDeletion } = await import('../src/lib/knowledge/indexing');
  const { sweepExpiredUploadRefs } = await import('../src/lib/application/uploads-service');
  const { sweepExpiredSecretRefs } = await import('../src/lib/application/secrets-service');
  const { runWorkerQueues } = await import('../src/lib/worker-scheduler');

  let stopping = false;
  process.on('SIGINT', () => { stopping = true; });
  process.on('SIGTERM', () => { stopping = true; });
  console.log('Worker Lume ativo. Aguardando documentos, indexação e tarefas.');

  let sweepAt = 0;
  await runWorkerQueues({
    stopping: () => stopping,
    once: process.argv.includes('--once'),
    processDocuments: async () => {
      const ingested = await observeWorkerTask('vault.ingest', processNextVaultDocument);
      const indexed = await observeWorkerTask('knowledge.index', processNextIndexJob);
      const processed = await observeWorkerTask('documents.run', processNextRun);
      return ingested || indexed || processed;
    },
    verifyDocuments: () => observeWorkerTask('documents.verify', processNextVerification),
    maintain: async () => {
      const deleted = await processNextDeletion();

      // Expired references are swept on a slow cadence; they are cleanup, not queue work.
      if (Date.now() > sweepAt) {
        await sweepExpiredUploadRefs();
        await sweepExpiredSecretRefs();
        sweepAt = Date.now() + 60_000;
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
