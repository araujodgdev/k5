CREATE TABLE IF NOT EXISTS platform_admin (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  granted_by_user_id TEXT REFERENCES user(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ai_connection (
  id TEXT PRIMARY KEY NOT NULL,
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 80),
  provider TEXT NOT NULL CHECK (provider IN ('openai', 'anthropic', 'google')),
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

CREATE INDEX IF NOT EXISTS ai_connection_office_idx
  ON ai_connection(office_id, deleted_at);

CREATE TABLE IF NOT EXISTS platform_audit_log (
  id TEXT PRIMARY KEY NOT NULL,
  actor_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE RESTRICT,
  office_id TEXT REFERENCES office(id) ON DELETE SET NULL,
  connection_id TEXT,
  action TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS platform_audit_actor_idx
  ON platform_audit_log(actor_user_id, created_at);
CREATE INDEX IF NOT EXISTS platform_audit_office_idx
  ON platform_audit_log(office_id, created_at);
