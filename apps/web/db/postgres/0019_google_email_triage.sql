ALTER TABLE typesafe_platform_connection ADD COLUMN email_mode TEXT NOT NULL DEFAULT 'off'
  CHECK (email_mode IN ('off','shadow','enabled'));

-- Only bounded judgments are cached: never message bodies, subjects, senders or snippets.
CREATE TABLE google_email_triage (
  connection_id TEXT NOT NULL REFERENCES google_connection(id) ON DELETE CASCADE,
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  result_json TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(connection_id, thread_id)
);
CREATE INDEX google_email_triage_expiry ON google_email_triage(expires_at);
