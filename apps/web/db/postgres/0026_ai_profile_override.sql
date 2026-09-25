-- Per-step model settings for the Lume. A profile with no row inherits its task's model (chat,
-- extraction or drafting) and the reasoning effort every OpenAI call used before, 'xhigh', so the
-- table starts empty and nothing changes at deploy.
CREATE TABLE IF NOT EXISTS ai_profile_override (
  profile TEXT PRIMARY KEY CHECK (profile IN ('chat','research_web','extraction_chunk','extraction_review','annex_plan','drafting')),
  connection_id TEXT REFERENCES ai_connection(id),
  model_id TEXT,
  reasoning_effort TEXT CHECK (reasoning_effort IN ('none','low','medium','high','xhigh','max')),
  max_output_tokens INTEGER CHECK (max_output_tokens BETWEEN 256 AND 128000),
  -- A second model that redoes a step whose output fails the code's checks.
  escalate_connection_id TEXT REFERENCES ai_connection(id),
  escalate_model_id TEXT,
  escalate_reasoning_effort TEXT CHECK (escalate_reasoning_effort IN ('none','low','medium','high','xhigh','max')),
  -- A model that runs next to the step for comparison; only its usage is recorded.
  shadow_connection_id TEXT REFERENCES ai_connection(id),
  shadow_model_id TEXT,
  shadow_reasoning_effort TEXT CHECK (shadow_reasoning_effort IN ('none','low','medium','high','xhigh','max')),
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((connection_id IS NULL) = (model_id IS NULL)),
  CHECK ((escalate_connection_id IS NULL) = (escalate_model_id IS NULL)),
  CHECK ((shadow_connection_id IS NULL) = (shadow_model_id IS NULL))
);

-- The settings each step of a run was queued with, so a change in the administration only reaches
-- new runs and a chronology never mixes two configurations. NULL on runs from before this column:
-- they keep reading model_provider and model_id.
ALTER TABLE ai_run ADD COLUMN IF NOT EXISTS model_profiles TEXT;
