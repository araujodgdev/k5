import { runObservedWorker, captureOperationalError, observeWorkerTask } from './sentry-worker';

const once = process.argv.includes('--once');
// In Cloudflare staging the integrations Worker owns the light queue; containers pass --node-only.
const nodeOnly = process.argv.includes('--node-only');
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { stopping = true; });
const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function main() {
  const { database } = await import('../src/lib/database');
  const { googleOAuthConfig } = await import('../src/lib/google/config');
  const { runGoogleNodePass } = await import('../src/lib/google/worker-node');
  if (!googleOAuthConfig()) console.log('[integrations] Google OAuth não configurado; o worker só executa manutenção.');
  do {
    try {
      const counts = await observeWorkerTask('google.pass', () => runGoogleNodePass({ db: database, includeEdge: !nodeOnly, max: once ? 100 : 25 }));
      if (once) console.log(JSON.stringify({ worker: 'integrations', ...counts }));
      if (!once && !counts.node && !counts.edge) await sleep(2_000);
    } catch (error) {
      captureOperationalError(error, 'integrations.worker');
      console.error('[integrations] passagem falhou', error instanceof Error ? { name: error.name } : { type: typeof error });
      if (!once) await sleep(5_000);
      else process.exitCode = 1;
    }
  } while (!once && !stopping);
  await database.close();
}

void runObservedWorker('integrations-worker', main);
