import { AsyncLocalStorage } from 'node:async_hooks';
import type { FlagshipEnvironment } from '@/lib/flagship';

export type AdsEnvironment = FlagshipEnvironment & Partial<Record<
  'K5_CREDENTIALS_KEY' | 'K5_CREDENTIALS_PREVIOUS_KEYS' | 'K5_CREDENTIALS_NEXT_KEY', string>>;
const environment = new AsyncLocalStorage<AdsEnvironment>();
export function adsEnvironment(): AdsEnvironment { return environment.getStore() ?? process.env; }
export function withAdsEnvironment<T>(env: AdsEnvironment, action: () => T): T { return environment.run(env, action); }
