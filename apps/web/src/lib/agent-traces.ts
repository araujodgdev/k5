import 'server-only';
import type { Database } from './database';
import { SENTRY_ORG } from './observability/settings';

/** Read side of the agent traces written by observability/agent-trace.ts, for platform administrators only. */
export type AgentTraceRow = {
  id: string; officeName: string; userEmail: string; conversationId: string; task: string; provider: string; modelId: string;
  sentryTraceId: string | null; status: string; steps: number; toolCalls: number; inputTokens: number | null; outputTokens: number | null;
  error: string | null; startedAt: string; finishedAt: string | null;
};
export type AgentTraceEventRow = { seq: number; kind: string; name: string | null; atMs: number; durationMs: number | null; data: string };

const columns = `t.id, o.name AS "officeName", u.email AS "userEmail", t.conversation_id AS "conversationId", t.task, t.provider, t.model_id AS "modelId",
  t.sentry_trace_id AS "sentryTraceId", t.status, t.steps, t.tool_calls AS "toolCalls", t.input_tokens AS "inputTokens", t.output_tokens AS "outputTokens",
  t.error, t.started_at AS "startedAt", t.finished_at AS "finishedAt"
  FROM agent_trace t JOIN office o ON o.id=t.office_id JOIN "user" u ON u.id=t.user_id`;

export async function listAgentTraces(db: Database, filter: { status?: string; limit?: number } = {}) {
  const status = filter.status && ['running', 'completed', 'halted', 'failed', 'cancelled'].includes(filter.status) ? filter.status : null;
  return db.prepare(`SELECT ${columns} WHERE (CAST(? AS TEXT) IS NULL OR t.status=?) ORDER BY t.started_at DESC LIMIT ?`)
    .all<AgentTraceRow>(status, status, Math.min(filter.limit ?? 50, 200));
}

export async function agentTraceDetail(db: Database, id: string) {
  const trace = await db.prepare(`SELECT ${columns} WHERE t.id=?`).get<AgentTraceRow>(id);
  if (!trace) return null;
  const events = await db.prepare('SELECT seq, kind, name, at_ms AS "atMs", duration_ms AS "durationMs", data FROM agent_trace_event WHERE trace_id=? ORDER BY seq')
    .all<AgentTraceEventRow>(id);
  return { trace, events };
}

export const sentryTraceUrl = (traceId: string) => `https://${SENTRY_ORG}.sentry.io/explore/traces/trace/${encodeURIComponent(traceId)}/`;
