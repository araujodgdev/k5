import { captureException, startSpan, withIsolationScope } from '@sentry/core';

export function captureOperationalError(error: unknown, operation: string) {
  // Provider/transport errors may embed complete prompts, response bodies or credentials.
  // Preserve the call site and error class, but send only an application-owned message.
  const safe = new Error(`Lume: ${operation} failed`);
  if (error instanceof Error) {
    safe.name = error.name;
    if (error.stack) safe.stack = `${safe.name}: ${safe.message}\n${error.stack.split('\n').slice(1).join('\n')}`;
  }
  return captureException(safe, { tags: { operation } });
}

export function observeWorkerTask<T>(operation: string, task: () => Promise<T>): Promise<T> {
  return withIsolationScope(() => startSpan({ name: operation, op: 'queue.process' }, task));
}
