ALTER TABLE vault_document_version ADD COLUMN independent_upload_by TEXT REFERENCES "user"(id);
ALTER TABLE vault_document_share ADD COLUMN access_policy JSONB;
ALTER TABLE vault_document_share ADD COLUMN disclosure_policy JSONB;

ALTER TABLE research_case_profile ADD COLUMN content_parts JSONB;
ALTER TABLE research_case_profile_revision ADD COLUMN content_parts JSONB;
ALTER TABLE research_case_reference ADD COLUMN notes_policy JSONB;
ALTER TABLE research_case_reference ADD COLUMN notes_receipt JSONB;
ALTER TABLE research_case_assessment ADD COLUMN input_snapshot JSONB;
ALTER TABLE research_case_assessment ADD COLUMN content_policy JSONB;
ALTER TABLE research_case_assessment ADD COLUMN authority_json JSONB;
ALTER TABLE research_case_assessment ADD COLUMN execution_key TEXT;
DO $$
DECLARE item RECORD;
BEGIN
  FOR item IN SELECT conname FROM pg_constraint
    WHERE conrelid='research_case_assessment'::regclass AND contype='u'
      AND pg_get_constraintdef(oid)='UNIQUE (office_id, case_id, material_version_id, input_fingerprint)'
  LOOP
    EXECUTE format('ALTER TABLE research_case_assessment DROP CONSTRAINT %I', item.conname);
  END LOOP;
END $$;
CREATE UNIQUE INDEX research_assessment_execution ON research_case_assessment(office_id,requested_by,execution_key) WHERE execution_key IS NOT NULL;
