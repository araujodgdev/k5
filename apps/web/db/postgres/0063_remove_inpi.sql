-- The INPI corpus and its importer were removed; trademark searches run only on the WIPO Global
-- Brand Database. Searches made on the corpus go with it (their results and tasks cascade).
DELETE FROM research_trademark_search WHERE provider = 'inpi';
ALTER TABLE research_trademark_search DROP COLUMN provider, DROP COLUMN corpus_json, DROP COLUMN analysis_json;

DROP TABLE IF EXISTS inpi_trademark_event, inpi_trademark, inpi_trademark_candidate, inpi_trademark_previous,
  inpi_vienna_term, inpi_vienna_candidate, inpi_vienna_previous,
  inpi_file_checkpoint, inpi_staging_object, inpi_import, inpi_sync;
