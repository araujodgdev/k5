import { runObservedWorker, captureOperationalError, observeWorkerTask } from './sentry-worker';

/**
 * Collection worker, separate from the document worker on purpose (section 5.1 of
 * docs/plano-infra-judicial.md): OCR and embedding compete for CPU, while collection is mostly
 * waiting on a court and is bounded by that court's budget. Running them in one loop means a slow
 * gazette delays an upload the person is watching.
 *
 *   pnpm judicial:worker            continuous
 *   pnpm judicial:worker --once     a single pass, for development and tests
 *
 * Nothing in this loop reaches a real court unless an operator enabled the installation *and*
 * enabled live transport for it. Until then the connectors answer from registered samples.
 */

const SCHEDULE_INTERVAL_MS = 30_000;
const IDLE_SLEEP_MS = 2_000;

async function main() {
  const { scheduleDueSubscriptions } = await import('../src/lib/judicial/jobs/scheduler');
  const { processNextJudicialJob } = await import('../src/lib/judicial/jobs/collector');

  const once = process.argv.includes('--once');
  let stopping = false;
  process.on('SIGINT', () => { stopping = true; });
  process.on('SIGTERM', () => { stopping = true; });

  console.log('Worker judicial ativo. Aguardando assinaturas e coletas.');

  let scheduleAt = 0;
  do {
    try {
      // Scheduling is cheap and runs on its own cadence; the collector is what costs a request.
      if (Date.now() >= scheduleAt) {
        const scheduled = await scheduleDueSubscriptions();
        if (scheduled.queued) console.log(`Agendadas ${scheduled.queued} coleta(s).`);
        for (const skipped of scheduled.skipped) {
          console.log(`Assinatura ${skipped.subscriptionId} ignorada: ${skipped.reason}`);
        }
        scheduleAt = Date.now() + SCHEDULE_INTERVAL_MS;
      }

      const outcome = await observeWorkerTask('judicial.collect', processNextJudicialJob);
      if (outcome) console.log(`Coleta ${outcome.jobId}: ${outcome.status} — ${outcome.detail}`);

      if (once) break;
      if (!outcome) await new Promise((resolve) => setTimeout(resolve, IDLE_SLEEP_MS));
    } catch (error) {
      captureOperationalError(error, 'judicial.worker');
      // The message is what makes a stalled queue diagnosable; swallowing it leaves an operator
      // with a worker that silently collects nothing.
      console.error('Falha no worker judicial:', error instanceof Error ? error.message : error);
      if (once) { process.exitCode = 1; break; }
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  } while (!stopping);
}

void runObservedWorker('judicial-worker', main);
