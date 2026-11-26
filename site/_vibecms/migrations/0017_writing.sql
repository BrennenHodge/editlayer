-- Writing help: one row per rewrite request, for the per-editor hourly limit.
-- Rows older than a day are deleted as new requests come in.
CREATE TABLE IF NOT EXISTS cms_writing_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS cms_writing_usage_user ON cms_writing_usage (user_id, at);
