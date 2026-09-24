import { captureException, startSpan, withIsolationScope, type Span } from '@sentry/core';

/**
 * `tags` must be application-owned identifiers (a pipeline stage, an error code the code itself
 * minted), never text that came from a provider, a document or a person.
 */
export function captureOperationalError(error: unknown, operation: string, tags: Record<string, string> = {}) {
  // Provider/transport errors may embed complete prompts, response bodies or credentials.
  // Preserve the call site and error class, but send only an application-owned message.
  const safe = new Error(`Lume: ${operation} failed`);
  if (error instanceof Error) {
    safe.name = error.name;
    if (error.stack) safe.stack = `${safe.name}: ${safe.message}\n${error.stack.split('\n').slice(1).join('\n')}`;
  }
  return captureException(safe, { tags: { ...tags, operation } });
}

export function observeWorkerTask<T>(operation: string, task: () => Promise<T>): Promise<T> {
  return withIsolationScope(() => startSpan({ name: operation, op: 'queue.process' }, () => task()));
}

/**
 * Lume's agent loop as Sentry spans: one per turn, one per tool call. Attributes are identifiers
 * the application minted (task, provider, model, tool names) and counts; prompts, tool inputs and
 * results never become span data, and beforeSendSpan drops anything else that gets attached.
 */
export function traceAgentTurn<T>(turn: { task: string; provider: string; modelId: string }, action: (span: Span) => Promise<T>): Promise<T> {
  return startSpan({
    name: `invoke_agent Lume ${turn.task}`,
    op: 'gen_ai.invoke_agent',
    attributes: {
      'gen_ai.operation.name': 'invoke_agent', 'gen_ai.agent.name': 'Lume',
      'gen_ai.system': turn.provider, 'gen_ai.request.model': turn.modelId, 'lume.task': turn.task,
    },
  }, action);
}

export function traceToolCall<T>(tool: string, action: () => Promise<T>): Promise<T> {
  return startSpan({
    name: `execute_tool ${tool}`,
    op: 'gen_ai.execute_tool',
    attributes: { 'gen_ai.operation.name': 'execute_tool', 'gen_ai.tool.name': tool },
  }, () => action());
}
