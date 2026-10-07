DO $$ DECLARE item RECORD; BEGIN
  FOR item IN SELECT conname FROM pg_constraint WHERE conrelid='notification_recipient'::regclass
    AND contype='f' AND confrelid='notification_event'::regclass LOOP
    EXECUTE format('ALTER TABLE notification_recipient DROP CONSTRAINT %I',item.conname);
  END LOOP;
END $$;
ALTER TABLE notification_recipient ADD FOREIGN KEY(event_id) REFERENCES notification_event(id) ON DELETE CASCADE;

CREATE FUNCTION lume_activity_notification_allowed(activity_id TEXT, viewer_id TEXT, event_type TEXT, source_version BIGINT, data TEXT) RETURNS BOOLEAN
LANGUAGE SQL STABLE AS $$
  SELECT lume_activity_visible(activity_id,viewer_id) AND EXISTS (
    SELECT 1 FROM agenda_activity a WHERE a.id=activity_id AND (
      event_type<>'agenda.activity.assigned' OR a.visibility='personal' OR
      a.assignee_id=viewer_id OR a.created_by=viewer_id OR
      (a.version=source_version AND data::jsonb->>'previousAssigneeId'=viewer_id)
    )
  );
$$;
