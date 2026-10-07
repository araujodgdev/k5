-- 0081 already ran in the disposable instance. Preserve approval states while its
-- immutable upgrade runs on databases containing legacy submissions; 0082 removes this guard.
CREATE FUNCTION lume_capture_upgrade_preserve_approval() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status='cancelled' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER capture_upgrade_preserve_approval BEFORE UPDATE OF status ON capability_approval
FOR EACH ROW EXECUTE FUNCTION lume_capture_upgrade_preserve_approval();
