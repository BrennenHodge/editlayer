// New pages made in the editor, served from a static page's HTML shell.
//
// A CMS page is a row in cms_pages (path, template). Its content is ordinary region rows for its own
// path, so drafts, publishing, history and undo work exactly as on static pages. When a URL has no
// static file, source() serves the template's HTML (head, header, footer and an un-edited <main>),
// and the core swaps in the page's own regions. Visitors only see a page once its main content has
// been published; before that it is a normal 404 for them, while signed-in editors can open it.
//
// Options (createCms({ pages: { ... } })):
//   layout:      static page offered first as the layout for "A simple page" (default: the page open)
//   textSection: HTML for the text section of a simple page (default: built from the layout's markup)
//   reserved:    extra first-level web addresses editors may not use (["blog", "news"])
import { json, normalizePath, escapeHtml } from '../util.js';
import { saveDrafts } from '../content.js';

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PATH_RE = /^\/([a-z0-9]+(?:-[a-z0-9]+)*)\/$/;
// A static page usable as a shell: "/" or "/a/b/" (no host, query, backslash or dot segments).
const TEMPLATE_RE = /^\/(?:[A-Za-z0-9_~-][A-Za-z0-9._~-]*\/)*$/;
const MAX_SLUG = 80;
const MAX_TITLE = 120;
const MAX_PAGES = 500;
const RESERVED = new Set(['_cms', 'cms', 'api', 'admin', 'assets', 'edit', 'preview', 'login', 'logout', 'media',
  'sitemap', 'sitemap-xml', 'robots', 'favicon', 'index', 'styles', 'script', 'static', 'feed', 'rss', 'search', '404']);
const PAGE_KEY = (k) => !/^[@#]/.test(k);

// Pages served by source() during this request, for render() (same Request object in both).
const served = new WeakMap();

function fail(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

const LIVE_SQL = `EXISTS (SELECT 1 FROM cms_regions r WHERE r.path = p.path AND r.state = 'live' AND substr(r.key, 1, 1) NOT IN ('@', '#'))`;

async function getPage(env, path) {
  return env.CMS_DB.prepare(`SELECT p.path, p.template, p.title, p.created_at, p.created_by, ${LIVE_SQL} AS live FROM cms_pages p WHERE p.path = ?`)
    .bind(path).first();
}

async function listPages(env) {
  const { results } = await env.CMS_DB.prepare(
    `SELECT p.path, p.template, p.title, p.created_at, p.created_by, ${LIVE_SQL} AS live,
       EXISTS (SELECT 1 FROM cms_regions d WHERE d.path = p.path AND d.state = 'draft') AS draft
     FROM cms_pages p ORDER BY p.path`).all();
  return results.map((r) => ({ ...r, live: Boolean(r.live), draft: Boolean(r.draft) }));
}

/** The static file at a path, without following redirects. */
function fetchStatic(env, origin, path) {
  return env.ASSETS.fetch(new Request(new URL(path, origin), { method: 'GET', redirect: 'manual' }));
}

const decode = (s) => String(s).replace(/&(amp|lt|gt|quot|#39|#x27|nbsp);/g, (m, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", '#x27': "'", nbsp: ' ' }[e]));

/** A static page usable as a shell: 200, HTML, with at least one page region. */
async function templateInfo(env, origin, path) {
  if (!TEMPLATE_RE.test(path) || path.startsWith('/_cms')) return null;
  const res = await fetchStatic(env, origin, path);
  if (res.status !== 200 || !(res.headers.get('content-type') || '').includes('text/html')) return null;
  const html = await res.text();
  const keys = [...new Set([...html.matchAll(/\sdata-cms="([^"]+)"/g)].map((m) => m[1]).filter(PAGE_KEY))];
  if (!keys.length) return null;
  const title = decode((html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '').trim();
  return { path, keys, title };
}

/** "/Summer workshops/" or "summer-workshops" → "summer-workshops" (or null if not allowed). */
function slugOf(value) {
  const s = String(value || '').trim().replace(/^\/+|\/+$/g, '');
  return SLUG_RE.test(s) && s.length <= MAX_SLUG ? s : null;
}

/** Why a web address can't be used, or '' if it's free. */
async function addressProblem(env, origin, opts, value) {
  const slug = slugOf(value);
  if (!slug) return 'Use lowercase letters, numbers and hyphens only, like summer-workshops.';
  const reserved = new Set([...RESERVED, ...((opts.pages && opts.pages.reserved) || []).map(String)]);
  if (reserved.has(slug)) return 'That address is kept for the website itself. Try another.';
  if (await getPage(env, `/${slug}/`)) return 'Another page made here already uses this address.';
  for (const p of [`/${slug}/`, `/${slug}`]) {
    const res = await fetchStatic(env, origin, p);
    if (res.status >= 300 && res.status < 400) {
      const to = res.headers.get('location') || '';
      // "/x" → "/x/" is the static page itself; anything else is a redirect rule.
      if (to.replace(/^https?:\/\/[^/]+/, '') !== `/${slug}/`) return 'This address already forwards visitors to another page.';
      return 'A page already uses this address.';
    }
    if (res.status !== 404) return 'A page already uses this address.';
  }
  return '';
}

function shortTitle(v) {
  return String(v || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);
}

/** "Summer workshops" + template title "Services | Example Co" → "Summer workshops | Example Co". */
function fullTitle(title, templateTitle) {
  const i = templateTitle.lastIndexOf(' | ');
  const suffix = i > 0 ? templateTitle.slice(i + 3).trim() : '';
  return (suffix ? `${title} | ${suffix}` : title).slice(0, 200);
}

/** The template's HTML adjusted for the CMS page: its own address, title and no template-only tags. */
function shell(res, page, url) {
  const abs = (href) => { try { return new URL(page.path, href || url.origin).href; } catch { return new URL(page.path, url.origin).href; } };
  const rw = new HTMLRewriter()
    // The developer's version hash belongs to the template, not this page: without it the editor never
    // reports a "developer changed this page" conflict just because the template page was rebuilt.
    .on('[data-cms]', { element: (el) => { if (PAGE_KEY(el.getAttribute('data-cms') || '')) el.removeAttribute('data-cms-v'); } })
    .on('link[rel="canonical"]', { element: (el) => el.setAttribute('href', abs(el.getAttribute('href'))) })
    .on('meta[property="og:url"]', { element: (el) => el.setAttribute('content', abs(el.getAttribute('content'))) })
    .on('title', { element: (el) => el.setInnerContent(page.title) })
    .on('[aria-current="page"]', { element: (el) => el.removeAttribute('aria-current') })
    // The menu's current link (data-cms-current, applied by the nav feature) is the template's: point
    // it at this page, so its own menu link is marked if it has one and no other link is.
    .on('[data-cms-current]', { element: (el) => el.setAttribute('data-cms-current', page.path) })
    // Structured data describes the template page (its address, its breadcrumb trail).
    .on('script[type="application/ld+json"]', { element: (el) => el.remove() });
  const headers = new Headers(res.headers);
  headers.delete('etag');
  headers.delete('content-length');
  if (!page.live) headers.set('x-robots-tag', 'noindex');
  return rw.transform(new Response(res.body, { status: 200, headers }));
}

export default {
  name: 'pages',

  api: [
    {
      method: 'GET', route: 'cms-pages', role: 'author',
      handler: async ({ env }) => json({ pages: await listPages(env) }),
    },
    {
      method: 'GET', route: 'cms-pages/check', role: 'author',
      handler: async ({ env, url, opts }) => {
        const problem = await addressProblem(env, url.origin, opts, url.searchParams.get('path'));
        return json({ ok: !problem, message: problem });
      },
    },
    {
      // { title, path: "summer-workshops", mode: "copy"|"simple", from: "/services/", regions: { main: "<section>…" } }
      method: 'POST', route: 'cms-pages', role: 'author',
      handler: async ({ env, url, opts, user, body }) => {
        const title = typeof body.title === 'string' ? shortTitle(body.title) : '';
        if (!title) throw fail(400, 'Give the page a title.');
        const problem = await addressProblem(env, url.origin, opts, body.path);
        if (problem) throw fail(400, problem);
        const path = `/${slugOf(body.path)}/`;
        if (!['copy', 'simple'].includes(body.mode)) throw fail(400, 'Choose how to start the page.');

        // The shell is a static page. Copying a page made here reuses that page's shell.
        let from = normalizePath(String(body.from || '/'));
        const fromPage = await getPage(env, from);
        if (fromPage) from = fromPage.template;
        const tpl = await templateInfo(env, url.origin, from);
        if (!tpl) throw fail(400, 'That page can’t be used to start a new one. Pick another.');

        const regions = {};
        for (const [key, html] of Object.entries(body.regions || {})) {
          if (!tpl.keys.includes(key) || typeof html !== 'string') continue;
          regions[key] = { html, base: null };
        }
        if (!Object.keys(regions).length) throw fail(400, 'The page has no content to start from. Pick another page.');

        const { n } = await env.CMS_DB.prepare('SELECT COUNT(*) AS n FROM cms_pages').first();
        if (n >= MAX_PAGES) throw fail(400, 'This site has reached the limit of pages made in the editor.');
        try {
          await env.CMS_DB.prepare('INSERT INTO cms_pages (path, template, title, created_at, created_by) VALUES (?, ?, ?, ?, ?)')
            .bind(path, tpl.path, title, Date.now(), user.email).run();
        } catch {
          throw fail(409, 'Another page made here already uses this address.');
        }
        try {
          // Clear anything left at this address by an earlier page with the same address.
          await env.CMS_DB.prepare('DELETE FROM cms_regions WHERE path = ?').bind(path).run();
          regions['#meta'] = { meta: { title: fullTitle(title, tpl.title), description: '', shareTitle: '' } };
          await saveDrafts(env, path, regions, user, {});
        } catch (e) {
          await env.CMS_DB.batch([
            env.CMS_DB.prepare('DELETE FROM cms_regions WHERE path = ?').bind(path),
            env.CMS_DB.prepare('DELETE FROM cms_pages WHERE path = ?').bind(path),
          ]);
          throw fail(400, e.message || 'Couldn’t create the page.');
        }
        return json({ path, title });
      },
    },
    {
      method: 'DELETE', route: 'cms-pages', role: 'editor',
      handler: async ({ env, body }) => {
        const path = normalizePath(String(body.path || ''));
        if (!PATH_RE.test(path) || !(await getPage(env, path))) throw fail(404, 'Only pages made in the editor can be deleted here.');
        await env.CMS_DB.batch([
          env.CMS_DB.prepare('DELETE FROM cms_regions WHERE path = ?').bind(path),
          env.CMS_DB.prepare('DELETE FROM cms_pages WHERE path = ?').bind(path),
        ]);
        return json({ ok: true });
      },
    },
  ],

  // Published pages made here join the sitemap (and so the editor's page list and link suggestions).
  assets: {
    '/sitemap.xml': async ({ env, url }, res) => {
      if (res.status !== 200) return res;
      let rows;
      try {
        ({ results: rows } = await env.CMS_DB.prepare(
          `SELECT p.path, MAX(r.updated_at) AS at FROM cms_pages p JOIN cms_regions r
             ON r.path = p.path AND r.state = 'live' AND substr(r.key, 1, 1) NOT IN ('@', '#') GROUP BY p.path ORDER BY p.path`).all());
      } catch { return res; }
      if (!rows.length) return res;
      const xml = await res.text();
      if (!xml.includes('</urlset>')) return new Response(xml, { status: res.status, headers: res.headers });
      const origin = (xml.match(/<loc>\s*(https?:\/\/[^/<\s]+)/) || [])[1] || url.origin;
      const have = new Set([...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]));
      const add = rows.filter((r) => !have.has(origin + r.path))
        .map((r) => `  <url><loc>${escapeHtml(origin + r.path)}</loc><lastmod>${new Date(r.at).toISOString().slice(0, 10)}</lastmod></url>\n`).join('');
      const headers = new Headers(res.headers);
      headers.delete('etag');
      headers.delete('content-length');
      return new Response(xml.replace('</urlset>', `${add}</urlset>`), { status: 200, headers });
    },
  },

  async source({ request, env, url, opts, path, getUser, drafts }) {
    if (!PATH_RE.test(path)) return null;
    let page;
    try { page = await getPage(env, path); } catch { return null; }  // table missing: behave as before
    if (!page) return null;
    page.live = Boolean(page.live);
    if (!page.live && !drafts) {
      // Not published yet: a normal 404 for visitors, the editor for signed-in people.
      // (Share-preview links render with drafts: true and may show it.)
      if (!(await getUser())) return null;
      if (!url.searchParams.has('edit') && !url.searchParams.has('preview')) {
        return new Response(null, { status: 302, headers: { location: `${path}?edit`, 'cache-control': 'no-store' } });
      }
    }
    if (url.pathname !== path) {
      return new Response(null, { status: 301, headers: { location: path + url.search } });
    }
    // If the developer removed the template page, borrow the layout page's or home page's shell, so
    // the page doesn't vanish (and editors can still open it to move or delete it).
    const o = opts.pages || {};
    const shells = [...new Set([page.template, typeof o.layout === 'string' ? normalizePath(o.layout) : null, '/'])].filter((p) => p && TEMPLATE_RE.test(p));
    let res = null;
    for (const p of shells) {
      const r = await fetchStatic(env, url.origin, p);
      if (r.status === 200 && (r.headers.get('content-type') || '').includes('text/html')) { res = r; break; }
    }
    if (!res) return null;
    served.set(request, page);
    return shell(res, page, url);
  },

  // Every page made here, published or not, for the editor's page list.
  async pages({ env }) {
    return (await listPages(env)).map((p) => p.path);
  },

  render(ctx) {
    const page = served.get(ctx.request) || null;
    const o = ctx.opts.pages || {};
    ctx.share({
      page: page ? { path: page.path, title: page.title, template: page.template, live: page.live } : null,
      layout: typeof o.layout === 'string' ? normalizePath(o.layout) : null,
      textSection: typeof o.textSection === 'string' ? o.textSection : null,
    });
    if (!page) return;
    let meta = {};
    try { meta = JSON.parse((ctx.rows.get('#meta') || {}).html || '{}') || {}; } catch { meta = {}; }
    const title = meta.title || page.title;
    ctx.on('title', { element: (el) => el.setInnerContent(title) });
    // The template's description and share title describe another page: use this page's or none.
    if (!meta.description) {
      for (const sel of ['meta[name="description"]', 'meta[property="og:description"]', 'meta[name="twitter:description"]']) ctx.on(sel, { element: (el) => el.remove() });
    }
    if (!meta.shareTitle) {
      for (const sel of ['meta[property="og:title"]', 'meta[name="twitter:title"]']) ctx.on(sel, { element: (el) => el.setAttribute('content', title) });
    }
  },
};
