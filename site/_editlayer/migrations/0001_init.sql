-- Editlayer schema. Applied with: wrangler d1 migrations apply <db> --remote

-- Edited content. One row per page path + region key + state.
-- path "*" holds site-wide regions (keys starting with "@", e.g. "@footer").
-- key "#meta" holds page settings (JSON: title, description, shareTitle).
CREATE TABLE IF NOT EXISTS cms_regions (
  path TEXT NOT NULL,
  key TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('draft', 'live')),
  html TEXT NOT NULL,
  base TEXT,
  updated_at INTEGER NOT NULL,
  updated_by TEXT,
  PRIMARY KEY (path, key, state)
);

-- Every publish, so any earlier version can be restored.
CREATE TABLE IF NOT EXISTS cms_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch TEXT NOT NULL,
  path TEXT NOT NULL,
  key TEXT NOT NULL,
  html TEXT NOT NULL,
  base TEXT,
  published_at INTEGER NOT NULL,
  published_by TEXT
);
CREATE INDEX IF NOT EXISTS cms_revisions_path ON cms_revisions (path, id);
CREATE INDEX IF NOT EXISTS cms_revisions_batch ON cms_revisions (batch);

CREATE TABLE IF NOT EXISTS cms_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('admin', 'editor')),
  pass_hash TEXT,
  pass_salt TEXT,
  invite_hash TEXT,
  invite_expires INTEGER,
  failed INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_login INTEGER
);
CREATE INDEX IF NOT EXISTS cms_users_invite ON cms_users (invite_hash);

CREATE TABLE IF NOT EXISTS cms_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS cms_sessions_user ON cms_sessions (user_id);

-- Uploaded images (files live in R2 under media/<id>.<ext>).
CREATE TABLE IF NOT EXISTS cms_media (
  id TEXT PRIMARY KEY,
  file TEXT NOT NULL,
  name TEXT,
  type TEXT NOT NULL,
  size INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  alt TEXT,
  created_at INTEGER NOT NULL,
  created_by TEXT
);
