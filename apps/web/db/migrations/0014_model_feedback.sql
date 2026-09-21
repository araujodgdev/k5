CREATE TABLE model_feedback (
  id TEXT PRIMARY KEY NOT NULL,
  campaign_id TEXT NOT NULL,
  office_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  model_a TEXT NOT NULL,
  model_b TEXT NOT NULL,
  preference TEXT NOT NULL CHECK (preference IN ('a', 'b', 'tie', 'neither', 'unsure')),
  preferred_model TEXT,
  assessment_a TEXT NOT NULL,
  assessment_b TEXT NOT NULL,
  comment TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (office_id, user_id) REFERENCES office_member(office_id, user_id) ON DELETE CASCADE,
  UNIQUE (campaign_id, office_id, user_id)
);
CREATE INDEX model_feedback_campaign_idx ON model_feedback(campaign_id, created_at);
