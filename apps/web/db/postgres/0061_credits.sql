-- Credits pay for the office's AI and OCR. One credit is sold at `credit_price_cents`; what it may
-- cost the platform is that price less the margin, taxes and the payment fee, converted at
-- `usd_brl`. Balances are kept in millicredits so a cheap call is charged what it cost.
CREATE TABLE credit_settings (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  credit_price_cents INTEGER NOT NULL CHECK (credit_price_cents > 0),
  margin NUMERIC(5,4) NOT NULL CHECK (margin >= 0 AND margin < 1),
  tax_rate NUMERIC(5,4) NOT NULL CHECK (tax_rate >= 0 AND tax_rate < 1),
  fee_rate NUMERIC(5,4) NOT NULL CHECK (fee_rate >= 0 AND fee_rate < 1),
  usd_brl NUMERIC(10,4) NOT NULL CHECK (usd_brl > 0),
  plan_monthly_credits INTEGER NOT NULL CHECK (plan_monthly_credits >= 0),
  initial_credits INTEGER NOT NULL CHECK (initial_credits >= 0),
  ocr_page_millicredits INTEGER NOT NULL CHECK (ocr_page_millicredits >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (margin + tax_rate + fee_rate < 1)
);
-- 30% margin after 6% tax and a 3% payment fee: a credit sold at R$ 0,10 covers R$ 0,061.
-- The dollar is kept above the market rate (R$ 5,22 on 2026-10-02) to absorb its swings.
INSERT INTO credit_settings (credit_price_cents, margin, tax_rate, fee_rate, usd_brl, plan_monthly_credits, initial_credits, ocr_page_millicredits)
VALUES (10, 0.30, 0.06, 0.03, 5.50, 850, 850, 100);

-- Provider list prices in US$ per million tokens and per web search call. The `*` row prices a
-- model with no row of its own at the most expensive standard rates in use.
CREATE TABLE ai_model_price (
  model_id TEXT PRIMARY KEY,
  input_usd_mtok NUMERIC(12,6) NOT NULL CHECK (input_usd_mtok >= 0),
  cached_input_usd_mtok NUMERIC(12,6) NOT NULL CHECK (cached_input_usd_mtok >= 0),
  cache_write_usd_mtok NUMERIC(12,6) NOT NULL CHECK (cache_write_usd_mtok >= 0),
  output_usd_mtok NUMERIC(12,6) NOT NULL CHECK (output_usd_mtok >= 0),
  web_search_usd_call NUMERIC(12,6) NOT NULL DEFAULT 0 CHECK (web_search_usd_call >= 0),
  -- A call with more input tokens than this is billed at the long-context multipliers.
  long_context_tokens INTEGER CHECK (long_context_tokens > 0),
  long_input_multiplier NUMERIC(6,3) NOT NULL DEFAULT 1 CHECK (long_input_multiplier >= 1),
  long_output_multiplier NUMERIC(6,3) NOT NULL DEFAULT 1 CHECK (long_output_multiplier >= 1),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Official prices read on 2026-10-02 (OpenAI API pricing; Anthropic API pricing).
INSERT INTO ai_model_price (model_id, input_usd_mtok, cached_input_usd_mtok, cache_write_usd_mtok, output_usd_mtok, web_search_usd_call, long_context_tokens, long_input_multiplier, long_output_multiplier) VALUES
  ('gpt-6.1-sol', 2.00, 0.10, 2.50, 10.00, 0.01, 272000, 2, 1.5),
  ('gpt-6-sol', 2.00, 0.20, 2.50, 10.00, 0.01, 272000, 2, 1.5),
  ('gpt-6-luna', 0.10, 0.01, 0.125, 0.50, 0.01, 272000, 2, 1.5),
  ('claude-sonnet-5-5', 2.00, 0.20, 2.50, 10.00, 0.01, NULL, 1, 1),
  ('*', 2.00, 0.20, 2.50, 10.00, 0.01, 272000, 2, 1.5);

-- One balance per office. It may end slightly below zero: a call is allowed while the balance is
-- positive and charged what it actually cost, and the next one waits for more credits.
CREATE TABLE credit_account (
  office_id TEXT PRIMARY KEY REFERENCES office(id) ON DELETE CASCADE,
  balance BIGINT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Every change to a balance, append-only. `reference` makes each grant or charge happen once.
CREATE TABLE credit_entry (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL REFERENCES office(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  actor_user_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('initial','plan','purchase','admin_grant','usage','ocr','refund')),
  amount BIGINT NOT NULL CHECK (amount <> 0),
  balance_after BIGINT NOT NULL,
  reference TEXT NOT NULL UNIQUE,
  description TEXT,
  -- The clock, not the transaction's start: an account's first charge opens it with the initial
  -- credits in the same transaction, and the statement must list them in the order they happened.
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX credit_entry_office ON credit_entry(office_id, created_at DESC);

-- What a call really cost: cache reads and writes, reasoning and web searches change the price.
ALTER TABLE ai_usage
  ADD COLUMN cached_input_tokens BIGINT,
  ADD COLUMN cache_write_tokens BIGINT,
  ADD COLUMN reasoning_tokens BIGINT,
  ADD COLUMN web_search_calls INTEGER,
  ADD COLUMN cost_usd NUMERIC(14,8),
  ADD COLUMN credits BIGINT;

-- Credit packages are one-time checkouts that add credits instead of a month.
ALTER TABLE billing_checkout DROP CONSTRAINT billing_checkout_kind_check;
ALTER TABLE billing_checkout ADD CONSTRAINT billing_checkout_kind_check CHECK (kind IN ('ONE_TIME','SUBSCRIPTION','CREDITS'));
ALTER TABLE billing_checkout ADD COLUMN credits INTEGER CHECK (credits > 0);
ALTER TABLE billing_checkout ADD CONSTRAINT billing_checkout_credits_kind CHECK ((kind = 'CREDITS') = (credits IS NOT NULL));
ALTER TABLE billing_checkout_reservation DROP CONSTRAINT billing_checkout_reservation_kind_check;
ALTER TABLE billing_checkout_reservation ADD CONSTRAINT billing_checkout_reservation_kind_check CHECK (kind IN ('ONE_TIME','SUBSCRIPTION','CREDITS'));
ALTER TABLE billing_checkout_reservation ADD COLUMN credits INTEGER CHECK (credits > 0);
