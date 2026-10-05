CREATE TABLE fee_quote (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL REFERENCES office(id),
  created_by TEXT NOT NULL REFERENCES "user"(id),
  title TEXT NOT NULL,
  client_id TEXT NOT NULL,
  case_id TEXT,
  version INTEGER NOT NULL CHECK (version > 0),
  pricing JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (office_id,id),
  FOREIGN KEY (office_id, client_id) REFERENCES crm_client(office_id,id)
);
CREATE TABLE fee_quote_version (
  office_id TEXT NOT NULL,
  quote_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (office_id,quote_id,version),
  FOREIGN KEY (office_id,quote_id) REFERENCES fee_quote(office_id,id)
);
CREATE TABLE fee_quote_billing (
  office_id TEXT NOT NULL,
  quote_id TEXT NOT NULL,
  component INTEGER NOT NULL,
  agreement_id TEXT NOT NULL,
  amount_cents BIGINT NOT NULL,
  evidence TEXT NOT NULL,
  PRIMARY KEY (office_id,quote_id,component),
  FOREIGN KEY (office_id,quote_id) REFERENCES fee_quote(office_id,id),
  FOREIGN KEY (office_id,agreement_id) REFERENCES honorario_agreement(office_id,id)
);
CREATE TABLE fee_quote_mutation (
  office_id TEXT NOT NULL REFERENCES office(id),
  user_id TEXT NOT NULL REFERENCES "user"(id),
  idempotency_key TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  response JSONB,
  PRIMARY KEY (office_id,user_id,idempotency_key)
);
