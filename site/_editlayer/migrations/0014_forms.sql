-- Form submissions inbox (feature: forms).
-- Messages visitors send through <form data-cms-form="name"> on the site.
-- data is JSON: [[field, value], ...] in the order the form sent them.
-- spam = 1 for submissions caught by the honeypot, the timing check or Turnstile; they stay out of the
-- Inbox but can be reviewed (and moved back) under "Spam" and are deleted after 30 days.
CREATE TABLE IF NOT EXISTS cms_form_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  form TEXT NOT NULL,
  data TEXT NOT NULL,
  page TEXT,
  ip_hash TEXT,
  user_agent TEXT,
  created_at INTEGER NOT NULL,
  read_at INTEGER,
  spam INTEGER NOT NULL DEFAULT 0,
  spam_reason TEXT
);
CREATE INDEX IF NOT EXISTS cms_form_submissions_box ON cms_form_submissions (spam, id);
CREATE INDEX IF NOT EXISTS cms_form_submissions_form ON cms_form_submissions (form, spam, id);
CREATE INDEX IF NOT EXISTS cms_form_submissions_ip ON cms_form_submissions (ip_hash, created_at);

-- Per-site random values the forms feature needs (the key that signs the form timing field).
CREATE TABLE IF NOT EXISTS cms_form_keys (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
