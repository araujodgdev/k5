import { runObservedWorker, captureOperationalError, observeWorkerTask } from './sentry-worker';

const once = process.argv.includes('--once');
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { stopping = true; });

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function main() {
  const { database } = await import('../src/lib/database');
  const { NodeWebPushSender } = await import('../src/lib/notifications/push');
  const { runNotificationPass } = await import('../src/lib/notifications/worker');
  const sender = process.env.K5_VAPID_PRIVATE_KEY && process.env.K5_VAPID_PUBLIC_KEY && process.env.K5_VAPID_SUBJECT
    ? new NodeWebPushSender()
    : undefined;
  do {
    try {
      const counts = await observeWorkerTask('notifications.pass', () => runNotificationPass({ db: database, sender, maxPerQueue: once ? 100 : 25 }));
      if (once) console.log(JSON.stringify({ worker: 'notifications', ...counts }));
      if (!once && !Object.values(counts).some(Boolean)) await sleep(1_500);
    } catch (error) {
      captureOperationalError(error, 'notifications.worker');
      console.error('[notifications] passagem falhou', error instanceof Error ? { name: error.name, message: error.message } : { type: typeof error });
      if (!once) await sleep(5_000);
      else process.exitCode = 1;
    }
  } while (!once && !stopping);
  await database.close();
}

void runObservedWorker('notifications-worker', main);
