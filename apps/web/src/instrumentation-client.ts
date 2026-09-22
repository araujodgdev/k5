import * as Sentry from '@sentry/react';
import { privacyOptions, telemetryUrl } from './lib/observability/privacy';
import { SENTRY_DSN, sampleRate } from './lib/observability/settings';

const environment = process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV;
const enabled = process.env.NEXT_PUBLIC_SENTRY_ENABLED === 'true' ||
  (process.env.NEXT_PUBLIC_SENTRY_ENABLED !== 'false' && environment !== 'development' && environment !== 'test');

// The browser SDK supports both Next.js and vinext without importing Node instrumentation.
Sentry.init({
  ...privacyOptions,
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN ?? SENTRY_DSN,
  enabled,
  environment,
  initialScope: { tags: { service: 'browser' } },
  ...(process.env.NEXT_PUBLIC_SENTRY_RELEASE ? { release: process.env.NEXT_PUBLIC_SENTRY_RELEASE } : {}),
  tracesSampleRate: sampleRate(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE),
  tracePropagationTargets: [/^\/(?!\/)/, new RegExp(`^${window.location.origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`)],
  integrations: [Sentry.browserTracingIntegration({
    instrumentNavigation: false,
    beforeStartSpan: options => ({ ...options, name: telemetryUrl(window.location.pathname) }),
  })],
});

export function onRouterTransitionStart(url: string) {
  const client = Sentry.getClient();
  if (client) Sentry.startBrowserTracingNavigationSpan(client, { name: telemetryUrl(url), op: 'navigation' });
}
