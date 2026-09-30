import { AsyncLocalStorage } from 'node:async_hooks';

// Only the verified invitation route enters this context; a sign-up body cannot select its account kind.
const registration = new AsyncLocalStorage<{ token: string }>();
export const clientRegistration = () => registration.getStore();
export function withClientRegistration<T>(token: string, action: () => T): T { return registration.run({ token }, action); }
