CREATE TABLE research_crawl_topic (
  installation_id TEXT NOT NULL REFERENCES judicial_source_installation(id),
  topic_key TEXT NOT NULL,
  label TEXT NOT NULL,
  parent_key TEXT,
  source_url TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (installation_id, topic_key)
);

CREATE TABLE research_crawl_partition (
  installation_id TEXT NOT NULL REFERENCES judicial_source_installation(id),
  partition_key TEXT NOT NULL,
  topic_key TEXT,
  query JSONB NOT NULL,
  checkpoint JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','partial','completed','blocked')),
  lease_owner TEXT,
  lease_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (installation_id, partition_key),
  FOREIGN KEY (installation_id, topic_key) REFERENCES research_crawl_topic(installation_id, topic_key),
  CHECK ((lease_owner IS NULL) = (lease_until IS NULL))
);

CREATE TABLE research_crawl_run (
  id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL REFERENCES judicial_source_installation(id),
  partition_key TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('running','partial','completed','failed')),
  evidence_storage_key TEXT,
  result JSONB NOT NULL DEFAULT '{}',
  FOREIGN KEY (installation_id, partition_key) REFERENCES research_crawl_partition(installation_id, partition_key)
);

CREATE TABLE research_crawl_judgment_topic (
  judgment_id TEXT NOT NULL REFERENCES research_judgment(id),
  installation_id TEXT NOT NULL,
  topic_key TEXT NOT NULL,
  provenance TEXT NOT NULL CHECK (provenance IN ('official_metadata','official_filter','inferred')),
  source_url TEXT NOT NULL,
  PRIMARY KEY (judgment_id, installation_id, topic_key),
  FOREIGN KEY (installation_id, topic_key) REFERENCES research_crawl_topic(installation_id, topic_key)
);

CREATE INDEX research_crawl_partition_pending ON research_crawl_partition(installation_id, status, updated_at);
CREATE INDEX research_crawl_run_source ON research_crawl_run(installation_id, started_at DESC);
