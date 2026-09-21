-- Existing votes did not capture this metadata. Leave it unknown rather than
-- attributing today's consent terms to historical records.
ALTER TABLE model_feedback ADD COLUMN training_consent_purpose TEXT;
ALTER TABLE model_feedback ADD COLUMN training_consent_version INTEGER CHECK (training_consent_version > 0);
