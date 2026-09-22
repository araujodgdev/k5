import { existsSync } from 'node:fs';
import * as Sentry from '@sentry/node';
import { serverOptions } from '../src/lib/observability/options';
import { captureOperationalError } from '../src/lib/observability/report';

export { captureOperationalError, observeWorkerTask } from '../src/lib/observability/report';

export async function runObservedWorker(service: string, main: () => Promise<void>) {
  if (existsSync('.env.local')) process.loadEnvFile('.env.local');
  Sentry.init(serverOptions(service, process.env));
  try {
    await main();
  } catch (error) {
    captureOperationalError(error, `${service}.startup`);
    console.error(`Não foi possível executar ${service}.`, error instanceof Error ? error.message : typeof error);
    process.exitCode = 1;
  } finally {
    await Sentry.close(5_000);
  }
}
