ALTER TABLE model_feedback ADD COLUMN training_consent INTEGER NOT NULL DEFAULT 0 CHECK (training_consent IN (0, 1));
ALTER TABLE model_feedback ADD COLUMN rubric_version TEXT NOT NULL DEFAULT 'legal-artifacts-v1';
ALTER TABLE model_feedback ADD COLUMN prior_exposure INTEGER NOT NULL DEFAULT 0 CHECK (prior_exposure IN (0, 1));
