ALTER TABLE billing_checkout ADD COLUMN kind TEXT NOT NULL DEFAULT 'ONE_TIME'
  CHECK (kind IN ('ONE_TIME', 'SUBSCRIPTION'));

-- A subscription checkout is not the recurring subscription. Keep both provider IDs.
CREATE TABLE billing_subscription (
  id TEXT PRIMARY KEY,
  checkout_id TEXT NOT NULL REFERENCES billing_checkout(id),
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  provider_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACTIVE','CANCELLED','EXPIRED')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  dev_mode BOOLEAN NOT NULL,
  last_event_at TIMESTAMPTZ,
  payment_failed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX billing_subscription_office ON billing_subscription(office_id);
ALTER TABLE billing_checkout ADD COLUMN subscription_checkout_id TEXT REFERENCES billing_checkout(id);

-- Persist a request before sending an irreversible provider operation. Uncertain requests cannot
-- be sent twice: reconciliation must confirm their result first.
CREATE TABLE billing_action (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  actor_user_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  target_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('refund','cancel')),
  status TEXT NOT NULL CHECK (status IN ('REQUESTED','SUCCEEDED','FAILED','UNCERTAIN')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX billing_action_inflight ON billing_action(target_id,action) WHERE status <> 'FAILED';
