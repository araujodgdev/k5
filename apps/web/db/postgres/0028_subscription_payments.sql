-- AbacatePay can produce more than one subscription from the same shared checkout link.
-- Attribute the initial checkout to its first subscription, and identify additional payments
-- separately so every paid subscription credits a month without duplicating return-page credit.
ALTER TABLE billing_checkout ADD COLUMN subscription_id TEXT REFERENCES billing_subscription(provider_id);
ALTER TABLE billing_checkout ADD COLUMN payment_id TEXT UNIQUE;
