ALTER TABLE notification_event ADD COLUMN projection_failed_at TIMESTAMPTZ;

CREATE FUNCTION notification_projection_failure_time() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.projection_state = 'dead' AND OLD.projection_state IS DISTINCT FROM 'dead' THEN
    NEW.projection_failed_at = CURRENT_TIMESTAMP;
  ELSIF NEW.projection_state <> 'dead' THEN
    NEW.projection_failed_at = NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER notification_projection_failure_time
  BEFORE UPDATE OF projection_state ON notification_event
  FOR EACH ROW EXECUTE FUNCTION notification_projection_failure_time();
