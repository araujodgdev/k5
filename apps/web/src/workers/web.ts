import { withSentry } from '@sentry/cloudflare';
import handler from 'vinext/server/fetch-handler';
import { serverOptions } from '../lib/observability/options';
import { database, withPostgres } from '../lib/database';
import { withWhatsAppEnvironment, type WhatsAppEnvironment } from '../lib/whatsapp/environment';
import { withAdsEnvironment } from '../lib/ads/environment';
import { withPersonalChatEnvironment, type PersonalChatEnvironment } from '../lib/personal-chat/environment';
import { createPostgresPool } from '../lib/db/postgres';
import { closePoolWithResponse } from '../lib/db/request';
import { withSecurityHeaders } from '../lib/security-headers';
import { dueProcessors } from '../lib/processor-schedule';
import { captureOperationalError, observeSchedule } from '../lib/observability/report';
import { tutorialVideoResponse } from '../lib/tutorial-video-response';
import { withTrademarkEnvironment } from '../lib/research/trademarks/environment';
import { pendingTrademarkTasks } from '../lib/research/trademarks/worker';
import { drainHonchoOutbox } from '../lib/honcho-memory';

export { LumeProcessor, ContainerProxy } from './processors';
export { LumeChatRun } from './chat-runs';
export { LumeTrademarkRun } from './trademark-runs';

type WebEnv = CloudflareEnv & {
  HYPERDRIVE: { connectionString: string };
  PROCESSORS: { getByName(name: string): { run(role: 'documents' | 'judicial'): Promise<void> } };
  PROCESSORS_ENABLED?: string;
};

export * from 'vinext/server/fetch-handler';
export default withSentry<WebEnv>(env => serverOptions('web', env), {
  async scheduled(event: { scheduledTime: number }, env: WebEnv) {
    return observeSchedule('lume-processors-dispatch', async () => {
    const pool = createPostgresPool(env.HYPERDRIVE.connectionString, { max: 1, idleTimeoutMillis: 0 });
    try {
      // The learning memory's sends and deletions left over by chat turns (honcho-memory.ts).
      await withPostgres(pool, () => drainHonchoOutbox({ limit: 50 })).catch(error => captureOperationalError(error, 'honcho.drain'));
      const searches = await withPostgres(pool, () => pendingTrademarkTasks());
      await Promise.allSettled(searches.map(id => env.TRADEMARK_RUNS.getByName(id).start(id)));
      if (env.PROCESSORS_ENABLED !== 'true') return;
      const due = await withPostgres(pool, () => dueProcessors(database, event.scheduledTime, Math.floor(event.scheduledTime / 60_000) % 5 === 0));
      const roles = (['documents', 'judicial'] as const).filter(role => due[role]);
      const results = await Promise.allSettled(roles.map(async role => {
        try { await env.PROCESSORS.getByName(role).run(role); }
        catch (error) { captureOperationalError(error, 'processors.dispatch', { processor: role }); throw error; }
      }));
      if (results.some(result => result.status === 'rejected')) throw new Error('Lume processor dispatch did not complete.');
    } finally { await pool.end(); }
    });
  },
  async fetch(request: Request, env: CloudflareEnv & WhatsAppEnvironment & PersonalChatEnvironment & { HYPERDRIVE: { connectionString:string } }, ctx: { waitUntil(promise:Promise<unknown>):void }) {
    if (/^\/tutorial\/videos\/[a-z0-9-]+\/video\.mp4$/.test(new URL(request.url).pathname)) return withSecurityHeaders(await tutorialVideoResponse(request, env.ASSETS));
    const pool = createPostgresPool(env.HYPERDRIVE.connectionString, { max:5, idleTimeoutMillis:0 });
    return withPostgres(pool, () => withTrademarkEnvironment(env, () => withAdsEnvironment(env, () => withWhatsAppEnvironment(env, () => withPersonalChatEnvironment(env, async () => {
      try {
        const response = await handler.fetch(request,env,ctx);
        return withSecurityHeaders(closePoolWithResponse(response,pool,promise=>ctx.waitUntil(promise)), request);
      } catch (error) { await pool.end(); throw error; }
    })))));
  },
});
