-- TJDFT's `versao` can be an opaque revision such as "1", not an instant.
-- Preserve the same upstream identity in the judgment and every material version.
ALTER TABLE research_judgment ALTER COLUMN source_updated_at TYPE TEXT USING source_updated_at::text;
ALTER TABLE research_material ALTER COLUMN source_updated_at TYPE TEXT USING source_updated_at::text;
ALTER TABLE research_material_version ALTER COLUMN source_updated_at TYPE TEXT USING source_updated_at::text;
