// Whole-section tools, Worker side.
//
// - Section settings (background, spacing, alignment, show on) are attributes and classes on the
//   section element, saved with the page region. Visitors get a tiny stylesheet for the generic
//   attributes, only on pages whose served HTML uses them. Photo backgrounds are rebuilt here from
//   validated attributes, so a stored style can never point anywhere else.
// - Shared sections: a section marked data-cms="@s-<id>" is a site-wide region (path "*"). The page
//   keeps the element as a placeholder; render() swaps in the stored HTML on every page that uses it.
//   Names and the section element's own settings live in the "@sections" data key (draft → publish).
// - The section library reads ready-made blocks from /vibecms-blocks.html, which only editors can open.
import { json } from '../util.js';

const ID_RE = /^[a-z0-9]{4,16}$/;
const TAGS = new Set(['section', 'div', 'aside', 'article', 'figure', 'header', 'footer', 'nav', 'form']);
const SPACE = new Set(['compact', 'roomy']);
const ALIGN = new Set(['center']);
const SHOW = new Set(['phone', 'large']);
const SRC_RE = /^\/(?!\/)[A-Za-z0-9._~/%-]{1,300}$/;
const FOCUS_RE = /^(\d{1,3})% (\d{1,3})%$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{1,60}$/;
// Class names on a shared section: anything a stylesheet can target (md:grid, w-1/2), never quotes or markup.
const CLASS_RE = /^[^\s"'<>&`=\\]{1,80}$/;
const ATTR_RE = /data-cms-(space|align|show|bg)\b/;
const SETTING_ATTRS = ['data-cms-space', 'data-cms-align', 'data-cms-show', 'data-cms-bg', 'data-cms-focus'];
export const BLOCKS_PATHS = ['/vibecms-blocks.html', '/vibecms-blocks', '/vibecms-blocks/'];
export const OVERLAY = 'rgba(10,12,16,.62)';

function config(opts) {
  const o = (opts && opts.sections) || {};
  const backgrounds = Array.isArray(o.backgrounds) ? o.backgrounds
    .filter((b) => b && typeof b.label === 'string')
    .map((b) => ({ label: b.label.slice(0, 40), class: String(b.class || '').split(/\s+/).filter((t) => TOKEN_RE.test(t)).join(' ') }))
    .slice(0, 12) : [];
  const photoClass = String(o.photoClass || '').split(/\s+/).filter((t) => TOKEN_RE.test(t)).join(' ');
  return { backgrounds, photoClass, blocks: BLOCKS_PATHS[0] };
}

const cleanName = (v) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
const cleanTokens = (v, max = 20, re = TOKEN_RE) => String(v ?? '').split(/\s+/).filter((t) => re.test(t)).slice(0, max).join(' ');

function cleanFocus(v) {
  const m = FOCUS_RE.exec(String(v || ''));
  if (!m) return null;
  const x = Math.min(100, +m[1]);
  const y = Math.min(100, +m[2]);
  return `${x}% ${y}%`;
}

/** The section element's own attributes that travel with a shared section. Everything is validated. */
export function cleanAttrs(a) {
  const out = {};
  if (!a || typeof a !== 'object') return out;
  if (a.class != null) out.class = cleanTokens(a.class, 30, CLASS_RE);
  if (SPACE.has(a['data-cms-space'])) out['data-cms-space'] = a['data-cms-space'];
  if (ALIGN.has(a['data-cms-align'])) out['data-cms-align'] = a['data-cms-align'];
  if (SHOW.has(a['data-cms-show'])) out['data-cms-show'] = a['data-cms-show'];
  if (typeof a['data-cms-bg'] === 'string' && SRC_RE.test(a['data-cms-bg']) && !a['data-cms-bg'].includes('..')) {
    out['data-cms-bg'] = a['data-cms-bg'];
    out['data-cms-focus'] = cleanFocus(a['data-cms-focus']) || '50% 50%';
  }
  if (a.id != null && TOKEN_RE.test(a.id)) out.id = a.id;
  if (a['aria-labelledby'] != null) { const v = cleanTokens(a['aria-labelledby'], 4); if (v) out['aria-labelledby'] = v; }
  if (a['aria-label'] != null) { const v = cleanName(a['aria-label']).slice(0, 120); if (v) out['aria-label'] = v; }
  if (a.role != null && /^[a-z]{1,20}$/.test(a.role)) out.role = a.role;
  return out;
}

/** HTMLRewriter returns attribute values as written, with entities (&quot;) still encoded. */
const ENT = { quot: '"', amp: '&', lt: '<', gt: '>', apos: "'" };
export function decodeAttr(v) {
  return String(v || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; }
    return ENT[e.toLowerCase()] ?? m;
  });
}
const otherStyles = (style) => decodeAttr(style).split(';').map((s) => s.trim()).filter((s) => s && !/^background/i.test(s));

export function bgStyle(src, focus, rest = '') {
  const keep = String(rest || '').split(';').map((s) => s.trim()).filter((s) => s && !/^background/i.test(s));
  return [...keep, `background-image:linear-gradient(${OVERLAY},${OVERLAY}),url(${src})`, 'background-size:cover',
    `background-position:${focus}`, 'background-repeat:no-repeat'].join(';');
}

function readMap(row) {
  if (!row) return {};
  try {
    const m = JSON.parse(row.html);
    return m && typeof m === 'object' && !Array.isArray(m) ? m : {};
  } catch { return {}; }
}

async function currentMap(env) {
  const { results } = await env.CMS_DB.prepare("SELECT state, html FROM cms_regions WHERE path = '*' AND key = '@sections'").all();
  const row = results.find((r) => r.state === 'draft') || results.find((r) => r.state === 'live');
  return readMap(row);
}

/** "@sections" draft key: the editor sends a patch { set: { id: {name?, tag?, attrs?} }, remove: [id] }. */
async function serializeMap(value, { env }) {
  const patch = value && typeof value === 'object' ? value : {};
  const map = await currentMap(env);
  for (const [id, e] of Object.entries(patch.set || {})) {
    if (!ID_RE.test(id)) throw new Error('That shared section has an unexpected name.');
    if (!e || typeof e !== 'object') continue;
    const next = { ...(map[id] || {}) };
    if ('name' in e) next.name = cleanName(e.name) || 'Shared section';
    if ('tag' in e) next.tag = TAGS.has(String(e.tag).toLowerCase()) ? String(e.tag).toLowerCase() : 'section';
    if ('attrs' in e) next.attrs = cleanAttrs(e.attrs);
    map[id] = next;
  }
  for (const id of Array.isArray(patch.remove) ? patch.remove : []) if (ID_RE.test(String(id))) delete map[id];
  if (Object.keys(map).length > 300) throw new Error('There are too many shared sections. Stop sharing some first.');
  return JSON.stringify(map);
}

/** Applies a shared section's stored settings to its placeholder on the page. */
function applyAttrs(el, attrs) {
  const a = cleanAttrs(attrs);
  if ('class' in a) { if (a.class) el.setAttribute('class', a.class); else el.removeAttribute('class'); }
  for (const name of SETTING_ATTRS) {
    if (a[name]) el.setAttribute(name, a[name]); else el.removeAttribute(name);
  }
  if (!a['data-cms-bg']) {
    const style = el.getAttribute('style');
    if (style && /background-image:linear-gradient\(rgba\(10,12,16/.test(style)) {
      const rest = otherStyles(style).join(';');
      if (rest) el.setAttribute('style', rest); else el.removeAttribute('style');
    }
  }
}

/** Rebuilds a photo background from its validated attributes (drops it if invalid). */
function fixBg(el) {
  const raw = el.getAttribute('data-cms-bg');
  if (raw === null) return;
  const src = decodeAttr(raw);
  const rest = otherStyles(el.getAttribute('style')).join(';');
  if (!SRC_RE.test(src) || src.includes('..')) {
    el.removeAttribute('data-cms-bg');
    el.removeAttribute('data-cms-focus');
    const keep = rest;
    if (keep) el.setAttribute('style', keep); else el.removeAttribute('style');
    return;
  }
  const focus = cleanFocus(decodeAttr(el.getAttribute('data-cms-focus'))) || '50% 50%';
  el.setAttribute('data-cms-focus', focus);
  el.setAttribute('style', bgStyle(src, focus, rest));
}

const attrsUseStyles = (attrs) => Boolean(attrs) && Object.keys(attrs).some((k) => /^data-cms-(space|align|show)$/.test(k));

/** True if the page's served HTML uses the generic section attributes (so visitors need the stylesheet). */
function needsStyles(rows, map) {
  for (const row of rows.values()) {
    if (row.key === '@sections' || row.key.startsWith('@s-') || row.key.startsWith('#')) continue;
    if (ATTR_RE.test(row.html)) return true;
    for (const m of row.html.matchAll(/data-cms="@s-([a-z0-9]+)"/g)) {
      const shared = rows.get(`@s-${m[1]}`);
      if (shared && ATTR_RE.test(shared.html)) return true;
      if (attrsUseStyles(map[m[1]] && map[m[1]].attrs)) return true;
    }
  }
  return false;
}

/** Visitor styles for the generic attributes. While editing, "show on" never hides anything. */
export function sectionCss(cfg) {
  const photo = cfg.photoClass ? '' : ':root [data-cms-bg]{color:#fff}:root [data-cms-bg] :is(h1,h2,h3,h4,p,li,dt,dd,blockquote,figcaption,small){color:inherit}';
  return ':root [data-cms-space="compact"]{padding-top:clamp(28px,4.5vw,56px);padding-bottom:clamp(28px,4.5vw,56px)}'
    + ':root [data-cms-space="roomy"]{padding-top:clamp(96px,12vw,176px);padding-bottom:clamp(96px,12vw,176px)}'
    + ':root [data-cms-align="center"]{text-align:center}'
    + ':root [data-cms-align="center"] :is(h1,h2,h3,h4,h5,h6,p,blockquote,ul,ol,dl,form,figure){margin-left:auto;margin-right:auto}'
    + ':root [data-cms-align="center"] :is([class*="btn-row"],[class*="buttons"],[class*="actions"],[class*="eyebrow"],[class*="facts"],[class*="chips"],[class*="kicker"]){justify-content:center}'
    + '@media (min-width:768px){html:not(.vibecms-on) [data-cms-show="phone"]{display:none!important}}'
    + '@media (max-width:767.98px){html:not(.vibecms-on) [data-cms-show="large"]{display:none!important}}'
    + photo;
}

async function listShared(ctx) {
  const db = ctx.env.CMS_DB;
  const { results } = await db.prepare("SELECT key, state, html, updated_at FROM cms_regions WHERE path = '*' AND (key LIKE '@s-%' OR key = '@sections')").all();
  const pick = new Map();
  for (const r of results) { const cur = pick.get(r.key); if (!cur || r.state === 'draft') pick.set(r.key, r); }
  const map = readMap(pick.get('@sections'));
  const { results: uses } = await db.prepare("SELECT DISTINCT path, html FROM cms_regions WHERE path != '*' AND html LIKE ?").bind('%data-cms="@s-%').all();
  const pagesOf = new Map();
  for (const u of uses) {
    for (const m of u.html.matchAll(/data-cms="@s-([a-z0-9]+)"/g)) {
      if (!pagesOf.has(m[1])) pagesOf.set(m[1], new Set());
      pagesOf.get(m[1]).add(u.path);
    }
  }
  const shared = [];
  for (const [key, row] of pick) {
    if (!key.startsWith('@s-')) continue;
    const id = key.slice(3);
    const e = map[id] || {};
    shared.push({
      id, key, name: e.name || 'Shared section', tag: e.tag || 'section', attrs: cleanAttrs(e.attrs),
      html: row.html, draft: row.state === 'draft', updatedAt: row.updated_at, pages: [...(pagesOf.get(id) || [])].sort(),
    });
  }
  shared.sort((a, b) => a.name.localeCompare(b.name));
  return json({ shared });
}

/** Only signed-in editors can open the blocks page; visitors get the site's 404 page. */
async function guardBlocks(ctx, res) {
  if (await ctx.getUser()) return res;
  const missing = await ctx.env.ASSETS.fetch(new Request(new URL('/__vibecms-not-found__', ctx.url)));
  const headers = new Headers(missing.headers);
  headers.set('cache-control', 'no-store');
  headers.set('x-robots-tag', 'noindex');
  return new Response(missing.body, { status: 404, headers });
}

/** Keeps the blocks page out of the sitemap even if a build lists it. */
async function sitemap(ctx, res) {
  if (!res.ok) return res;
  const text = await res.clone().text();
  if (!text.includes('vibecms-blocks')) return res;
  const out = text.replace(/\s*<url>(?:(?!<\/url>)[\s\S])*vibecms-blocks(?:(?!<\/url>)[\s\S])*<\/url>/g, '');
  const headers = new Headers(res.headers);
  headers.delete('content-length');
  headers.delete('etag');
  return new Response(out, { status: res.status, headers });
}

export default {
  name: 'sections',
  keys: { '@sections': serializeMap },
  api: [{ method: 'GET', route: 'sections', role: 'author', handler: listShared }],
  assets: {
    ...Object.fromEntries(BLOCKS_PATHS.map((p) => [p, guardBlocks])),
    '/sitemap.xml': sitemap,
  },
  render(ctx) {
    const cfg = config(ctx.opts);
    const map = readMap(ctx.rows.get('@sections'));
    if (ctx.editing) ctx.share({ backgrounds: cfg.backgrounds, photoClass: cfg.photoClass, blocks: cfg.blocks, shared: map });

    if (ctx.editing || needsStyles(ctx.rows, map)) ctx.head(`<style data-vibecms-sections>${sectionCss(cfg)}</style>`);

    const hasShared = [...ctx.rows.keys()].some((k) => k.startsWith('@s-')) || Object.keys(map).length > 0;
    if (hasShared) {
      // Shared sections sit inside page regions, so they are swapped in on the first pass's output.
      ctx.onAfter('[data-cms^="@s-"]', {
        element(el) {
          const key = el.getAttribute('data-cms');
          const id = key.slice(3);
          if (!ID_RE.test(id)) return;
          const row = ctx.rows.get(key);
          if (row) el.setInnerContent(row.html, { html: true });
          if (map[id] && map[id].attrs) applyAttrs(el, map[id].attrs);
          fixBg(el);
        },
      });
    }
    if (ctx.editing || [...ctx.rows.values()].some((r) => r.html.includes('data-cms-bg'))) ctx.onAfter('[data-cms-bg]', { element: fixBg });
  },
};
