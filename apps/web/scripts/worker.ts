import { existsSync } from 'node:fs';
if (existsSync('.env.local')) process.loadEnvFile('.env.local');

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
  console.log('Worker K5 ativo. Aguardando documentos, indexação e tarefas.');

  let sweepAt = 0;
  await runWorkerQueues({
    stopping: () => stopping,
    once: process.argv.includes('--once'),
    processDocuments: async () => {
      const ingested = await processNextVaultDocument();
      const indexed = await processNextIndexJob();
      const processed = await processNextRun();
      return ingested || indexed || processed;
    },
    verifyDocuments: processNextVerification,
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
      // The message is what makes an ingestion or indexing failure diagnosable; swallowing it
      // leaves a queue that stalls with no way to find out why.
      console.error('Falha no worker:', error instanceof Error ? error.message : error);
      if (process.argv.includes('--once')) process.exitCode = 1;
    },
  });
}

main().catch((error) => {
  console.error('Não foi possível iniciar o worker. Execute pnpm db:setup.', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
