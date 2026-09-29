ALTER TABLE vault_deletion_queue ADD COLUMN updated_at TIMESTAMPTZ;
UPDATE vault_deletion_queue SET updated_at = created_at;
ALTER TABLE vault_deletion_queue ALTER COLUMN updated_at SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE vault_deletion_queue ALTER COLUMN updated_at SET NOT NULL;

CREATE FUNCTION vault_deletion_queue_progress() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.attempts IS DISTINCT FROM OLD.attempts OR NEW.completed_at IS DISTINCT FROM OLD.completed_at THEN
    NEW.updated_at = CURRENT_TIMESTAMP;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER vault_deletion_queue_progress
  BEFORE UPDATE OF attempts, completed_at ON vault_deletion_queue
  FOR EACH ROW EXECUTE FUNCTION vault_deletion_queue_progress();
