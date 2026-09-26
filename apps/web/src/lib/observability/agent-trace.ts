import 'server-only';
import { randomUUID } from 'node:crypto';
import { getActiveSpan, startInactiveSpan, type Span } from '@sentry/core';
import { database } from '@/lib/database';
import { captureOperationalError } from './report';

/** One JSON value per event, cut so a large page or document cannot bloat the table. */
const DATA_CHARACTERS = 16_000;
export const TRACE_RETENTION_DAYS = 30;

export type TraceStatus = 'completed' | 'halted' | 'failed' | 'cancelled';
type TraceEvent = { seq: number; kind: string; name: string | null; atMs: number; durationMs: number | null; data: string };
type Usage = { inputTokens?: number; outputTokens?: number } | undefined;

function serialize(value: unknown) {
  try {
    const text = JSON.stringify(value ?? {}) ?? '{}';
    return text.length > DATA_CHARACTERS ? JSON.stringify({ truncated: true, preview: text.slice(0, DATA_CHARACTERS) }) : text;
  } catch { return JSON.stringify({ unserializable: true }); }
}

/**
 * The debugging record of one agent turn. Events carry content (tool inputs and outputs, search
 * sources, errors) and go to PostgreSQL, scoped by office like the conversation they belong to.
 * Sentry gets the structure only: a span per model step and per provider-executed tool, with names,
 * durations and token counts, under the trace whose id this row keeps.
 *
 * Tracing never fails a turn: every write is best effort and reports its own failure.
 */
export class AgentTrace {
  readonly id = randomUUID();
  private readonly started = Date.now();
  private seq = 0;
  private pending: TraceEvent[] = [];
  private writing: Promise<unknown> = Promise.resolve();
  private stepSpan: Span | undefined;
  private stepStartedAt = this.started;
  private readonly calls = new Map<string, { at: number; span?: Span }>();
  steps = 0;
  toolCalls = 0;

  constructor(private readonly owner: { officeId: string; userId: string }, private readonly turn: {
    conversationId: string; task: string; provider: string; modelId: string;
  }) {}

  private safely(operation: Promise<unknown>) {
    return operation.catch(error => { captureOperationalError(error, 'agent.trace'); });
  }

  async open() {
    const traceId = getActiveSpan()?.spanContext().traceId ?? null;
    await this.safely(database.prepare(`INSERT INTO agent_trace(id,office_id,user_id,conversation_id,task,provider,model_id,sentry_trace_id)
      VALUES(?,?,?,?,?,?,?,?)`).run(this.id, this.owner.officeId, this.owner.userId, this.turn.conversationId, this.turn.task, this.turn.provider, this.turn.modelId, traceId));
  }

  event(kind: string, name: string | null, data: unknown, durationMs: number | null = null) {
    this.pending.push({ seq: this.seq++, kind, name, atMs: Date.now() - this.started, durationMs, data: serialize(data) });
  }

  stepStarted() {
    this.stepStartedAt = Date.now();
    this.stepSpan?.end();
    this.stepSpan = startInactiveSpan({
      name: `chat ${this.turn.modelId}`, op: 'gen_ai.chat',
      attributes: { 'gen_ai.operation.name': 'chat', 'gen_ai.system': this.turn.provider, 'gen_ai.request.model': this.turn.modelId },
    });
  }

  stepFinished(step: { reason?: string; usage?: Usage; text?: string }) {
    this.steps += 1;
    this.stepSpan?.setAttributes({ 'gen_ai.usage.input_tokens': step.usage?.inputTokens ?? 0, 'gen_ai.usage.output_tokens': step.usage?.outputTokens ?? 0 });
    this.stepSpan?.end();
    this.stepSpan = undefined;
    this.event('step', step.reason ?? null, { finishReason: step.reason, usage: step.usage, textCharacters: step.text?.length ?? 0 }, Date.now() - this.stepStartedAt);
    this.stepStartedAt = Date.now();
    void this.flush();
  }

  /** Our own tools already open a span in traceToolCall; the provider's (its web search) only show up here. */
  toolCall(callId: string, name: string, input: unknown, providerExecuted: boolean) {
    this.calls.set(callId, {
      at: Date.now(),
      span: providerExecuted ? startInactiveSpan({ name: `execute_tool ${name}`, op: 'gen_ai.execute_tool', attributes: { 'gen_ai.operation.name': 'execute_tool', 'gen_ai.tool.name': name } }) : undefined,
    });
    this.event('tool-call', name, { callId, input, providerExecuted });
  }

  toolResult(callId: string, name: string, output: unknown, failed: boolean) {
    this.toolCalls += 1;
    const call = this.calls.get(callId);
    call?.span?.end();
    this.calls.delete(callId);
    this.event('tool-result', name, { callId, failed, output }, call ? Date.now() - call.at : null);
  }

  /** Writes one batch at a time, in order, so a step's events never land after the turn closes. */
  flush() {
    const events = this.pending.splice(0);
    if (events.length) this.writing = this.writing.then(() => this.safely(database.batch(events.map(event => database.prepare(`INSERT INTO agent_trace_event(trace_id,seq,kind,name,at_ms,duration_ms,data)
      SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM agent_trace WHERE id=?)`)
      .bind(this.id, event.seq, event.kind, event.name, event.atMs, event.durationMs, event.data, this.id)))));
    return this.writing;
  }

  async close(status: TraceStatus, usage: Usage, error?: unknown) {
    this.stepSpan?.end();
    for (const call of this.calls.values()) call.span?.end();
    if (error) this.event('error', error instanceof Error ? error.name : null, { message: error instanceof Error ? error.message.slice(0, 2000) : String(error).slice(0, 2000) });
    await this.flush();
    await this.safely(database.prepare(`UPDATE agent_trace SET status=?, steps=?, tool_calls=?, input_tokens=?, output_tokens=?, error=?, finished_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(status, this.steps, this.toolCalls, usage?.inputTokens ?? null, usage?.outputTokens ?? null,
        error ? (error instanceof Error ? error.name : 'Error') : null, this.id));
  }
}

export async function sweepAgentTraces(now = Date.now()) {
  await database.prepare('DELETE FROM agent_trace WHERE started_at < ?').run(new Date(now - TRACE_RETENTION_DAYS * 86_400_000).toISOString());
}
