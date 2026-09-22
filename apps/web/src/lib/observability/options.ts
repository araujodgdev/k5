import { privacyOptions } from './privacy';
import { SENTRY_DSN, sampleRate } from './settings';

export function serverOptions(service: string, env: {
  SENTRY_DSN?: string;
  SENTRY_ENVIRONMENT?: string;
  SENTRY_RELEASE?: string;
  SENTRY_ENABLED?: string;
  SENTRY_TRACES_SAMPLE_RATE?: string;
  NODE_ENV?: string;
}) {
  const environment = env.SENTRY_ENVIRONMENT || env.NODE_ENV || 'development';
  const dsn = env.SENTRY_DSN ?? SENTRY_DSN;
  return {
    ...privacyOptions,
    dsn,
    environment,
    ...(env.SENTRY_RELEASE ? { release: env.SENTRY_RELEASE } : {}),
    enabled: Boolean(dsn) && (env.SENTRY_ENABLED === 'true' ||
      (env.SENTRY_ENABLED !== 'false' && !['development', 'test'].includes(environment))),
    tracesSampleRate: sampleRate(env.SENTRY_TRACES_SAMPLE_RATE),
    // Do not propagate trace/baggage headers to user-configured AI providers or courts.
    tracePropagationTargets: [],
    initialScope: { tags: { service } },
  };
}
