CREATE TABLE research_trademark_upload (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL REFERENCES office(id),
  user_id TEXT NOT NULL REFERENCES "user"(id),
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/png','image/jpeg','image/webp')),
  storage_key TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 5242880),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE research_trademark_search (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL REFERENCES office(id),
  user_id TEXT NOT NULL REFERENCES "user"(id),
  session_id TEXT,
  input_json JSONB NOT NULL,
  title TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','running','completed','partial','blocked','failed','cancelled')),
  step TEXT NOT NULL DEFAULT 'Aguardando consulta',
  error TEXT,
  total_reported INTEGER,
  pages_loaded INTEGER NOT NULL DEFAULT 0,
  has_more BOOLEAN NOT NULL DEFAULT FALSE,
  source_url TEXT,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (office_id,user_id,idempotency_key)
);

CREATE TABLE research_trademark_result (
  id TEXT PRIMARY KEY,
  search_id TEXT NOT NULL REFERENCES research_trademark_search(id) ON DELETE CASCADE,
  native_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  summary_json JSONB NOT NULL,
  fields_json JSONB NOT NULL DEFAULT '[]',
  version TEXT NOT NULL,
  detail_state TEXT NOT NULL DEFAULT 'pending' CHECK (detail_state IN ('pending','ready','failed','blocked')),
  detail_error TEXT,
  logo_storage_key TEXT,
  logo_mime_type TEXT,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (search_id,native_id)
);

CREATE TABLE research_trademark_task (
  id TEXT PRIMARY KEY,
  search_id TEXT NOT NULL REFERENCES research_trademark_search(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('page','detail')),
  page_number INTEGER,
  result_id TEXT REFERENCES research_trademark_result(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','running','completed','failed','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_owner TEXT,
  lease_until TIMESTAMPTZ,
  run_after TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((kind='page' AND page_number IS NOT NULL AND result_id IS NULL) OR (kind='detail' AND page_number IS NULL AND result_id IS NOT NULL)),
  CHECK ((lease_owner IS NULL) = (lease_until IS NULL))
);
CREATE UNIQUE INDEX research_trademark_task_page ON research_trademark_task(search_id,page_number) WHERE kind='page';
CREATE UNIQUE INDEX research_trademark_task_detail ON research_trademark_task(result_id) WHERE kind='detail';
CREATE INDEX research_trademark_search_history ON research_trademark_search(office_id,user_id,created_at DESC);
CREATE INDEX research_trademark_task_pending ON research_trademark_task(state,run_after,lease_until);
