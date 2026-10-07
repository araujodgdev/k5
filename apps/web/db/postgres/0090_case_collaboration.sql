ALTER TABLE vault_case ADD COLUMN lume_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE agenda_activity ADD COLUMN visibility TEXT NOT NULL DEFAULT 'personal'
  CHECK (visibility IN ('personal','case'));
ALTER TABLE agenda_activity ADD COLUMN creation_input_hash TEXT;
ALTER TABLE agenda_activity ADD CONSTRAINT agenda_case_task_shape CHECK (
  visibility='personal' OR (case_id IS NOT NULL AND kind='task' AND client_id IS NULL
    AND starts_at IS NULL AND ends_at IS NULL AND creation_input_hash IS NOT NULL)
);
CREATE INDEX agenda_case_tasks ON agenda_activity(case_id,updated_at DESC,id) WHERE visibility='case';

CREATE FUNCTION lume_activity_visible(activity_id TEXT, viewer_id TEXT) RETURNS BOOLEAN
LANGUAGE SQL STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM agenda_activity a WHERE a.id=activity_id AND (
      (a.visibility='personal' AND EXISTS(SELECT 1 FROM office_member m WHERE m.office_id=a.office_id AND m.user_id=viewer_id))
      OR (a.visibility='case' AND EXISTS(SELECT 1 FROM vault_case c WHERE c.id=a.case_id
        AND c.office_id=a.office_id AND c.deleted_at IS NULL AND (
          EXISTS(SELECT 1 FROM office_member m WHERE m.office_id=c.office_id AND m.user_id=viewer_id)
          OR EXISTS(SELECT 1 FROM case_participant p WHERE p.case_id=c.id AND p.office_id=c.office_id
            AND p.user_id=viewer_id AND p.revoked_at IS NULL)
        )))
    )
  );
$$;
