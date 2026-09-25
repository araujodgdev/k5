-- ai_usage records counts and codes for every model call, never prompts or answers. Until now it
-- held only the task and the visible token totals, so neither the cost of reasoning nor the
-- latency of a step could be measured, and a model swap could be neither approved nor reverted
-- on data. Every column is nullable: rows written before this migration stay valid. The statements
-- are idempotent: development databases may already carry these columns from an earlier draft.
ALTER TABLE ai_usage
  ADD COLUMN IF NOT EXISTS profile TEXT,
  ADD COLUMN IF NOT EXISTS reasoning_effort TEXT,
  ADD COLUMN IF NOT EXISTS duration_ms BIGINT,
  ADD COLUMN IF NOT EXISTS reasoning_tokens BIGINT,
  ADD COLUMN IF NOT EXISTS cached_input_tokens BIGINT,
  ADD COLUMN IF NOT EXISTS finish_reason TEXT,
  ADD COLUMN IF NOT EXISTS error_kind TEXT CHECK (error_kind IN ('schema','incomplete','timeout','provider','cancelled')),
  ADD COLUMN IF NOT EXISTS run_id TEXT,
  ADD COLUMN IF NOT EXISTS step_key TEXT,
  ADD COLUMN IF NOT EXISTS attempt INTEGER,
  ADD COLUMN IF NOT EXISTS escalated_from TEXT,
  ADD COLUMN IF NOT EXISTS variant TEXT CHECK (variant IN ('escalate','shadow')),
  ADD COLUMN IF NOT EXISTS validation_json TEXT;

CREATE INDEX IF NOT EXISTS ai_usage_created_profile ON ai_usage(created_at, profile);
