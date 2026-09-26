-- The office's monthly plan, paid through AbacatePay's hosted checkout. Each payment is a one-time
-- checkout that adds one month to `paid_until`; nothing is blocked while unpaid yet, the status is
-- only shown. `billing_checkout.id` is AbacatePay's bill id, so a webhook and a return from the
-- checkout page settle the same row, and the PENDING -> PAID transition credits the month once.
CREATE TABLE "office_billing" (
  office_id TEXT PRIMARY KEY,
  customer_id TEXT,
  paid_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE "office_billing" ADD FOREIGN KEY ("office_id") REFERENCES "office" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

CREATE TABLE "billing_checkout" (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL,
  -- Who opened the checkout; kept when the person leaves the office.
  user_id TEXT,
  product_id TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PAID','EXPIRED','CANCELLED','REFUNDED')),
  url TEXT NOT NULL,
  receipt_url TEXT,
  dev_mode BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_at TIMESTAMPTZ,
  -- The paid month, recorded when the payment is credited, so a refund removes exactly that month.
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ
);
CREATE INDEX billing_checkout_office ON billing_checkout(office_id, created_at DESC);
ALTER TABLE "billing_checkout" ADD FOREIGN KEY ("office_id") REFERENCES "office" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "billing_checkout" ADD FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

-- Webhook deliveries already handled. AbacatePay retries with the same id.
CREATE TABLE "billing_event" (
  id TEXT PRIMARY KEY,
  event TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
