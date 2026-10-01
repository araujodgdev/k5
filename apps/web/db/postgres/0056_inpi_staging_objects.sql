-- Recoverable INPI scratch data lives in object storage, outside the corpus database.
CREATE TABLE inpi_staging_object (
  storage_key TEXT PRIMARY KEY,
  import_id TEXT NOT NULL REFERENCES inpi_import(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('inpi_stage_bib','inpi_stage_nice','inpi_stage_vienna','inpi_stage_owner')),
  bucket INTEGER NOT NULL CHECK (bucket BETWEEN 0 AND 31),
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  UNIQUE(import_id,source,bucket,ordinal)
);
