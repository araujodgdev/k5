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
  const { runWhatsAppPass } = await import('../src/lib/whatsapp/worker');
  const { runPersonalEmailPass } = await import('../src/lib/personal-chat/email-worker');
  const { purgeExpiredWhatsAppUploads } = await import('../src/lib/whatsapp/media');
  const { runIntegrationPass, IntegrationPassError } = await import('../src/lib/integration-pass');
  const { databaseFailure } = await import('../src/lib/db/failure');
  if (!googleOAuthConfig()) console.log('[integrations] Google OAuth não configurado; o worker só executa manutenção.');
  do {
    try {
      const results = await runIntegrationPass(database, [
        { name: 'google', run: () => observeWorkerTask('google.pass', () => runGoogleNodePass({ db: database, includeEdge: !nodeOnly, max: once ? 100 : 25 })) },
        ...nodeOnly ? [] : [
          { name: 'whatsapp_cleanup', run: purgeExpiredWhatsAppUploads },
          { name: 'whatsapp', run: () => observeWorkerTask('whatsapp.pass', () => runWhatsAppPass({ max: once ? 100 : 5, cleanup: false })) },
          { name: 'messages', run: () => observeWorkerTask('messages.pass', () => runPersonalEmailPass({ max: once ? 100 : 5 })) },
        ],
      ], nodeOnly ? 'node' : 'edge');
      if (once) console.log(JSON.stringify({ worker: 'integrations', results }));
      if (!once) await sleep(2_000);
    } catch (error) {
      captureOperationalError(error, 'integrations.worker');
      console.error('[integrations] passagem falhou', error instanceof Error ? { name: error.name } : { type: typeof error });
      if (!once) {
        const unavailable = databaseFailure(error) !== null || error instanceof IntegrationPassError && error.databaseUnavailable;
        const until = Date.now() + (unavailable ? 15 * 60_000 : 60_000);
        while (!stopping && Date.now() < until) await sleep(Math.min(1_000, until - Date.now()));
      }
      else process.exitCode = 1;
    }
  } while (!once && !stopping);
  await database.close();
}

void runObservedWorker('integrations-worker', main);
