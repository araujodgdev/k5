ALTER TABLE agenda_activity DROP CONSTRAINT agenda_activity_status_check;
ALTER TABLE agenda_activity ADD CONSTRAINT agenda_activity_status_check CHECK (status IN ('pending','in_progress','completed','cancelled'));

CREATE TABLE agenda_delegation (
  activity_id TEXT NOT NULL REFERENCES agenda_activity(id) ON DELETE CASCADE,
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES ai_conversation(id) ON DELETE CASCADE,
  PRIMARY KEY (activity_id, user_id)
);

CREATE TABLE google_email_insight_cache (
  connection_id TEXT NOT NULL REFERENCES google_connection(id) ON DELETE CASCADE,
  cache_key TEXT NOT NULL,
  payload JSONB,
  lease_token TEXT,
  lease_until BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (connection_id, cache_key)
);
