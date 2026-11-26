-- Pages made in the editor (Pages panel → New page / Duplicate this page).
-- Their content is stored like any page's: region drafts and live rows in cms_regions under `path`,
-- title and description in the "#meta" key. This table only records that the page exists and which
-- static page's HTML is its shell (header, footer, <head>).
CREATE TABLE IF NOT EXISTS cms_pages (
  path TEXT PRIMARY KEY,           -- "/summer-workshops/"
  template TEXT NOT NULL,          -- a static page path, e.g. "/services/"
  title TEXT NOT NULL,             -- the title typed when the page was made
  created_at INTEGER NOT NULL,
  created_by TEXT
);
