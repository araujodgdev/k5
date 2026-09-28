import { existsSync } from 'node:fs';
import * as Sentry from '@sentry/node';
import { serverOptions } from '../src/lib/observability/options';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');

const checkId = `sentry-setup-${Date.now()}`;
Sentry.init({
  ...serverOptions('setup-verification', process.env),
  enabled: true,
  environment: 'verification',
  tracesSampleRate: 1,
});

let eventId = '';
await Sentry.startSpan({ name: 'sentry.setup.verify', op: 'test' }, async () => {
  eventId = Sentry.captureException(new Error('Lume Sentry setup verification'), {
    tags: { verification_id: checkId },
  });
});
const delivered = await Sentry.close(10_000);
console.log(JSON.stringify({ delivered, eventId, verificationId: checkId }));
if (!delivered) process.exitCode = 1;
