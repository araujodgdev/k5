import { DurableObject } from 'cloudflare:workers';
import { instrumentDurableObjectWithSentry } from '@sentry/cloudflare';
import { z } from 'zod';
import { withPostgres } from '../lib/database';
import { createPostgresPool } from '../lib/db/postgres';
import { captureOperationalError } from '../lib/observability/report';
import { serverOptions } from '../lib/observability/options';
import { pendingTrademarkTasks, processTrademarkTask } from '../lib/research/trademarks/worker';
import { createWipoBrowser } from '../lib/research/trademarks/wipo';

type TrademarkState = {
  storage: { get<T>(key: string): Promise<T | undefined>; put(key: string, value: string): Promise<void>; setAlarm(time: number): Promise<void>; deleteAlarm(): Promise<void> };
  waitUntil(promise: Promise<unknown>): void;
};

class TrademarkRunObject extends DurableObject<CloudflareEnv> {
  private running: Promise<void> | undefined;
  constructor(private readonly state: TrademarkState, env: CloudflareEnv) { super(state, env); }

  async start(searchId: string): Promise<void> {
    z.uuid().parse(searchId);
    const previous = await this.state.storage.get<string>('searchId');
    if (previous && previous !== searchId) throw new Error('Execução de pesquisa incompatível.');
    await this.state.storage.put('searchId', searchId);
    if (this.running) return;
    await this.state.storage.setAlarm(Date.now() + 60_000);
    const pool = createPostgresPool(this.env.HYPERDRIVE.connectionString, { max: 3, idleTimeoutMillis: 0 });
    this.running = withPostgres(pool, async () => {
      for (let step = 0; step < 3; step++) {
        if (!await processTrademarkTask(searchId, () => createWipoBrowser(this.env.BROWSER))) break;
      }
      return (await pendingTrademarkTasks(searchId)).length > 0;
    }).catch(error => { captureOperationalError(error, 'research.trademarks.run', { searchId }); return true; })
      .then(async pending => {
        if (pending) await this.state.storage.setAlarm(Date.now() + 60_000);
        else await this.state.storage.deleteAlarm();
      }).finally(async () => { await pool.end(); this.running = undefined; });
    this.state.waitUntil(this.running);
  }

  async alarm(): Promise<void> {
    if (this.running) { await this.state.storage.setAlarm(Date.now() + 60_000); return; }
    const id = await this.state.storage.get<string>('searchId');
    if (id) await this.start(id);
  }
}

export const LumeTrademarkRun = instrumentDurableObjectWithSentry(
  (env: CloudflareEnv) => serverOptions('web-trademarks', env),
  TrademarkRunObject as never,
) as unknown as typeof TrademarkRunObject;
