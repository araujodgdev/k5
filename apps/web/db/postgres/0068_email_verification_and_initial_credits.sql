-- E-mail confirmation becomes required where e-mail can be delivered (auth-core.ts). Accounts that
-- already exist were created when there was nothing to confirm with; requiring it now would lock
-- them out at their next sign-in, so they are treated as confirmed. Changing the address later
-- still goes through Better Auth.
UPDATE "user" SET "emailVerified" = TRUE WHERE "emailVerified" = FALSE;

-- A new office starts with 500 credits instead of 850. With the pricing of 0061 (R$ 0,10 a credit,
-- 30% margin, 6% tax, 3% fee, US$ 1 = R$ 5,50) that is about US$ 5,55 of provider cost, under the
-- US$ 10 ceiling decided for a free account. Offices that already opened their account keep it.
UPDATE credit_settings SET initial_credits = 500 WHERE initial_credits = 850;
