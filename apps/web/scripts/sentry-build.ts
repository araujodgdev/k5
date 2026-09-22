import { existsSync } from 'node:fs';
import { SENTRY_ORG, SENTRY_PROJECT } from '../src/lib/observability/settings';

// Build credentials never use NEXT_PUBLIC_* and are never bundled into runtime config.
if (existsSync('.env.sentry-build.local')) process.loadEnvFile('.env.sentry-build.local');

export const sentryBuildOptions = {
  org: process.env.SENTRY_ORG || SENTRY_ORG,
  project: process.env.SENTRY_PROJECT || SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  telemetry: false,
  silent: !process.env.CI,
};

if (!sentryBuildOptions.authToken && process.env.NODE_ENV === 'production') {
  console.warn('[Sentry] Source maps não serão enviados: configure SENTRY_AUTH_TOKEN para este build.');
}

if (process.env.SENTRY_REQUIRE_SOURCEMAPS === 'true' && !sentryBuildOptions.authToken) {
  throw new Error('SENTRY_AUTH_TOKEN é obrigatório para enviar os source maps deste build.');
}
