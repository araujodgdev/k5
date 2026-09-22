// A DSN is a public ingestion address, not an API/auth token.
export const SENTRY_ORG = 'lume-wr';
export const SENTRY_PROJECT = 'lume';
export const SENTRY_DSN = 'https://15cd1d8f7f94c876898fb0a083bcc691@o4512130022834176.ingest.us.sentry.io/4512130123169792';

export function sampleRate(value: string | undefined, fallback = 0.1): number {
  if (!value?.trim()) return fallback;
  const rate = Number(value);
  return Number.isFinite(rate) && rate >= 0 && rate <= 1 ? rate : fallback;
}
