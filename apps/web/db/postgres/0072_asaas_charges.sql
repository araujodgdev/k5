-- The office's clients registered in its Asaas account, one per client and account. The CPF or CNPJ
-- goes to Asaas only; the Lume keeps the customer id.
CREATE TABLE asaas_customer (
  office_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  customer_id TEXT NOT NULL CHECK (length(customer_id) BETWEEN 1 AND 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (office_id, client_id, wallet_id),
  FOREIGN KEY (office_id, client_id) REFERENCES crm_client(office_id, id) ON DELETE CASCADE
);

-- One Asaas charge for one honorário installment. `creating` is written before the request to Asaas;
-- its lease marks the attempt in progress, and an expired lease means the outcome must be confirmed
-- with Asaas (by externalReference = 'lume:' || id) before another attempt.
CREATE TABLE asaas_payment (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  installment_id TEXT NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('sandbox', 'production')),
  wallet_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('creating', 'open', 'paid', 'cancelled', 'refunded', 'failed')),
  provider_payment_id TEXT UNIQUE CHECK (provider_payment_id IS NULL OR length(provider_payment_id) BETWEEN 1 AND 100),
  provider_status TEXT CHECK (provider_status IS NULL OR length(provider_status) <= 60),
  customer_id TEXT NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents BETWEEN 1 AND 99999999999),
  due_on DATE NOT NULL,
  invoice_url TEXT CHECK (invoice_url IS NULL OR (invoice_url LIKE 'https://%' AND length(invoice_url) <= 500)),
  failure TEXT CHECK (failure IS NULL OR length(failure) <= 500),
  lease_until TIMESTAMPTZ,
  created_by TEXT NOT NULL REFERENCES "user"(id),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  input_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (office_id, id),
  UNIQUE (office_id, created_by, idempotency_key),
  FOREIGN KEY (office_id, installment_id) REFERENCES honorario_installment(office_id, id) ON DELETE CASCADE,
  CHECK ((provider_payment_id IS NULL) = (state IN ('creating', 'failed')))
);
CREATE UNIQUE INDEX asaas_payment_active ON asaas_payment(office_id, installment_id) WHERE state IN ('creating', 'open');
CREATE INDEX asaas_payment_installment ON asaas_payment(office_id, installment_id, created_at DESC);
