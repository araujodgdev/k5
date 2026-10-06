DO $$
DECLARE
  providerConstraints TEXT[];
BEGIN
  SELECT array_agg(conname) INTO providerConstraints FROM pg_constraint
  WHERE conrelid = 'ai_connection'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%provider%openai%';
  IF coalesce(array_length(providerConstraints, 1), 0) <> 1 THEN
    RAISE EXCEPTION 'Expected one provider check on ai_connection, found %', coalesce(array_length(providerConstraints, 1), 0);
  END IF;
  EXECUTE format('ALTER TABLE ai_connection DROP CONSTRAINT %I', providerConstraints[1]);
END $$;
ALTER TABLE ai_connection ADD CONSTRAINT ai_connection_provider_check
  CHECK (provider IN ('openai', 'anthropic', 'google', 'deepseek', 'inception', 'openrouter', 'vercel', 'cliproxyapi'));

ALTER TABLE ai_conversation ADD COLUMN run_token TEXT;
CREATE INDEX ai_conversation_running ON ai_conversation(user_id, busy_until) WHERE busy_until > 0;
