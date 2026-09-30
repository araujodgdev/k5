import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';

type TrademarkEnvironment = Pick<CloudflareEnv, 'TRADEMARK_RUNS'>;
const runtime = new AsyncLocalStorage<TrademarkEnvironment>();
export const withTrademarkEnvironment = <T>(env: TrademarkEnvironment, work: () => T): T => runtime.run(env, work);
export async function wakeTrademarkRun(searchId: string): Promise<boolean> {
  const env = runtime.getStore();
  if (!env?.TRADEMARK_RUNS) return false;
  await env.TRADEMARK_RUNS.getByName(searchId).start(searchId);
  return true;
}
