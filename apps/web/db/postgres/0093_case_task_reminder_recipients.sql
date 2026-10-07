DO $$ DECLARE item RECORD; BEGIN
  FOR item IN SELECT conname FROM pg_constraint WHERE conrelid='notification_reminder'::regclass
    AND contype='f' AND confrelid='office_member'::regclass LOOP
    EXECUTE format('ALTER TABLE notification_reminder DROP CONSTRAINT %I',item.conname);
  END LOOP;
END $$;
ALTER TABLE notification_reminder ADD FOREIGN KEY(user_id) REFERENCES "user"(id) ON DELETE CASCADE;
