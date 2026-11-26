-- Email sign-in links ("magic links"). Only a SHA-256 hash of each link's secret is stored.
-- A link works once, for 15 minutes.
CREATE TABLE IF NOT EXISTS cms_login_links (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  next TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX IF NOT EXISTS cms_login_links_user ON cms_login_links (user_id, created_at);
