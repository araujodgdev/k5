import { AsyncLocalStorage } from 'node:async_hooks';

const state = globalThis as typeof globalThis & { testRequestHeaders?: AsyncLocalStorage<Headers> };
export const requestHeaders = state.testRequestHeaders ??= new AsyncLocalStorage<Headers>();
export async function headers() {
  const value = requestHeaders.getStore();
  if (!value) throw new Error('Request headers missing from route test');
  return value;
}
