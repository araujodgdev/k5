CREATE TABLE vault_agent_origin (
  document_id TEXT PRIMARY KEY REFERENCES vault_document(id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('chat_attachment', 'artifact_pdf')),
  source_id TEXT NOT NULL,
  source_version INTEGER,
  user_id TEXT NOT NULL REFERENCES "user"(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE artifact_human_review (
  artifact_id TEXT NOT NULL REFERENCES ai_artifact(id) ON DELETE CASCADE,
  artifact_version INTEGER NOT NULL,
  item_key TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('pending', 'confirmed', 'needs_adjustment')),
  note TEXT NOT NULL DEFAULT '',
  user_id TEXT NOT NULL REFERENCES "user"(id),
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (artifact_id, artifact_version, item_key)
);
