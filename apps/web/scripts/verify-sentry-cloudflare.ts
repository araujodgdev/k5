import { withSentry, captureException } from '@sentry/cloudflare';
import { serverOptions } from '../src/lib/observability/options';

// Standalone local smoke worker. Never used by either deployment configuration.
export default withSentry(() => ({
  ...serverOptions('cloudflare-verification', { SENTRY_ENVIRONMENT: 'verification' }),
  tracesSampleRate: 1,
}), {
  async fetch() {
    const eventId = captureException(new Error('Lume Cloudflare Sentry setup verification'));
    return Response.json({ eventId });
  },
});
