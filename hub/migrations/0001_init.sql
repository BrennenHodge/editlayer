-- Vibe CMS connector (hub): OAuth 2.1 authorization server + MCP proxy in front of Vibe CMS sites.
-- Secrets are never stored in the clear: codes and tokens as SHA-256 hashes, site keys AES-GCM encrypted.

-- OAuth clients: registered with dynamic client registration ('dcr') or described by a client ID metadata
-- document at an https client_id ('cimd', cached).
CREATE TABLE clients (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  redirect_uris TEXT NOT NULL,          -- JSON array
  created_at INTEGER NOT NULL,
  fetched_at INTEGER
);

-- One sign-in in progress: from /authorize until the client gets its code. Bound to the browser by a cookie.
CREATE TABLE requests (
  id TEXT PRIMARY KEY,
  browser_hash TEXT NOT NULL,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  state TEXT,
  code_challenge TEXT NOT NULL,
  resource TEXT,
  scope TEXT,
  grant_id TEXT NOT NULL,               -- the connection being built (sites are added to it)
  site_origin TEXT,                     -- site being approved right now
  site_verifier TEXT,                   -- our PKCE verifier toward that site
  site_state TEXT,
  expires_at INTEGER NOT NULL
);

-- A connection: what one assistant sign-in may reach.
CREATE TABLE grants (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used INTEGER
);

CREATE TABLE sites (
  grant_id TEXT NOT NULL,
  origin TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  approved_by TEXT NOT NULL,
  key_enc TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (grant_id, origin)
);

CREATE TABLE codes (
  hash TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  resource TEXT,
  scope TEXT,
  expires_at INTEGER NOT NULL
);

CREATE TABLE tokens (
  hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                   -- 'access' | 'refresh'
  grant_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  resource TEXT,
  scope TEXT,
  expires_at INTEGER NOT NULL
);
CREATE INDEX tokens_grant ON tokens (grant_id);
CREATE INDEX sites_grant ON sites (grant_id);
