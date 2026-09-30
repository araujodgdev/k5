CREATE TABLE signature_connection (
  office_id TEXT PRIMARY KEY REFERENCES office(id),
  encrypted_api_key TEXT NOT NULL,
  environment TEXT NOT NULL CHECK(environment IN ('sandbox','production')),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  version BIGINT NOT NULL DEFAULT 1,
  updated_by TEXT NOT NULL REFERENCES "user"(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE signature_request (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  access_id TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  recipient_name TEXT NOT NULL,
  method TEXT NOT NULL CHECK(method IN ('email','certificate')),
  environment TEXT NOT NULL CHECK(environment IN ('sandbox','production')),
  state TEXT NOT NULL CHECK(state IN ('creating','uncertain','pending','signed','cancelled')),
  provider_token TEXT,
  encrypted_sign_url TEXT,
  original_sha256 TEXT NOT NULL,
  signed_storage_key TEXT,
  signed_sha256 TEXT,
  signed_at TIMESTAMPTZ,
  requested_by TEXT NOT NULL REFERENCES "user"(id),
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  checked_at TIMESTAMPTZ,
  UNIQUE(office_id,file_id), UNIQUE(office_id,id), UNIQUE(office_id,requested_by,idempotency_key),
  FOREIGN KEY(office_id,client_id) REFERENCES crm_client(office_id,id),
  FOREIGN KEY(office_id,file_id) REFERENCES client_portal_file(office_id,id),
  FOREIGN KEY(office_id,access_id) REFERENCES client_portal_access(office_id,id),
  CHECK((signed_storage_key IS NULL)=(signed_sha256 IS NULL))
);
CREATE TABLE signature_event (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL REFERENCES "user"(id),
  event TEXT NOT NULL CHECK(event IN ('requested','uncertain','connected','checked','archived','cancelled')),
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(office_id,request_id) REFERENCES signature_request(office_id,id)
);
CREATE INDEX signature_event_request ON signature_event(office_id,request_id,created_at);
