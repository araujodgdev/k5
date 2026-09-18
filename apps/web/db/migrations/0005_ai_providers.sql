-- SQLite cannot alter a CHECK constraint in place, so the table is rebuilt with the wider provider list.
-- The migration runner applies each file once, recorded in schema_migration.
CREATE TABLE ai_connection_next (
  id TEXT PRIMARY KEY NOT NULL,
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 80),
  provider TEXT NOT NULL CHECK (provider IN ('openai', 'anthropic', 'google', 'deepseek', 'inception', 'openrouter', 'vercel')),
  encrypted_api_key TEXT,
  api_key_hint TEXT NOT NULL,
  chat_model TEXT,
  extraction_model TEXT,
  drafting_model TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  CHECK (deleted_at IS NULL OR encrypted_api_key IS NULL),
  UNIQUE (office_id, name)
);

INSERT INTO ai_connection_next
  SELECT id, office_id, name, provider, encrypted_api_key, api_key_hint,
         chat_model, extraction_model, drafting_model, enabled, created_at, updated_at, deleted_at
  FROM ai_connection;

DROP TABLE ai_connection;
ALTER TABLE ai_connection_next RENAME TO ai_connection;

CREATE INDEX IF NOT EXISTS ai_connection_office_idx
  ON ai_connection(office_id, deleted_at);
