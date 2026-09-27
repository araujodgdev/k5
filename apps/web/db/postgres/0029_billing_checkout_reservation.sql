-- Commit the creation identity before contacting the payment provider. An uncertain
-- POST is recovered by externalId, never automatically submitted a second time.
CREATE TABLE billing_checkout_reservation (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  actor_user_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('ONE_TIME','SUBSCRIPTION')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  product_id TEXT,
  state TEXT NOT NULL CHECK (state IN ('PREPARING','CREATING','COMPLETED','FAILED')),
  owner_token TEXT NOT NULL,
  lease_until TIMESTAMPTZ NOT NULL,
  checkout_id TEXT REFERENCES billing_checkout(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX billing_checkout_reservation_inflight ON billing_checkout_reservation(office_id)
  WHERE state IN ('PREPARING','CREATING');

-- Old actions may already have reached the provider. Never replay them on upgrade.
ALTER TABLE billing_action ADD COLUMN dispatched_at TIMESTAMPTZ;
UPDATE billing_action SET dispatched_at=created_at;
