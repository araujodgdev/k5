import { withSentry } from '@sentry/cloudflare';
import handler from 'vinext/server/fetch-handler';
import { serverOptions } from '../lib/observability/options';
import { database, withPostgres } from '../lib/database';
import { createPostgresPool } from '../lib/db/postgres';
import { closePoolWithResponse } from '../lib/db/request';
import { dueProcessors } from '../lib/processor-schedule';
import { captureOperationalError } from '../lib/observability/report';

export { LumeProcessor, ContainerProxy } from './processors';

type WebEnv = CloudflareEnv & {
  HYPERDRIVE: { connectionString: string };
  PROCESSORS: { getByName(name: string): { run(role: 'documents' | 'judicial'): Promise<void> } };
  PROCESSORS_ENABLED?: string;
};

export * from 'vinext/server/fetch-handler';
export default withSentry<WebEnv>(env => serverOptions('web', env), {
  async scheduled(event: { scheduledTime: number }, env: WebEnv) {
    if (env.PROCESSORS_ENABLED !== 'true') return;
    const pool = createPostgresPool(env.HYPERDRIVE.connectionString, { max: 1, idleTimeoutMillis: 0 });
    try {
      const due = await withPostgres(pool, () => dueProcessors(database, event.scheduledTime, Math.floor(event.scheduledTime / 60_000) % 5 === 0));
      const results = await Promise.allSettled((['documents', 'judicial'] as const)
        .filter(role => due[role]).map(role => env.PROCESSORS.getByName(role).run(role)));
      for (const result of results) if (result.status === 'rejected') captureOperationalError(result.reason, 'processors.dispatch');
    } finally { await pool.end(); }
  },
  async fetch(request: Request, env: CloudflareEnv & { HYPERDRIVE: { connectionString:string } }, ctx: { waitUntil(promise:Promise<unknown>):void }) {
    const pool = createPostgresPool(env.HYPERDRIVE.connectionString, { max:5, idleTimeoutMillis:0 });
    return withPostgres(pool, async () => {
      try {
        const response = await handler.fetch(request,env,ctx);
        return closePoolWithResponse(response,pool,promise=>ctx.waitUntil(promise));
      } catch (error) { await pool.end(); throw error; }
    });
  },
});
