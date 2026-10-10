-- Claude Haiku 5.5 serves the summary tasks since 2026-10-09. Without a row of its own it was priced
-- at the `*` fallback (US$ 2 / 10), twenty times its list price. Anthropic API list prices read on
-- 2026-10-10: US$ 0,10 in and 0,50 out per million tokens for prompts up to 100 thousand tokens, and
-- five times both above that; cache reads at 0,1x and five-minute cache writes at 1,25x the input.
INSERT INTO ai_model_price (model_id, input_usd_mtok, cached_input_usd_mtok, cache_write_usd_mtok, output_usd_mtok, web_search_usd_call, long_context_tokens, long_input_multiplier, long_output_multiplier) VALUES
  ('claude-haiku-5-5', 0.10, 0.01, 0.125, 0.50, 0.01, 100000, 5, 5)
ON CONFLICT (model_id) DO NOTHING;
