-- The person's own profile, shown on /app/profile and as a card to whoever looks up their e-mail
-- to invite them. The photo is small (resized in the browser) and lives beside the fields.
CREATE TABLE user_profile (
  user_id TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  headline TEXT NOT NULL DEFAULT '' CHECK (length(headline) <= 120),
  oab TEXT NOT NULL DEFAULT '' CHECK (length(oab) <= 40),
  location TEXT NOT NULL DEFAULT '' CHECK (length(location) <= 120),
  bio TEXT NOT NULL DEFAULT '' CHECK (length(bio) <= 600),
  avatar BYTEA CHECK (avatar IS NULL OR octet_length(avatar) <= 524288),
  avatar_type TEXT CHECK (avatar_type IN ('image/png', 'image/jpeg', 'image/webp')),
  avatar_version TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((avatar IS NULL) = (avatar_type IS NULL) AND (avatar IS NULL) = (avatar_version IS NULL))
);

-- Looking up an e-mail tells whether it has an account, so each person gets a small window of lookups.
CREATE TABLE profile_lookup_window (
  user_id TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  window_start TIMESTAMPTZ NOT NULL,
  lookups INTEGER NOT NULL CHECK (lookups >= 0)
);
