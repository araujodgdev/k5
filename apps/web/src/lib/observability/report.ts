import { captureException, getActiveSpan, getClient, startNewTrace, startSpan, withIsolationScope, withMonitor, type Span } from '@sentry/core';
import { diagnosticTags } from './diagnostics';

/**
 * `tags` must be application-owned identifiers (a pipeline stage, an error code the code itself
 * minted), never text that came from a provider, a document or a person.
 */
export function captureOperationalError(error: unknown, operation: string, tags: Record<string, string> = {}) {
  // Provider/transport errors may embed complete prompts, response bodies or credentials.
  // Keep the native reporting call site; a provider can forge even apparently valid stack frames.
  const safe = new Error(`Lume: ${operation} failed`);
  const context = { ...diagnosticTags(error), ...tags, operation };
  const eventId = captureException(safe, { tags: context, fingerprint: ['lume', operation, tags.stage ?? 'default'] });
  if (getClient()?.getOptions().enabled !== false && getClient()) {
    console.error(JSON.stringify({ event: 'operational_error', event_id: eventId,
      trace_id: getActiveSpan()?.spanContext().traceId, ...context }));
  }
  return eventId;
}

export function observeSchedule<T>(slug: string, task: () => Promise<T>, schedule = '* * * * *', maxRuntime = 5): Promise<T> {
  return withMonitor(slug, async () => {
    // Cloudflare buffers transport until the handler finishes; send the start before long jobs.
    try { await getClient()?.getTransport()?.flush(2_000); }
    catch { /* Reporting failure must not prevent the scheduled work. */ }
    return task();
  }, {
    schedule: { type: 'crontab', value: schedule }, timezone: 'UTC',
    checkinMargin: 2, maxRuntime, failureIssueThreshold: 2, recoveryThreshold: 1,
  });
}

export function observeWorkerTask<T>(operation: string, task: () => Promise<T>): Promise<T> {
  return withIsolationScope(() => startSpan({ name: operation, op: 'queue.process' }, () => task()));
}

/**
 * Lume's agent loop as Sentry spans: one per turn, one per tool call. Attributes are identifiers
 * the application minted (task, provider, model, tool names) and counts; prompts, tool inputs and
 * results never become span data, and beforeSendSpan drops anything else that gets attached.
 */
export function traceAgentTurn<T>(turn: { task: string; provider: string; modelId: string }, action: (span: Span) => Promise<T>, options: { root?: boolean } = {}): Promise<T> {
  const traced = () => startSpan({
    name: `invoke_agent Lume ${turn.task}`,
    op: 'gen_ai.invoke_agent',
    attributes: {
      'gen_ai.operation.name': 'invoke_agent', 'gen_ai.agent.name': 'Lume',
      'gen_ai.system': turn.provider, 'gen_ai.request.model': turn.modelId, 'lume.task': turn.task,
    },
  }, action);
  // A chat turn outlives the request that started it, so it opens its own trace, which the sampler
  // always keeps (options.ts) and agent_trace links to. Structured calls stay inside their request.
  return options.root ? startNewTrace(traced) : traced();
}

export function traceToolCall<T>(tool: string, action: () => Promise<T>): Promise<T> {
  return startSpan({
    name: `execute_tool ${tool}`,
    op: 'gen_ai.execute_tool',
    attributes: { 'gen_ai.operation.name': 'execute_tool', 'gen_ai.tool.name': tool },
  }, () => action());
}
