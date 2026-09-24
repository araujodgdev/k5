-- The feedback dialog offers a third choice, "Não entendi algo". It is recorded as the person's own
-- words ('question'), the same value the triage already uses for doubts.
ALTER TABLE feedback_ticket DROP CONSTRAINT feedback_ticket_reported_kind_check;
ALTER TABLE feedback_ticket ADD CONSTRAINT feedback_ticket_reported_kind_check
  CHECK (reported_kind IN ('problem','suggestion','question'));
