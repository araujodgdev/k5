ALTER TABLE agenda_activity ADD COLUMN content_policy JSONB;
CREATE OR REPLACE FUNCTION lume_activity_visible(activity_id TEXT, viewer_id TEXT) RETURNS BOOLEAN
LANGUAGE SQL STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM agenda_activity a WHERE a.id=activity_id AND (
      (a.visibility='personal' AND EXISTS(SELECT 1 FROM office_member m WHERE m.office_id=a.office_id AND m.user_id=viewer_id))
      OR (a.visibility='case' AND EXISTS(SELECT 1 FROM vault_case c WHERE c.id=a.case_id
        AND c.office_id=a.office_id AND c.deleted_at IS NULL AND (
          EXISTS(SELECT 1 FROM office_member m WHERE m.office_id=c.office_id AND m.user_id=viewer_id)
          OR EXISTS(SELECT 1 FROM case_participant p WHERE p.case_id=c.id AND p.office_id=c.office_id
            AND p.user_id=viewer_id AND p.revoked_at IS NULL)
        )) AND (a.content_policy IS NULL OR (
          NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(a.content_policy->'owners') o WHERE o<>viewer_id)
          AND NOT EXISTS(SELECT 1 FROM jsonb_to_recordset(a.content_policy->'guards') AS g(kind TEXT,id TEXT,"caseId" TEXT)
            WHERE NOT lume_resource_visible(g.kind,g.id,g."caseId",viewer_id))
        )))
    )
  );
$$;
