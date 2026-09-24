-- The Lume's working memory, kept by Mastra Memory (@mastra/pg). The store runs with disableInit,
-- so the runtime role never issues DDL: these are the only Mastra tables the memory touches, with
-- the columns and indexes @mastra/pg would create itself.
--
-- mastra_resources holds one working memory per person in an office (id = "<officeId>:<userId>").
-- mastra_threads holds one row per conversation (id = ai_conversation.id), with no content.
-- mastra_messages stays empty: the chat keeps its history in ai_conversation, and the memory is
-- configured without message history or semantic recall. The table exists because the store
-- reads it when a thread is loaded.
CREATE TABLE mastra_threads (
  id TEXT PRIMARY KEY,
  "resourceId" TEXT NOT NULL,
  title TEXT NOT NULL,
  metadata JSONB,
  "createdAt" TIMESTAMP NOT NULL,
  "updatedAt" TIMESTAMP NOT NULL,
  "createdAtZ" TIMESTAMPTZ DEFAULT now(),
  "updatedAtZ" TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX mastra_threads_resourceid_createdat_idx ON mastra_threads ("resourceId", "createdAt" DESC);

CREATE TABLE mastra_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  content TEXT NOT NULL,
  role TEXT NOT NULL,
  type TEXT NOT NULL,
  "createdAt" TIMESTAMP NOT NULL,
  "resourceId" TEXT,
  "createdAtZ" TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX mastra_messages_thread_id_createdat_idx ON mastra_messages (thread_id, "createdAt" DESC);

CREATE TABLE mastra_resources (
  id TEXT PRIMARY KEY,
  "workingMemory" TEXT,
  metadata JSONB,
  "createdAt" TIMESTAMP NOT NULL,
  "updatedAt" TIMESTAMP NOT NULL,
  "createdAtZ" TIMESTAMPTZ DEFAULT now(),
  "updatedAtZ" TIMESTAMPTZ DEFAULT now()
);
