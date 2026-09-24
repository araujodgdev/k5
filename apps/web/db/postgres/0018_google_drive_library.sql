-- Drive copies can target the case-free library. Gmail attachments still require a case in the service.
ALTER TABLE google_drive_import ALTER COLUMN case_id DROP NOT NULL;
ALTER TABLE google_drive_import ADD COLUMN scope TEXT NOT NULL DEFAULT 'case'
  CHECK (scope IN ('case', 'library'));
ALTER TABLE google_drive_import ADD CONSTRAINT google_drive_import_destination_check
  CHECK ((scope = 'case' AND case_id IS NOT NULL) OR
         (scope = 'library' AND case_id IS NULL AND folder_id IS NULL));
CREATE INDEX google_drive_import_destination ON google_drive_import
  (office_id, user_id, scope, case_id, created_at DESC);
