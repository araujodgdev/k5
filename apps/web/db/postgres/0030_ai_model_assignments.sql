-- Tises' models move from one assignment per connection column to one per task (src/lib/ai-tasks.ts).
-- A row configures a group of tasks or a single task; a missing row, or 'inherit', takes the next
-- level up. The model and the reasoning effort are inherited separately. Connections keep only the
-- credential and the embedding model, which stays pinned to the search index.
CREATE TABLE ai_model_assignment (
  scope TEXT NOT NULL CHECK (scope IN ('group', 'task')),
  target TEXT NOT NULL,
  model_mode TEXT NOT NULL DEFAULT 'inherit' CHECK (model_mode IN ('inherit', 'explicit', 'disabled')),
  connection_id TEXT REFERENCES ai_connection(id),
  model_id TEXT CHECK (model_id IS NULL OR length(model_id) BETWEEN 1 AND 160),
  effort_mode TEXT NOT NULL DEFAULT 'inherit' CHECK (effort_mode IN ('inherit', 'provider_default', 'explicit')),
  reasoning_effort TEXT CHECK (reasoning_effort IN ('minimal', 'low', 'medium', 'high', 'xhigh')),
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (scope, target),
  CHECK ((model_mode = 'explicit') = (connection_id IS NOT NULL AND model_id IS NOT NULL)),
  CHECK (model_mode = 'explicit' OR (connection_id IS NULL AND model_id IS NULL)),
  CHECK ((effort_mode = 'explicit') = (reasoning_effort IS NOT NULL))
);
CREATE INDEX ai_model_assignment_connection ON ai_model_assignment(connection_id) WHERE connection_id IS NOT NULL;

-- A queued run keeps the models it was queued with: {"version":1,"tasks":{"<task>":{connectionId,provider,modelId,effort}}}.
ALTER TABLE ai_run ADD COLUMN model_plan JSONB;

-- What served each call, so a model change can be judged on cost, latency and failures.
ALTER TABLE ai_usage
  ADD COLUMN reasoning_effort TEXT,
  ADD COLUMN model_source TEXT,
  ADD COLUMN effort_source TEXT,
  ADD COLUMN duration_ms BIGINT,
  ADD COLUMN error_class TEXT,
  ADD COLUMN signals JSONB;

-- Adoption: every task keeps the connection, model and effort it resolved to before this migration.
-- Efforts: OpenAI requests carried xhigh except the e-mail writer (medium for the digest, low for a
-- conversation) and the injection guard (low); other providers never received an effort, which the
-- resolver reproduces because only providers that accept an effort apply one.
INSERT INTO ai_model_assignment (scope, target, effort_mode, reasoning_effort) VALUES
  ('group', 'agent', 'explicit', 'xhigh'),
  ('group', 'drafting', 'explicit', 'xhigh'),
  ('group', 'extraction', 'explicit', 'xhigh'),
  ('group', 'summary', 'explicit', 'medium'),
  ('group', 'classification', 'explicit', 'low'),
  ('task', 'summary.email_thread', 'explicit', 'low');

-- The conversation: the connection assigned to chat, when it still has its key. Otherwise Tises
-- used the provider default of the first active connection, which is what an unassigned agent
-- group still resolves to.
UPDATE ai_model_assignment a SET model_mode = 'explicit', connection_id = s.id, model_id = s.chat_model
FROM (
  SELECT id, chat_model, encrypted_api_key FROM ai_connection
  WHERE office_id IS NULL AND enabled = 1 AND deleted_at IS NULL AND chat_model IS NOT NULL
  ORDER BY updated_at DESC, id LIMIT 1
) s
WHERE a.scope = 'group' AND a.target = 'agent' AND s.encrypted_api_key IS NOT NULL;

-- Extraction and drafting resolved on their own: their assignment, or the same provider default
-- as an unassigned chat. Inheriting from the agent is only equivalent when chat was unassigned too,
-- so the default is written down when chat had a model of its own.
UPDATE ai_model_assignment a SET model_mode = 'explicit', connection_id = s.id, model_id = s.model
FROM (
  SELECT id, model FROM (
    SELECT 0 AS rank, id, extraction_model AS model FROM (
      SELECT id, extraction_model, encrypted_api_key FROM ai_connection
      WHERE office_id IS NULL AND enabled = 1 AND deleted_at IS NULL AND extraction_model IS NOT NULL
      ORDER BY updated_at DESC, id LIMIT 1
    ) assigned WHERE encrypted_api_key IS NOT NULL
    UNION ALL
    SELECT 1 AS rank, id, CASE provider
      WHEN 'openai' THEN 'gpt-5' WHEN 'anthropic' THEN 'claude-sonnet-4-5' WHEN 'google' THEN 'gemini-2.5-pro'
      WHEN 'deepseek' THEN 'deepseek-v4-pro' WHEN 'inception' THEN 'mercury-2.5'
      ELSE 'anthropic/claude-sonnet-4.5' END AS model FROM (
      SELECT id, provider FROM ai_connection
      WHERE office_id IS NULL AND enabled = 1 AND deleted_at IS NULL AND encrypted_api_key IS NOT NULL
      ORDER BY updated_at DESC, id LIMIT 1
    ) fallback WHERE EXISTS (SELECT 1 FROM ai_model_assignment WHERE scope = 'group' AND target = 'agent' AND model_mode = 'explicit')
  ) candidates ORDER BY rank LIMIT 1
) s
WHERE a.scope = 'group' AND a.target = 'extraction';

UPDATE ai_model_assignment a SET model_mode = 'explicit', connection_id = s.id, model_id = s.model
FROM (
  SELECT id, model FROM (
    SELECT 0 AS rank, id, drafting_model AS model FROM (
      SELECT id, drafting_model, encrypted_api_key FROM ai_connection
      WHERE office_id IS NULL AND enabled = 1 AND deleted_at IS NULL AND drafting_model IS NOT NULL
      ORDER BY updated_at DESC, id LIMIT 1
    ) assigned WHERE encrypted_api_key IS NOT NULL
    UNION ALL
    SELECT 1 AS rank, id, CASE provider
      WHEN 'openai' THEN 'gpt-5' WHEN 'anthropic' THEN 'claude-sonnet-4-5' WHEN 'google' THEN 'gemini-2.5-pro'
      WHEN 'deepseek' THEN 'deepseek-v4-pro' WHEN 'inception' THEN 'mercury-2.5'
      ELSE 'anthropic/claude-sonnet-4.5' END AS model FROM (
      SELECT id, provider FROM ai_connection
      WHERE office_id IS NULL AND enabled = 1 AND deleted_at IS NULL AND encrypted_api_key IS NOT NULL
      ORDER BY updated_at DESC, id LIMIT 1
    ) fallback WHERE EXISTS (SELECT 1 FROM ai_model_assignment WHERE scope = 'group' AND target = 'agent' AND model_mode = 'explicit')
  ) candidates ORDER BY rank LIMIT 1
) s
WHERE a.scope = 'group' AND a.target = 'drafting';

-- The e-mail writer asked for gpt-6-luna on the most recent active OpenAI connection and fell back
-- to extraction when there was none, which is the summary group's parent.
UPDATE ai_model_assignment a SET model_mode = 'explicit', connection_id = s.id, model_id = 'gpt-6-luna'
FROM (
  SELECT id, encrypted_api_key FROM ai_connection
  WHERE office_id IS NULL AND enabled = 1 AND deleted_at IS NULL AND provider = 'openai'
  ORDER BY updated_at DESC, id LIMIT 1
) s
WHERE a.scope = 'group' AND a.target = 'summary' AND s.encrypted_api_key IS NOT NULL;

-- The injection guard used the extraction model, its parent. Transcription has no row: unassigned,
-- it follows the agent's provider exactly as before.
