import type { Instrumentation } from 'next';

export async function register() {
  // Cloudflare initializes per request in withSentry, never in the shared isolate.
  if (process.env.K5_RUNTIME === 'cloudflare') return;
  if (process.env.NEXT_RUNTIME === 'nodejs') await import('./sentry.server.config');
  if (process.env.NEXT_RUNTIME === 'edge') await import('./sentry.edge.config');
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.K5_RUNTIME === 'cloudflare') {
    const Sentry = await import('@sentry/core');
    Sentry.captureException(error, { tags: { route: context.routePath, route_type: context.routeType } });
  } else {
    const Sentry = await import('@sentry/nextjs');
    Sentry.captureRequestError(error, request, context);
  }
};
