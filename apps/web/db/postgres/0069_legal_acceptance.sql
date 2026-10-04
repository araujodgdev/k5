-- What each person accepted, and when: the Termos de uso with the Política de privacidade (one
-- version, src/lib/legal-version.ts) and the notice that what is sent to the Lume reaches the AI
-- providers without anonymization. A new version means a new row; earlier ones stay as the record.
CREATE TABLE legal_acceptance (
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  document TEXT NOT NULL CHECK (document IN ('terms', 'ai_notice')),
  version TEXT NOT NULL CHECK (length(version) BETWEEN 1 AND 20),
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ip_address TEXT,
  user_agent TEXT CHECK (user_agent IS NULL OR length(user_agent) <= 300),
  PRIMARY KEY (user_id, document, version)
);
