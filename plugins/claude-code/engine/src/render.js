import { getUser } from './auth.js';
import { loadForPage } from './content.js';
import { stripHidden } from './sanitize.js';
import { CLIENT_VERSION } from './client-assets.js';
import { accentOf } from './pages.js';
import { normalizePath, scriptJson } from './util.js';
import { FEATURES } from './features/index.js';

/**
 * Content-Security-Policy for edit mode. Scripts: this site ('self', the editor), plus the origins and inline
 * hashes of the page's own data-cms-keep scripts. No inline event handlers, javascript: links, plugins, <base>
 * changes or form posts to other sites.
 */
export async function editCsp(html) {
  const sources = new Set(["'self'"]);
  let kept = false;
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const attrs = m[1];
    if (!/\sdata-cms-keep\b/i.test(attrs)) continue;
    kept = true;
    const src = /\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
    if (src) {
      const value = (src[1] ?? src[2] ?? src[3] ?? '').trim();
      try {
        const u = new URL(value, 'https://self.invalid');
        if (u.origin !== 'https://self.invalid' && /^https:$/.test(u.protocol)) sources.add(u.origin);
      } catch { /* unparseable: blocked */ }
    } else if (m[2].trim()) {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(m[2]));
      sources.add(`'sha256-${btoa(String.fromCharCode(...new Uint8Array(digest)))}'`);
    }
  }
  // Kept scripts are the developer's own and may need eval (Alpine.js and similar).
  if (kept) sources.add("'unsafe-eval'");
  return [`script-src ${[...sources].join(' ')}`, "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'self'"].join('; ');
}

/** Draft keys that hold data (JSON), not HTML regions: page settings plus any a feature registers. */
export function specialKeys() {
  const keys = { '#meta': true };
  for (const f of FEATURES) for (const k of Object.keys(f.keys || {})) keys[k] = true;
  return keys;
}

/**
 * Serves a static HTML page with any edits applied.
 * - Visitors: published edits only. Pages nobody edited are passed through untouched.
 * - Signed-in editors: same, plus a small "Edit page" button.
 * - Editors with ?edit: drafts applied, the site's own scripts removed, and the editor loaded.
 * - Editors with ?preview: drafts applied, site scripts kept, no editor (phone preview, review).
 * mode: { drafts: true } shows drafts without a session (share-preview links); { user } overrides the session.
 */
export async function renderPage(request, env, res, url, opts, mode = {}) {
  const user = 'user' in mode ? mode.user : await getUser(request, env);
  const wantsEdit = url.searchParams.has('edit');
  if (wantsEdit && !user) {
    return Response.redirect(`${url.origin}/_cms/login?next=${encodeURIComponent(url.pathname + '?edit')}`, 302);
  }
  const path = res.status === 200 ? normalizePath(url.pathname) : null;
  const editing = Boolean(user && wantsEdit && path);
  const preview = Boolean(path && !editing && (mode.drafts || (user && url.searchParams.has('preview'))));
  const rows = await loadForPage(env, path, editing || preview);
  const always = FEATURES.some((f) => (typeof f.alwaysRender === 'function' ? f.alwaysRender(opts) : f.alwaysRender));
  if (!rows.size && !user && !preview && !always) {
    // Untouched page: serve as-is, but without the static ETag so a later publish is never masked by a 304.
    const headers = new Headers(res.headers);
    headers.delete('etag');
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  }

  const special = specialKeys();
  if (!editing) {
    for (const row of rows.values()) if (!special[row.key]) row.html = await stripHidden(row.html);
  }

  const regions = {};
  let rw = new HTMLRewriter().on('[data-cms]', {
    element(el) {
      const key = el.getAttribute('data-cms');
      const row = rows.get(key);
      if (!row || special[key]) return;
      el.setInnerContent(row.html, { html: true });
      const base = el.getAttribute('data-cms-v');
      regions[key] = { state: row.state, conflict: Boolean(row.base && base && row.base !== base) };
    },
  });

  const metaRow = rows.get('#meta');
  let meta = {};
  if (metaRow) {
    try { meta = JSON.parse(metaRow.html) || {}; } catch { meta = {}; }
    const setContent = (selector, value) => {
      if (value) rw = rw.on(selector, { element: (el) => el.setAttribute('content', value) });
    };
    if (meta.title) rw = rw.on('title', { element: (el) => el.setInnerContent(meta.title) });
    setContent('meta[name="description"]', meta.description);
    setContent('meta[property="og:description"]', meta.description);
    setContent('meta[name="twitter:description"]', meta.description);
    setContent('meta[property="og:title"]', meta.shareTitle);
    setContent('meta[name="twitter:title"]', meta.shareTitle);
  }

  // Features add their own handlers. "after" handlers run on the output of the first pass, so they
  // also see content that was just swapped in (shared sections nested in an edited page region).
  const state = editing ? {
    path,
    user: { email: user.email, name: user.name, role: user.role },
    site: { name: opts.siteName, accent: accentOf(opts) },
    regions,
    hasDraft: [...rows.values()].some((r) => r.state === 'draft'),
    meta,
    features: {},
  } : null;
  const after = [];
  const heads = [];
  const bodyEnds = [];
  for (const f of FEATURES) {
    if (!f.render) continue;
    const ctx = {
      env, url, opts, user, path, rows, editing, preview, request,
      on(selector, handlers) { rw = rw.on(selector, handlers); },
      onAfter(selector, handlers) { after.push([selector, handlers]); },
      head(html) { heads.push(html); },
      bodyEnd(html) { bodyEnds.push(html); },
      share(data) { if (state) state.features[f.name] = data; },
    };
    try { await f.render(ctx); } catch (err) { console.error(`editlayer: ${f.name} render failed`, err && err.stack || err); }
  }

  if (editing) {
    rw = rw.on('script', {
      element(el) {
        const type = (el.getAttribute('type') || '').toLowerCase();
        if (type === 'application/ld+json' || el.hasAttribute('data-cms-keep')) return;
        el.remove();
      },
    });
    heads.push(`<meta name="robots" content="noindex"><link rel="stylesheet" href="/_cms/editor.css?v=${CLIENT_VERSION}">`);
    bodyEnds.push(() => `<script id="editlayer-state" type="application/json">${scriptJson(state)}</script><script src="/_cms/editor.js?v=${CLIENT_VERSION}" defer></script>`);
  } else if (preview) {
    heads.push('<meta name="robots" content="noindex">');
  } else if (user) {
    bodyEnds.push(`<script src="/_cms/launcher.js?v=${CLIENT_VERSION}" data-accent="${accentOf(opts)}" defer></script>`);
  }
  if (heads.length) rw = rw.on('head', { element: (el) => el.append(heads.join(''), { html: true }) });
  if (bodyEnds.length) {
    rw = rw.on('body', {
      element: (el) => el.onEndTag((end) => end.before(bodyEnds.map((b) => (typeof b === 'function' ? b() : b)).join(''), { html: true })),
    });
  }

  const headers = new Headers(res.headers);
  headers.delete('etag');
  headers.delete('content-length');
  let body = res.body;
  if (user || preview) {
    headers.set('cache-control', 'private, no-store');
    headers.set('x-frame-options', 'SAMEORIGIN');
    headers.set('content-security-policy', "frame-ancestors 'self'");
    headers.set('x-content-type-options', 'nosniff');
  }
  if (editing) {
    // The editor runs with a signed-in editor's rights, so the page gets a script policy: only the editor's own
    // script and scripts the developer marked data-cms-keep may run. Saved content can't contain scripts (the
    // sanitizer removes them); this makes sure that even if something got past it, it couldn't run.
    const html = await res.text();
    body = html;
    headers.set('content-security-policy', await editCsp(html));
  }
  let out = rw.transform(new Response(body, { status: res.status, statusText: res.statusText, headers }));
  if (after.length) {
    let rw2 = new HTMLRewriter();
    for (const [selector, handlers] of after) rw2 = rw2.on(selector, handlers);
    out = rw2.transform(out);
  }
  return out;
}
