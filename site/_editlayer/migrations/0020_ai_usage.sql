-- AI connections: one row per tool call, for the per-key rate limit (rows older than a day are cleared as
-- new ones are written). Without this table the limit is simply not applied.
CREATE TABLE IF NOT EXISTS cms_ai_usage (
  token_id INTEGER NOT NULL,
  at INTEGER NOT NULL,
  is_write INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS cms_ai_usage_token_at ON cms_ai_usage (token_id, at);
