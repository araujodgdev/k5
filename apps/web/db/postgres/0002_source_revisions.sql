-- An upstream revision is an opaque identity. Preserve the source's exact representation.
ALTER TABLE research_source_resource ALTER COLUMN source_updated_at TYPE TEXT USING source_updated_at::text;
