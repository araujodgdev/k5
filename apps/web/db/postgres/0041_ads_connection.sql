CREATE TABLE ads_connection (
  office_id TEXT PRIMARY KEY REFERENCES office(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL UNIQUE,
  encrypted_api_key TEXT NOT NULL,
  account_json TEXT NOT NULL,
  version TEXT NOT NULL,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ads_connection_audit (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  actor_user_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN ('connected', 'verified', 'disconnected')),
  account_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ads_connection_audit_office ON ads_connection_audit(office_id, created_at DESC);
