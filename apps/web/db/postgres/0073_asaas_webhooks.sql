-- The webhook the Lume registers in the connected Asaas account. Asaas sends the token back in the
-- `asaas-access-token` header; only its SHA-256 is kept, which is enough to find the office.
ALTER TABLE asaas_connection
  ADD COLUMN webhook_id TEXT CHECK (webhook_id IS NULL OR length(webhook_id) BETWEEN 1 AND 100),
  ADD COLUMN webhook_token_hash TEXT UNIQUE,
  ADD COLUMN webhook_state TEXT NOT NULL DEFAULT 'unavailable' CHECK (webhook_state IN ('active', 'unavailable', 'failed')),
  ADD COLUMN webhook_error TEXT CHECK (webhook_error IS NULL OR length(webhook_error) <= 500),
  ADD CONSTRAINT asaas_webhook_pair CHECK ((webhook_id IS NULL) = (webhook_token_hash IS NULL)),
  ADD CONSTRAINT asaas_webhook_active CHECK (webhook_state <> 'active' OR webhook_id IS NOT NULL);

-- Delivered events, kept to skip the repeats Asaas may send (at-least-once delivery).
CREATE TABLE asaas_webhook_event (
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  id TEXT NOT NULL CHECK (length(id) BETWEEN 1 AND 200),
  event TEXT NOT NULL CHECK (length(event) <= 80),
  provider_payment_id TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (office_id, id)
);
CREATE INDEX asaas_webhook_event_received ON asaas_webhook_event(received_at);

-- The receipt a confirmed payment created, and a note when it could not be recorded as paid.
ALTER TABLE asaas_payment
  ADD COLUMN receipt_id TEXT,
  ADD COLUMN review TEXT CHECK (review IS NULL OR length(review) <= 500),
  ADD CONSTRAINT asaas_payment_receipt FOREIGN KEY (office_id, receipt_id) REFERENCES honorario_receipt(office_id, id);

ALTER TABLE honorario_receipt DROP CONSTRAINT honorario_receipt_method_check;
ALTER TABLE honorario_receipt ADD CONSTRAINT honorario_receipt_method_check CHECK (method IN ('pix', 'transfer', 'cash', 'card', 'boleto', 'other'));
