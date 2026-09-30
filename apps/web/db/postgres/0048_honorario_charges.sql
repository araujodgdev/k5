CREATE TABLE honorario_charge (
  office_id TEXT NOT NULL,
  installment_id TEXT NOT NULL,
  version BIGINT NOT NULL CHECK(version > 0),
  pix_key TEXT NOT NULL DEFAULT '' CHECK(length(pix_key) <= 140),
  instructions TEXT NOT NULL DEFAULT '' CHECK(length(instructions) <= 2000),
  boleto_document_id TEXT,
  reminders_enabled BOOLEAN NOT NULL DEFAULT true,
  updated_by TEXT NOT NULL REFERENCES "user"(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(office_id,installment_id),
  FOREIGN KEY(office_id,installment_id) REFERENCES honorario_installment(office_id,id) ON DELETE CASCADE,
  FOREIGN KEY(office_id,boleto_document_id) REFERENCES vault_document(office_id,id)
);
CREATE TABLE honorario_charge_event (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL,
  installment_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES "user"(id),
  idempotency_key TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN ('prepare','sent')),
  input_hash TEXT NOT NULL,
  channel TEXT CHECK(channel IN ('whatsapp','email','other')),
  notes TEXT NOT NULL DEFAULT '',
  response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(office_id,user_id,idempotency_key),
  FOREIGN KEY(office_id,installment_id) REFERENCES honorario_installment(office_id,id) ON DELETE CASCADE
);
CREATE INDEX honorario_charge_event_history ON honorario_charge_event(office_id,installment_id,created_at DESC);
ALTER TABLE notification_event DROP CONSTRAINT notification_event_source_kind_check;
ALTER TABLE notification_event ADD CONSTRAINT notification_event_source_kind_check CHECK(source_kind IN (
  'activity','case','document','run','artifact','judicial_alert','system','honorario'
));
