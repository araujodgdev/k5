ALTER TABLE "user" ADD COLUMN "accountKind" TEXT NOT NULL DEFAULT 'office' CHECK("accountKind" IN ('office','client'));
CREATE TABLE client_portal_access (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL REFERENCES office(id),
  client_id TEXT NOT NULL,
  email TEXT NOT NULL,
  user_id TEXT REFERENCES "user"(id),
  token_hash TEXT UNIQUE,
  expires_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  invited_by TEXT NOT NULL REFERENCES "user"(id),
  version BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(office_id,client_id), UNIQUE(office_id,id),
  FOREIGN KEY(office_id,client_id) REFERENCES crm_client(office_id,id)
);
CREATE INDEX client_portal_access_user ON client_portal_access(user_id) WHERE revoked_at IS NULL;
CREATE TABLE client_portal_file (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('published','upload','proof')),
  installment_id TEXT,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 255),
  mime_type TEXT NOT NULL,
  byte_size BIGINT NOT NULL CHECK(byte_size BETWEEN 1 AND 20000000),
  storage_key TEXT NOT NULL UNIQUE,
  sha256 TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES "user"(id),
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TIMESTAMPTZ,
  UNIQUE(office_id,id), UNIQUE(office_id,client_id,created_by,idempotency_key),
  FOREIGN KEY(office_id,client_id) REFERENCES crm_client(office_id,id),
  FOREIGN KEY(office_id,installment_id) REFERENCES honorario_installment(office_id,id),
  CHECK((kind='proof') = (installment_id IS NOT NULL))
);
CREATE INDEX client_portal_file_client ON client_portal_file(office_id,client_id,created_at DESC);
CREATE TABLE client_portal_charge (
  office_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  installment_id TEXT NOT NULL,
  published_by TEXT NOT NULL REFERENCES "user"(id),
  published_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(office_id,installment_id),
  FOREIGN KEY(office_id,client_id) REFERENCES crm_client(office_id,id),
  FOREIGN KEY(office_id,installment_id) REFERENCES honorario_installment(office_id,id)
);
