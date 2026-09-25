import type { Database } from "./database";

/** One step, model and effort over the window: counts and token totals only, never content. */
export type AiUsageRow = {
  profile: string; modelId: string; reasoningEffort: string | null;
  completed: number; failed: number; escalated: number; p95Ms: number | null;
  inputTokens: number; cachedInputTokens: number; outputTokens: number; reasoningTokens: number;
};

export const USAGE_WINDOW_DAYS = 7;

/**
 * The platform-wide view the administration shows. Rows written before the telemetry columns
 * existed have no profile and are grouped under their task, so old volume is not lost.
 */
export async function aiUsageSummary(db: Database, days = USAGE_WINDOW_DAYS): Promise<AiUsageRow[]> {
  const rows = await db.prepare(`SELECT coalesce(profile, task) AS profile, model_id, reasoning_effort,
      count(*) FILTER (WHERE status = 'completed') AS completed,
      count(*) FILTER (WHERE status = 'failed') AS failed,
      count(*) FILTER (WHERE escalated_from IS NOT NULL) AS escalated,
      percentile_disc(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_ms,
      coalesce(sum(input_tokens), 0) AS input_tokens, coalesce(sum(cached_input_tokens), 0) AS cached_input_tokens,
      coalesce(sum(output_tokens), 0) AS output_tokens, coalesce(sum(reasoning_tokens), 0) AS reasoning_tokens
    FROM ai_usage
    WHERE created_at > now() - make_interval(days => CAST(? AS INTEGER))
    GROUP BY 1, 2, 3
    ORDER BY 1, 2, 3`).all(days) as Array<Record<string, string | number | null>>;
  const number = (value: string | number | null) => value === null ? 0 : Number(value);
  return rows.map((row) => ({
    profile: String(row.profile), modelId: String(row.model_id), reasoningEffort: row.reasoning_effort === null ? null : String(row.reasoning_effort),
    completed: number(row.completed), failed: number(row.failed), escalated: number(row.escalated),
    p95Ms: row.p95_ms === null ? null : Number(row.p95_ms),
    inputTokens: number(row.input_tokens), cachedInputTokens: number(row.cached_input_tokens),
    outputTokens: number(row.output_tokens), reasoningTokens: number(row.reasoning_tokens),
  }));
}
