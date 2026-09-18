-- Server-issued upload references. The client never supplies a storage key: it receives an
-- opaque id bound to one user, one office and one stored object, with an expiry and single use.
CREATE TABLE IF NOT EXISTS vault_upload_ref (
  id TEXT PRIMARY KEY NOT NULL,
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  sha256 TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS vault_upload_ref_owner ON vault_upload_ref(office_id, user_id, expires_at);

-- Physical removal is asynchronous; eligibility in queries is not. A tombstoned document is
-- unreachable the moment it is marked, and this queue only chases the bytes afterwards.
CREATE TABLE IF NOT EXISTS vault_deletion_queue (
  id TEXT PRIMARY KEY NOT NULL,
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('object', 'vector_document')),
  target_ref TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS vault_deletion_queue_pending ON vault_deletion_queue(completed_at, created_at);

-- Durable indexing work. Embeddings are never computed inside a chat request.
CREATE TABLE IF NOT EXISTS knowledge_index_job (
  id TEXT PRIMARY KEY NOT NULL,
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES vault_document(id) ON DELETE CASCADE,
  generation_id TEXT NOT NULL REFERENCES knowledge_index_generation(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  cursor_ordinal INTEGER NOT NULL DEFAULT 0,
  chunks_total INTEGER NOT NULL DEFAULT 0,
  chunks_done INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_owner TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (document_id, generation_id)
);
CREATE INDEX IF NOT EXISTS knowledge_index_job_queue ON knowledge_index_job(status, lease_until);

-- Float32 little-endian blob. JSON text costs ~6x the bytes and a parse per row per query.
ALTER TABLE vault_document_chunk_vector ADD COLUMN embedding_blob BLOB;

-- Pagination and tombstone filtering both read this index instead of scanning the office.
CREATE INDEX IF NOT EXISTS vault_document_live ON vault_document(office_id, deleted_at, created_at DESC);
CREATE INDEX IF NOT EXISTS vault_document_chunk_doc ON vault_document_chunk(office_id, document_id, ordinal);

-- Existing documents get an explicit version 1 so a later version is 2 because one came before it,
-- not because the counter started there. Chunk ids already cited stay resolvable.
INSERT INTO vault_document_version (id, office_id, document_id, version, original_name, stored_name, mime_type, byte_size, sha256, created_by, is_active, created_at)
SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2)
         || '-a' || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
       d.office_id, d.id, 1, d.original_name, d.stored_name, d.mime_type, d.byte_size, d.sha256, d.created_by, 1, d.created_at
FROM vault_document d
WHERE NOT EXISTS (SELECT 1 FROM vault_document_version v WHERE v.document_id = d.id);

-- A provider key reaches the server through a human form and is held here under the master key
-- until a platform tool consumes the reference. The key itself never becomes a tool argument,
-- never enters a prompt and is never returned to a caller.
CREATE TABLE IF NOT EXISTS platform_secret_ref (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('ai_connection_key')),
  encrypted_secret TEXT NOT NULL,
  secret_hint TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS platform_secret_ref_owner ON platform_secret_ref(user_id, expires_at);
