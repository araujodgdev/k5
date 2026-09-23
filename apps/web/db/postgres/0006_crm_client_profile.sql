-- Address and practice areas for the office's client list. The city is its own field because the
-- client's residence can decide the court (foro); every field stays optional (minimum data).
ALTER TABLE crm_client
  ADD COLUMN address_line TEXT CHECK (address_line IS NULL OR length(address_line) <= 240),
  ADD COLUMN city TEXT CHECK (city IS NULL OR length(city) <= 120),
  ADD COLUMN state TEXT CHECK (state IS NULL OR state ~ '^[A-Z]{2}$'),
  ADD COLUMN postal_code TEXT CHECK (postal_code IS NULL OR postal_code ~ '^[0-9]{5}-?[0-9]{3}$'),
  ADD COLUMN legal_areas TEXT[] NOT NULL DEFAULT '{}'
    CHECK (legal_areas <@ ARRAY['civel','trabalhista','previdenciario']::TEXT[]);

CREATE INDEX crm_client_legal_areas_idx ON crm_client USING GIN (legal_areas);
