-- AI connections: access keys that let an AI assistant (ChatGPT, Claude, Grok, any MCP client) read and
-- edit this site through /_cms/mcp. The key itself is shown once; only its SHA-256 hash is stored.
CREATE TABLE IF NOT EXISTS cms_ai_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'author' CHECK (role IN ('author', 'editor')),
  created_by TEXT,
  created_at INTEGER NOT NULL,
  last_used INTEGER
);
