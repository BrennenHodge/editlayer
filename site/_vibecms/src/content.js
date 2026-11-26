import { KEY_RE, randomToken } from './util.js';
import { sanitize } from './sanitize.js';

const MAX_HTML = 1_000_000;

/** Site-wide regions ("@footer") live under path "*". */
export const storagePath = (path, key) => (key.startsWith('@') ? '*' : path);

/**
 * Edited regions for a page, keyed by region key. With drafts, a draft wins over the live row.
 * Returns Map<key, {key, state, html, base}>.
 */
export async function loadForPage(env, path, withDrafts) {
  const paths = path ? [path, '*'] : ['*'];
  const sql = `SELECT key, state, html, base FROM cms_regions WHERE path IN (${paths.map(() => '?').join(',')})${withDrafts ? '' : " AND state = 'live'"}`;
  const { results } = await env.CMS_DB.prepare(sql).bind(...paths).all();
  const map = new Map();
  for (const r of results) {
    const cur = map.get(r.key);
    if (!cur || r.state === 'draft') map.set(r.key, r);
  }
  return map;
}

/**
 * Saves draft regions. `keys` maps feature data keys ("@theme" …) to serializers that validate the
 * value sent by the editor and return the string to store; everything else is sanitized HTML.
 */
export async function saveDrafts(env, path, regions, user, keys = {}) {
  const stmts = [];
  const now = Date.now();
  for (const [key, value] of Object.entries(regions || {})) {
    if (!KEY_RE.test(key)) throw new Error(`Bad region key: ${key}`);
    let html;
    if (key === '#meta') {
      const m = value && value.meta ? value.meta : {};
      html = JSON.stringify({
        title: String(m.title || '').slice(0, 200),
        description: String(m.description || '').slice(0, 500),
        shareTitle: String(m.shareTitle || '').slice(0, 200),
      });
    } else if (keys[key]) {
      html = String(await keys[key](value, { env, path, user }));
      if (html.length > MAX_HTML) throw new Error('This is too large to save.');
    } else {
      html = String(value?.html ?? '');
      if (html.length > MAX_HTML) throw new Error('This section is too large to save.');
      html = await sanitize(html);
    }
    stmts.push(env.CMS_DB.prepare(
      `INSERT INTO cms_regions (path, key, state, html, base, updated_at, updated_by) VALUES (?, ?, 'draft', ?, ?, ?, ?)
       ON CONFLICT(path, key, state) DO UPDATE SET html = excluded.html, base = excluded.base,
         updated_at = excluded.updated_at, updated_by = excluded.updated_by`
    ).bind(storagePath(path, key), key, html, (keys[key] || key === '#meta') ? null : value?.base || null, now, user.email));
  }
  if (stmts.length) await env.CMS_DB.batch(stmts);
  return stmts.length;
}

export async function publish(env, paths, user) {
  const ph = paths.map(() => '?').join(',');
  const { results } = await env.CMS_DB.prepare(`SELECT path, key, html, base FROM cms_regions WHERE state = 'draft' AND path IN (${ph})`).bind(...paths).all();
  if (!results.length) return 0;
  const batch = randomToken(9);
  const now = Date.now();
  const stmts = [];
  for (const r of results) {
    stmts.push(env.CMS_DB.prepare('INSERT INTO cms_revisions (batch, path, key, html, base, published_at, published_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(batch, r.path, r.key, r.html, r.base, now, user.email));
    stmts.push(env.CMS_DB.prepare(
      `INSERT INTO cms_regions (path, key, state, html, base, updated_at, updated_by) VALUES (?, ?, 'live', ?, ?, ?, ?)
       ON CONFLICT(path, key, state) DO UPDATE SET html = excluded.html, base = excluded.base, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
    ).bind(r.path, r.key, r.html, r.base, now, user.email));
  }
  stmts.push(env.CMS_DB.prepare(`DELETE FROM cms_regions WHERE state = 'draft' AND path IN (${ph})`).bind(...paths));
  await env.CMS_DB.batch(stmts);
  return results.length;
}

export async function discard(env, paths) {
  const ph = paths.map(() => '?').join(',');
  await env.CMS_DB.prepare(`DELETE FROM cms_regions WHERE state = 'draft' AND path IN (${ph})`).bind(...paths).run();
}

/** Removes every edit for a page (not site-wide regions), going back to the developer's version. */
export async function resetPage(env, path) {
  await env.CMS_DB.prepare('DELETE FROM cms_regions WHERE path = ?').bind(path).run();
}

export async function history(env, path) {
  const { results } = await env.CMS_DB.prepare(
    `SELECT batch, path, key, published_at, published_by FROM cms_revisions WHERE path IN (?, '*') ORDER BY id DESC LIMIT 300`
  ).bind(path).all();
  const groups = new Map();
  for (const r of results) {
    if (!groups.has(r.batch)) groups.set(r.batch, { batch: r.batch, at: r.published_at, by: r.published_by, parts: [] });
    groups.get(r.batch).parts.push(partLabel(r));
  }
  return [...groups.values()].slice(0, 50).map((g) => ({ ...g, parts: [...new Set(g.parts)] }));
}

function partLabel(r) {
  if (r.key === '#meta') return 'page settings';
  if (r.path !== '*') return 'page';
  if (r.key.startsWith('@s-')) return 'shared section';
  if (r.key === '@theme') return 'site styles';
  return `site ${r.key.slice(1).replace(/^#/, '')}`;
}

/** Copies a published version back into drafts, so it can be checked and then published. */
export async function restore(env, batch, path, user) {
  const { results } = await env.CMS_DB.prepare(`SELECT path, key, html, base FROM cms_revisions WHERE batch = ? AND path IN (?, '*')`).bind(batch, path).all();
  const now = Date.now();
  if (!results.length) return 0;
  await env.CMS_DB.batch(results.map((r) => env.CMS_DB.prepare(
    `INSERT INTO cms_regions (path, key, state, html, base, updated_at, updated_by) VALUES (?, ?, 'draft', ?, ?, ?, ?)
     ON CONFLICT(path, key, state) DO UPDATE SET html = excluded.html, base = excluded.base, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
  ).bind(r.path, r.key, r.html, r.base, now, user.email)));
  return results.length;
}

export async function draftPaths(env) {
  const { results } = await env.CMS_DB.prepare(`SELECT DISTINCT path FROM cms_regions WHERE state = 'draft'`).all();
  return results.map((r) => r.path);
}
