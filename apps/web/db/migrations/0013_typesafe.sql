CREATE TABLE typesafe_connection (
  office_id TEXT PRIMARY KEY REFERENCES office(id) ON DELETE CASCADE,
  encrypted_api_key TEXT, key_hint TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT 'jev-1.13.0', enabled INTEGER NOT NULL DEFAULT 0,
  rag_mode TEXT NOT NULL DEFAULT 'off' CHECK(rag_mode IN ('off','shadow','enabled')),
  documents_mode TEXT NOT NULL DEFAULT 'off' CHECK(documents_mode IN ('off','shadow','enabled')),
  agenda_mode TEXT NOT NULL DEFAULT 'off' CHECK(agenda_mode IN ('off','shadow','enabled')),
  daily_tokens INTEGER NOT NULL DEFAULT 500000,
  concurrency INTEGER NOT NULL DEFAULT 4,
  version INTEGER NOT NULL DEFAULT 1,
  failures INTEGER NOT NULL DEFAULT 0, circuit_until INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE typesafe_evaluation (
  id TEXT PRIMARY KEY, office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES user(id) ON DELETE SET NULL,
  purpose TEXT NOT NULL, model TEXT NOT NULL, question_version TEXT NOT NULL,
  fingerprint TEXT NOT NULL, config_version INTEGER NOT NULL,
  status TEXT NOT NULL, reason TEXT, reserved_tokens INTEGER NOT NULL,
  input_tokens INTEGER, output_tokens INTEGER, duration_ms INTEGER,
  started_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, day TEXT NOT NULL
);
CREATE INDEX typesafe_evaluation_budget ON typesafe_evaluation(office_id,day,status,expires_at);
CREATE TABLE artifact_verification (
  id TEXT PRIMARY KEY, office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  artifact_id TEXT NOT NULL REFERENCES ai_artifact(id) ON DELETE CASCADE,
  artifact_version INTEGER NOT NULL, content_hash TEXT NOT NULL,
  source_fingerprint TEXT NOT NULL, units TEXT NOT NULL, results TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'queued', mode TEXT NOT NULL DEFAULT 'enabled',
  model TEXT, question_version TEXT NOT NULL, checked INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL, lease_token TEXT, lease_until INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX artifact_verification_queue ON artifact_verification(status,lease_until);
CREATE INDEX artifact_verification_artifact ON artifact_verification(office_id,user_id,artifact_id,created_at);
CREATE TABLE agenda_proposal (
  id TEXT PRIMARY KEY, office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  message TEXT NOT NULL, reference_at TEXT NOT NULL, time_zone TEXT NOT NULL,
  operation TEXT NOT NULL, payload TEXT NOT NULL, questions TEXT NOT NULL,
  provenance TEXT NOT NULL, evaluation_status TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', version INTEGER NOT NULL DEFAULT 1,
  confirmation_hash TEXT, confirmed_payload TEXT, result TEXT,
  expires_at INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX agenda_proposal_owner ON agenda_proposal(office_id,user_id,status);
ALTER TABLE agenda_activity ADD COLUMN mutation_token TEXT;
