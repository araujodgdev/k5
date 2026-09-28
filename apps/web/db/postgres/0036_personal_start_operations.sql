CREATE TABLE personal_start_operation (
  author_user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  thread_id TEXT NOT NULL REFERENCES personal_thread(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (author_user_id, request_id)
);
