-- Free-text feedback becomes a ticket the platform team triages. The A/B pilot (model_feedback)
-- stays untouched as history.
CREATE TABLE feedback_ticket (
  id TEXT PRIMARY KEY,
  number BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  message TEXT NOT NULL CHECK (length(btrim(message)) BETWEEN 3 AND 4000),
  page_path TEXT NOT NULL DEFAULT '' CHECK (length(page_path) <= 300),
  user_agent TEXT NOT NULL DEFAULT '' CHECK (length(user_agent) <= 400),
  attachment_key TEXT,
  attachment_type TEXT CHECK (attachment_type IS NULL OR attachment_type IN ('image/png','image/jpeg','image/webp')),
  attachment_size BIGINT CHECK (attachment_size IS NULL OR attachment_size BETWEEN 1 AND 5242880),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','in_progress','resolved','dismissed')),
  kind TEXT CHECK (kind IN ('problem','suggestion','question','praise','other')),
  module TEXT CHECK (module IN ('lume','cofre','agenda','pesquisa','documentos','notificacoes','conta','instalacao','nao_identificado')),
  severity DOUBLE PRECISION CHECK (severity IS NULL OR severity BETWEEN 0 AND 3),
  priority TEXT NOT NULL DEFAULT 'p2' CHECK (priority IN ('p0','p1','p2','p3')),
  security_flag BOOLEAN NOT NULL DEFAULT false,
  personal_data_flag BOOLEAN NOT NULL DEFAULT false,
  needs_review BOOLEAN NOT NULL DEFAULT false,
  classification_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (classification_status IN ('pending','running','classified','disabled','unavailable')),
  classified_by TEXT CHECK (classified_by IN ('model','admin')),
  -- Raw typed answers, question version and evaluation id. Admin corrections never overwrite it.
  classification_json TEXT CHECK (classification_json IS NULL OR (classification_json IS JSON)),
  attempts BIGINT NOT NULL DEFAULT 0,
  lease_token TEXT,
  lease_until BIGINT NOT NULL DEFAULT 0,
  resolution_note TEXT NOT NULL DEFAULT '' CHECK (length(resolution_note) <= 2000),
  version BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMPTZ
);
CREATE INDEX feedback_ticket_queue ON feedback_ticket(status, priority, created_at DESC);
CREATE INDEX feedback_ticket_triage ON feedback_ticket(classification_status, lease_until, created_at)
  WHERE classification_status IN ('pending','running');
CREATE INDEX feedback_ticket_author ON feedback_ticket(office_id, user_id, created_at DESC);

CREATE TABLE feedback_ticket_event (
  id TEXT PRIMARY KEY,
  -- Events written in one transaction share created_at; the sequence keeps their order.
  seq BIGINT GENERATED ALWAYS AS IDENTITY,
  ticket_id TEXT NOT NULL REFERENCES feedback_ticket(id) ON DELETE CASCADE,
  actor_user_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('created','classified','reclassified','status_changed','note')),
  details_json TEXT NOT NULL DEFAULT '{}' CHECK ((details_json IS JSON)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX feedback_ticket_event_ticket ON feedback_ticket_event(ticket_id, seq);
