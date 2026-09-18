CREATE TABLE IF NOT EXISTS ai_conversation (
 id TEXT PRIMARY KEY, office_id TEXT NOT NULL REFERENCES office(id), user_id TEXT NOT NULL REFERENCES user(id),
 title TEXT NOT NULL, messages TEXT NOT NULL DEFAULT '[]', busy_until INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ai_conversation_owner ON ai_conversation(office_id,user_id);
CREATE TABLE IF NOT EXISTS ai_run (
 id TEXT PRIMARY KEY, office_id TEXT NOT NULL REFERENCES office(id), user_id TEXT NOT NULL REFERENCES user(id),
 kind TEXT NOT NULL CHECK(kind IN ('chronology','draft')), input TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','completed','failed','cancelled')),
 progress INTEGER NOT NULL DEFAULT 0, error TEXT, artifact_id TEXT,
 lease_until INTEGER NOT NULL DEFAULT 0, lease_token TEXT, attempts INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ai_run_queue ON ai_run(status,lease_until);
CREATE TABLE IF NOT EXISTS ai_checkpoint (
 run_id TEXT NOT NULL REFERENCES ai_run(id) ON DELETE CASCADE, step_key TEXT NOT NULL, result TEXT NOT NULL,
 PRIMARY KEY(run_id,step_key)
);
CREATE TABLE IF NOT EXISTS ai_artifact (
 id TEXT PRIMARY KEY, office_id TEXT NOT NULL REFERENCES office(id), user_id TEXT NOT NULL REFERENCES user(id),
 run_id TEXT NOT NULL UNIQUE REFERENCES ai_run(id), title TEXT NOT NULL, content TEXT NOT NULL,
 source_refs TEXT NOT NULL DEFAULT '[]', validation_issues TEXT NOT NULL DEFAULT '[]',
 status TEXT NOT NULL DEFAULT 'draft', version INTEGER NOT NULL DEFAULT 1, template_id TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS ai_artifact_version (
 artifact_id TEXT NOT NULL REFERENCES ai_artifact(id) ON DELETE CASCADE, version INTEGER NOT NULL,
 title TEXT NOT NULL, content TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES user(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(artifact_id,version)
);
CREATE TABLE IF NOT EXISTS ai_usage (
 id TEXT PRIMARY KEY, office_id TEXT NOT NULL REFERENCES office(id), user_id TEXT,
 connection_id TEXT NOT NULL, provider TEXT NOT NULL, model_id TEXT NOT NULL, task TEXT NOT NULL,
 input_tokens INTEGER, output_tokens INTEGER, status TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS ai_citation_approval (
 run_id TEXT NOT NULL REFERENCES ai_run(id) ON DELETE CASCADE, citation_id TEXT NOT NULL,
 source_text TEXT NOT NULL, source_label TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES user(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(run_id,citation_id)
);
