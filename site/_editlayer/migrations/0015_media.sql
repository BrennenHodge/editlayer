-- Documents editors upload and link to (PDF, Word, Excel, PowerPoint, text, CSV).
-- The file lives in R2 under files/<id>/<name> and is served at /_cms/files/<id>/<name>.
CREATE TABLE IF NOT EXISTS cms_files (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,          -- safe file name used in the URL and the R2 key
  title TEXT,                  -- the name as uploaded, shown in the file list
  ext TEXT NOT NULL,           -- pdf, docx, xlsx, pptx, txt, csv
  type TEXT NOT NULL,          -- content type it is served with
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  created_by TEXT
);
CREATE INDEX IF NOT EXISTS cms_files_created ON cms_files (created_at);
