import { withSentry } from '@sentry/cloudflare';
import handler from 'vinext/server/fetch-handler';
import { serverOptions } from '../lib/observability/options';
import { withPostgres } from '../lib/database';
import { createPostgresPool } from '../lib/db/postgres';
import { closePoolWithResponse } from '../lib/db/request';
import { withSecurityHeaders } from '../lib/security-headers';

// HTTP only: no processor classes, scheduled handler, queue consumer or service binding.
export * from 'vinext/server/fetch-handler';
export default withSentry<PreviewEnv>(env => serverOptions('web-preview', env), {
  async fetch(request: Request, env: PreviewEnv, ctx: { waitUntil(promise: Promise<unknown>): void }) {
    const pool = createPostgresPool(env.HYPERDRIVE.connectionString, { max: 5, idleTimeoutMillis: 0 });
    return withPostgres(pool, async () => {
      try {
        const response = await handler.fetch(request, env, ctx);
        return withSecurityHeaders(closePoolWithResponse(response, pool, promise => ctx.waitUntil(promise)), request);
      } catch (error) { await pool.end(); throw error; }
    });
  },
});
