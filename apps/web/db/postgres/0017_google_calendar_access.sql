-- Calendar supports editing ordinary events without exposing private event details.
ALTER TABLE google_calendar DROP CONSTRAINT google_calendar_access_role_check;
ALTER TABLE google_calendar ADD CONSTRAINT google_calendar_access_role_check
  CHECK (access_role IN ('freeBusyReader','reader','writerWithoutPrivateAccess','writer','owner'));
ALTER TABLE personal_event ADD COLUMN visibility TEXT NOT NULL DEFAULT 'default'
  CHECK (visibility IN ('default','public','private','confidential'));
