CREATE TABLE IF NOT EXISTS vault_case (
  id TEXT PRIMARY KEY NOT NULL,
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 180),
  created_by TEXT NOT NULL REFERENCES user(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS vault_case_office_idx ON vault_case(office_id, created_at DESC);

CREATE TABLE IF NOT EXISTS vault_document (
  id TEXT PRIMARY KEY NOT NULL,
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  case_id TEXT REFERENCES vault_case(id) ON DELETE SET NULL,
  scope TEXT NOT NULL CHECK (scope IN ('library', 'case')),
  original_name TEXT NOT NULL CHECK (length(original_name) BETWEEN 1 AND 255),
  stored_name TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  sha256 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'ready', 'failed')),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  error_message TEXT,
  extracted_characters INTEGER NOT NULL DEFAULT 0,
  source_count INTEGER NOT NULL DEFAULT 0,
  lease_owner TEXT,
  lease_expires_at TEXT,
  created_by TEXT NOT NULL REFERENCES user(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((scope = 'library' AND case_id IS NULL) OR (scope = 'case' AND case_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS vault_document_office_idx ON vault_document(office_id, created_at DESC);
CREATE INDEX IF NOT EXISTS vault_document_case_idx ON vault_document(office_id, case_id, created_at DESC);
CREATE INDEX IF NOT EXISTS vault_document_queue_idx ON vault_document(status, lease_expires_at, created_at);

CREATE TABLE IF NOT EXISTS vault_document_chunk (
  id TEXT PRIMARY KEY NOT NULL,
  document_id TEXT NOT NULL REFERENCES vault_document(id) ON DELETE CASCADE,
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  stable_reference TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(document_id, ordinal),
  UNIQUE(document_id, stable_reference)
);

CREATE INDEX IF NOT EXISTS vault_document_chunk_document_idx ON vault_document_chunk(document_id, ordinal);
CREATE INDEX IF NOT EXISTS vault_document_chunk_office_idx ON vault_document_chunk(office_id, document_id);

-- OCR pages are checkpointed independently so a leased worker can resume without
-- rendering and recognizing pages that completed before a crash.
CREATE TABLE IF NOT EXISTS vault_document_checkpoint (
  document_id TEXT NOT NULL REFERENCES vault_document(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('ocr')),
  stable_reference TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (document_id, kind, stable_reference)
);

CREATE VIRTUAL TABLE IF NOT EXISTS vault_document_chunk_fts USING fts5(
  content,
  document_id UNINDEXED,
  office_id UNINDEXED,
  chunk_id UNINDEXED,
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS vault_chunk_fts_insert AFTER INSERT ON vault_document_chunk BEGIN
  INSERT INTO vault_document_chunk_fts(rowid, content, document_id, office_id, chunk_id)
  VALUES (new.rowid, new.content, new.document_id, new.office_id, new.id);
END;

CREATE TRIGGER IF NOT EXISTS vault_chunk_fts_delete AFTER DELETE ON vault_document_chunk BEGIN
  DELETE FROM vault_document_chunk_fts WHERE rowid = old.rowid;
END;

CREATE TRIGGER IF NOT EXISTS vault_chunk_fts_update AFTER UPDATE OF content, document_id, office_id, id ON vault_document_chunk BEGIN
  DELETE FROM vault_document_chunk_fts WHERE rowid = old.rowid;
  INSERT INTO vault_document_chunk_fts(rowid, content, document_id, office_id, chunk_id)
  VALUES (new.rowid, new.content, new.document_id, new.office_id, new.id);
END;
