CREATE TABLE legal_calculation (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL REFERENCES office(id),
  created_by TEXT NOT NULL REFERENCES "user"(id),
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  total_cents BIGINT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (office_id, id)
);
CREATE INDEX legal_calculation_owner ON legal_calculation(office_id, created_by, updated_at DESC);
CREATE TABLE legal_calculation_version (
  office_id TEXT NOT NULL,
  calculation_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  title TEXT NOT NULL,
  client_id TEXT,
  case_id TEXT,
  notes TEXT NOT NULL,
  input JSONB NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (office_id, calculation_id, version),
  FOREIGN KEY (office_id, calculation_id) REFERENCES legal_calculation(office_id, id)
);
CREATE TABLE legal_calculation_mutation (
  office_id TEXT NOT NULL REFERENCES office(id),
  user_id TEXT NOT NULL REFERENCES "user"(id),
  idempotency_key TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  response JSONB,
  PRIMARY KEY (office_id, user_id, idempotency_key)
);
CREATE TABLE legal_index_observation (
  series TEXT NOT NULL CHECK (series IN ('ipca','inpc','selic','legal')),
  month TEXT NOT NULL CHECK (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  value TEXT NOT NULL,
  source TEXT NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (series, month)
);
ALTER TABLE honorario_agreement ADD COLUMN pricing JSONB;
