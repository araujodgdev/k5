-- Web searches made in the Pesquisa module (Exa). Each row keeps the question, the chosen
-- search mode and the pages returned, so the person's history reopens without searching again.
CREATE TABLE "research_web_search" (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  query TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('instant','fast','auto','deep')),
  results_json TEXT NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX research_web_search_owner ON research_web_search(office_id,user_id,created_at DESC);
ALTER TABLE "research_web_search" ADD FOREIGN KEY ("office_id") REFERENCES "office" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "research_web_search" ADD FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
