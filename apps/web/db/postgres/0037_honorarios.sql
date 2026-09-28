CREATE TABLE honorario_agreement (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL REFERENCES office(id),
  client_id TEXT NOT NULL,
  case_id TEXT,
  case_office_id TEXT REFERENCES office(id),
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 2 AND 180),
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL REFERENCES "user"(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cancelled_at TIMESTAMPTZ,
  cancelled_by TEXT REFERENCES "user"(id),
  cancel_reason TEXT,
  UNIQUE (office_id, id),
  FOREIGN KEY (office_id, client_id) REFERENCES crm_client(office_id, id),
  FOREIGN KEY (case_office_id, case_id) REFERENCES vault_case(office_id, id),
  CHECK ((case_id IS NULL) = (case_office_id IS NULL)),
  CHECK ((cancelled_at IS NULL AND cancelled_by IS NULL AND cancel_reason IS NULL)
    OR (cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL AND cancel_reason IS NOT NULL AND length(trim(cancel_reason)) BETWEEN 3 AND 1000))
);

CREATE TABLE honorario_installment (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL REFERENCES office(id),
  agreement_id TEXT NOT NULL,
  number INTEGER NOT NULL CHECK (number BETWEEN 1 AND 120),
  due_on DATE NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents BETWEEN 1 AND 99999999999),
  UNIQUE (office_id, id),
  UNIQUE (office_id, agreement_id, number),
  FOREIGN KEY (office_id, agreement_id) REFERENCES honorario_agreement(office_id, id)
);
CREATE INDEX honorario_installment_due ON honorario_installment(office_id, due_on, id);
CREATE INDEX honorario_agreement_client ON honorario_agreement(office_id, client_id);
CREATE INDEX honorario_agreement_case ON honorario_agreement(office_id, case_id) WHERE case_id IS NOT NULL;

CREATE TABLE honorario_receipt (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL REFERENCES office(id),
  installment_id TEXT NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents BETWEEN 1 AND 99999999999),
  received_on DATE NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('pix', 'transfer', 'cash', 'card', 'other')),
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL REFERENCES "user"(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (office_id, id),
  FOREIGN KEY (office_id, installment_id) REFERENCES honorario_installment(office_id, id)
);
CREATE INDEX honorario_receipt_installment ON honorario_receipt(office_id, installment_id);

CREATE TABLE honorario_receipt_reversal (
  office_id TEXT NOT NULL REFERENCES office(id),
  receipt_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 1000),
  created_by TEXT NOT NULL REFERENCES "user"(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (office_id, receipt_id),
  FOREIGN KEY (office_id, receipt_id) REFERENCES honorario_receipt(office_id, id)
);

CREATE TABLE honorario_mutation (
  office_id TEXT NOT NULL REFERENCES office(id),
  user_id TEXT NOT NULL REFERENCES "user"(id),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  operation TEXT NOT NULL CHECK (operation IN ('create', 'receive', 'reverse', 'cancel')),
  input_hash TEXT NOT NULL,
  response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (office_id, user_id, idempotency_key)
);
