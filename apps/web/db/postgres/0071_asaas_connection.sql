-- The office's own Asaas account. The API key is encrypted with K5_CREDENTIALS_KEY and never returned;
-- the wallet identifies the account, so one Asaas account serves a single office.
CREATE TABLE asaas_connection (
  office_id TEXT PRIMARY KEY REFERENCES office(id) ON DELETE CASCADE,
  environment TEXT NOT NULL CHECK (environment IN ('sandbox', 'production')),
  wallet_id TEXT NOT NULL UNIQUE CHECK (length(wallet_id) BETWEEN 1 AND 100),
  encrypted_api_key TEXT NOT NULL,
  account_json TEXT NOT NULL,
  version TEXT NOT NULL,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE asaas_connection_audit (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  actor_user_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN ('connected', 'verified', 'disconnected')),
  wallet_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX asaas_connection_audit_office ON asaas_connection_audit(office_id, created_at DESC);
