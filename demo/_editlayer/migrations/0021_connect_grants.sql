-- One-time approvals from /_cms/connect: an admin approves an AI connector (the hosted Editlayer connector that
-- ChatGPT and Claude use), the connector exchanges the code (with its PKCE verifier) for a connection key.
-- Codes live five minutes and work once; only their hash is stored.
CREATE TABLE IF NOT EXISTS cms_connect_grants (
  code_hash TEXT PRIMARY KEY,
  hub TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  created_by TEXT NOT NULL,
  challenge TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
