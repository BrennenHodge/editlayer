-- Approval, share-preview links and scheduled publishing (feature: review).

-- 1. Allow the "author" role (edits and sends pages for review, cannot publish).
--    SQLite can't change a CHECK constraint in place, so the table is rebuilt. Ids are kept, so
--    sessions (cms_sessions.user_id) stay valid. If an earlier migration added columns to
--    cms_users, add them to both column lists below.
CREATE TABLE cms_users_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('admin', 'editor', 'author')),
  pass_hash TEXT,
  pass_salt TEXT,
  invite_hash TEXT,
  invite_expires INTEGER,
  failed INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_login INTEGER
);
INSERT INTO cms_users_new (id, email, name, role, pass_hash, pass_salt, invite_hash, invite_expires, failed, locked_until, created_at, last_login)
  SELECT id, email, name, role, pass_hash, pass_salt, invite_hash, invite_expires, failed, locked_until, created_at, last_login FROM cms_users;
DROP TABLE cms_users;
ALTER TABLE cms_users_new RENAME TO cms_users;
CREATE INDEX IF NOT EXISTS cms_users_invite ON cms_users (invite_hash);

-- 2. Review requests: an author asks an editor to check and publish a page.
--    status: pending → approved (published) | declined (sent back with a comment) | withdrawn | closed
--    (the drafts were discarded before anyone decided).
CREATE TABLE IF NOT EXISTS cms_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined', 'withdrawn', 'closed')),
  note TEXT,
  author_email TEXT NOT NULL,
  author_name TEXT,
  created_at INTEGER NOT NULL,
  reviewer_email TEXT,
  reviewer_name TEXT,
  comment TEXT,
  published INTEGER,
  decided_at INTEGER
);
CREATE INDEX IF NOT EXISTS cms_reviews_status ON cms_reviews (status, created_at);
CREATE INDEX IF NOT EXISTS cms_reviews_author ON cms_reviews (author_email, created_at);

-- 3. Share-preview links. Only a hash of the link's secret is stored.
CREATE TABLE IF NOT EXISTS cms_preview_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  path TEXT NOT NULL,
  time_zone TEXT,
  created_by TEXT NOT NULL,
  created_name TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS cms_preview_links_active ON cms_preview_links (expires_at);

-- 4. Scheduled publishes, run by the Worker's cron trigger. Times are UTC milliseconds.
--    status: pending → running → done | failed; or cancelled.
CREATE TABLE IF NOT EXISTS cms_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL,
  publish_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'done', 'failed', 'cancelled')),
  time_zone TEXT,
  created_by TEXT NOT NULL,
  created_name TEXT,
  created_at INTEGER NOT NULL,
  ran_at INTEGER,
  published INTEGER,
  result TEXT
);
CREATE INDEX IF NOT EXISTS cms_schedules_due ON cms_schedules (status, publish_at);
