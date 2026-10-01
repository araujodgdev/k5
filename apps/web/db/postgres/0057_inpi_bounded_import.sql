-- Checkpoints and budgets are durable even when a worker/container disappears.
ALTER TABLE inpi_import ADD COLUMN identity TEXT;
CREATE UNIQUE INDEX inpi_import_identity ON inpi_import(identity) WHERE identity IS NOT NULL;
ALTER TABLE inpi_import ADD COLUMN phase TEXT NOT NULL DEFAULT 'download'
  CHECK (phase IN ('download','build','carry','publish','done','invalidated'));
ALTER TABLE inpi_import ADD COLUMN next_bucket INTEGER NOT NULL DEFAULT 0;
ALTER TABLE inpi_import ADD COLUMN carry_after TEXT NOT NULL DEFAULT '';
ALTER TABLE inpi_import ADD COLUMN wal_start PG_LSN;
ALTER TABLE inpi_import ADD COLUMN elapsed_ms BIGINT NOT NULL DEFAULT 0;
-- Legacy runs have no CSV-boundary checkpoints. Preserve published metadata and
-- retire only unfinished staging so it is cleaned before admitting a new run.
UPDATE inpi_import SET phase='done' WHERE kind='baseline' AND state='completed';
UPDATE inpi_import SET phase='invalidated',state='failed',error='Carga anterior sem checkpoints de registros. Intermediários serão limpos antes de uma nova carga.'
  WHERE kind='baseline' AND state<>'completed';

ALTER TABLE inpi_sync ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE inpi_sync ADD COLUMN suspended BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE inpi_sync ADD COLUMN failure_code TEXT;
ALTER TABLE inpi_sync ADD COLUMN resume_condition TEXT;
-- Must be provisioned after a full-volume measurement; no implicit 10 GB assumption.
ALTER TABLE inpi_sync ADD COLUMN capacity JSONB;

CREATE TABLE inpi_file_checkpoint (
  import_id TEXT NOT NULL REFERENCES inpi_import(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  byte_offset BIGINT NOT NULL DEFAULT 0,
  records BIGINT NOT NULL DEFAULT 0,
  rejected BIGINT NOT NULL DEFAULT 0,
  ordinal INTEGER NOT NULL DEFAULT 0,
  headers JSONB,
  complete BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY(import_id,source)
);

ALTER TABLE inpi_staging_object DROP CONSTRAINT inpi_staging_object_bucket_check;
ALTER TABLE inpi_staging_object ADD CHECK (bucket BETWEEN 0 AND 511);
ALTER TABLE inpi_staging_object ADD COLUMN byte_size BIGINT NOT NULL DEFAULT 0;
ALTER TABLE inpi_staging_object ADD COLUMN row_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE inpi_staging_object ADD COLUMN ready BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE inpi_staging_object ADD COLUMN put_started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Event history survives an atomic replacement of the corpus table. The importer
-- carries every existing process forward; RPI inserts the process before its events.
ALTER TABLE inpi_trademark_event DROP CONSTRAINT inpi_trademark_event_process_number_fkey;

CREATE TABLE integration_circuit (
  id INTEGER PRIMARY KEY CHECK (id=1),
  probe_after TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO integration_circuit(id) VALUES(1);
