import { AsyncLocalStorage } from 'node:async_hooks';

const guards = new AsyncLocalStorage<() => Promise<void>>();

/** Re-check authority after token refresh and immediately before each external write. */
export async function checkGoogleWrite() { await guards.getStore()?.(); }
export function withGoogleWriteGuard<T>(guard: () => Promise<void>, action: () => Promise<T>) {
  return guards.run(guard, action);
}
