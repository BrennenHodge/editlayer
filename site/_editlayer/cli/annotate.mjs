// Marks the editable regions in built HTML files:
//   <main data-cms="main" data-cms-v="…">          page content (sections can be added/moved)
//   <header data-cms="@header" data-cms-v="…">     site-wide, shared by every page
//   <footer data-cms="@footer" data-cms-v="…">     site-wide, shared by every page
// data-cms-v is a hash of the original content, so the editor can tell when the developer later
// changed a region that editors have also edited. Run it after every build; it is idempotent.
//
// Menus that mark the current page: a site-wide header whose pages differ only by
// aria-current="page" on a link is still one site-wide region. Its hash ignores aria-current, and
// each page records its current link(s) on the region itself:
//   <header data-cms="@header" data-cms-v="…" data-cms-current="/services/">
// The Worker re-applies aria-current from that value whenever it renders the page
// (src/features/nav.js), so an edited menu still marks the right link on every page. The static file
// keeps its own aria-current, so pages nobody edited are served exactly as built.
// Value: space-separated hrefs, as written in the page. A href listed once marks the first link
// with that href in the region (repeated n times: the first n such links); every other link loses
// aria-current. Pages with no current link get data-cms-current="" (so a stale mark is removed).
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, sep } from 'node:path';

const IMAGE_EXT = /\.(webp|jpe?g|png|gif|avif)$/i;
const SKIP_IMAGE = /(^|\/)(favicon|apple-touch-icon|icon-\d|maskable|og-image|android-chrome)/i;
const CMS_ATTRS = /\s+data-cms(-v|-current)?="[^"]*"/g;
const CURRENT_ATTR = /\s+aria-current\s*=\s*(?:"page"|'page'|page(?=[\s/>]))/i;

function hash(s) {
  return createHash('sha256').update(s).digest('hex').slice(0, 12);
}

const attrValue = (tag, name) => {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\`]+))`, 'i').exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3]) : null;
};

/**
 * Splits a site-wide region's inner HTML into the part shared by every page (aria-current="page"
 * removed from links) and the hrefs of the links that were marked current on this page.
 */
export function splitCurrent(inner) {
  const current = [];
  const norm = inner.replace(/<a\b[^>]*>/gi, (tag) => {
    if (!CURRENT_ATTR.test(tag)) return tag;
    const href = attrValue(tag, 'href');
    if (href == null) return tag;
    current.push(href.trim().replace(/\s/g, (c) => encodeURIComponent(c)));
    return tag.replace(CURRENT_ATTR, '');
  });
  return { norm, current };
}

function setAttrs(openTag, key, v, current) {
  const cleaned = openTag.replace(CMS_ATTRS, '');
  const cur = current == null ? '' : ` data-cms-current="${current.join(' ').replace(/"/g, '&quot;')}"`;
  return cleaned.replace(/\s*(\/?)>$/, ` data-cms="${key}" data-cms-v="${v}"${cur}$1>`);
}

/**
 * Returns annotated HTML (unchanged if the page has no <main>). Region keys in `skip` are left unmarked.
 * `track`: site-wide region keys that get data-cms-current (annotateDir passes the keys where any page
 * marks a current link). Without it, a region gets data-cms-current only if this page marks one.
 * `collect(key, hash, current)` is called for every region found.
 */
export function annotateHtml(html, { skip = new Set(), collect = null, track = null } = {}) {
  const mainOpen = /<main\b[^>]*>/i.exec(html);
  const mainClose = html.toLowerCase().lastIndexOf('</main>');
  if (!mainOpen || mainClose < mainOpen.index) return html;
  const regions = [];
  const existing = /data-cms="([^"]+)"/.exec(mainOpen[0]);
  regions.push({ start: mainOpen.index, openLen: mainOpen[0].length, close: mainClose, key: existing && !existing[1].startsWith('@') ? existing[1] : 'main', tag: mainOpen[0] });

  // Site header: the first <header> before <main>.
  const before = html.slice(0, mainOpen.index);
  const hOpen = /<header\b[^>]*>/i.exec(before);
  if (hOpen) {
    const hClose = html.toLowerCase().indexOf('</header>', hOpen.index);
    if (hClose > -1 && hClose < mainOpen.index) regions.push({ start: hOpen.index, openLen: hOpen[0].length, close: hClose, key: '@header', tag: hOpen[0] });
  }
  // Site footer: the last <footer> after </main>.
  const afterIdx = mainClose + '</main>'.length;
  const tail = html.slice(afterIdx);
  let fOpen = null;
  for (const m of tail.matchAll(/<footer\b[^>]*>/gi)) fOpen = m;
  if (fOpen) {
    const fStart = afterIdx + fOpen.index;
    const fClose = html.toLowerCase().lastIndexOf('</footer>');
    if (fClose > fStart) regions.push({ start: fStart, openLen: fOpen[0].length, close: fClose, key: '@footer', tag: fOpen[0] });
  }

  regions.sort((a, b) => b.start - a.start);
  let out = html;
  for (const r of regions) {
    if (/data-cms-lock/.test(r.tag)) continue;
    const inner = out.slice(r.start + r.openLen, r.close);
    // Site-wide regions are compared across pages without the per-page "current link" mark.
    const { norm, current } = r.key.startsWith('@') ? splitCurrent(inner) : { norm: inner, current: [] };
    const h = hash(norm);
    if (collect) collect(r.key, h, current);
    if (skip.has(r.key)) {
      const clean = r.tag.replace(CMS_ATTRS, '');
      out = out.slice(0, r.start) + clean + out.slice(r.start + r.openLen);
      continue;
    }
    const tracked = r.key.startsWith('@') && (track ? track.has(r.key) : current.length > 0);
    const tag = setAttrs(r.tag, r.key, h, tracked ? current : null);
    out = out.slice(0, r.start) + tag + out.slice(r.start + r.openLen);
  }
  return out;
}

function walk(dir, exclude, files = []) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.') || name === 'node_modules' || exclude.includes(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, exclude, files);
    else files.push(p);
  }
  return files;
}

/** Annotates every HTML file under dir and writes editlayer-images.json (the site's images, for the picker). */
export function annotateDir(dir, { exclude = ['src', '_editlayer', 'engine'] } = {}) {
  const files = walk(dir, exclude);
  const htmlFiles = files.filter((x) => x.endsWith('.html'));
  // Site-wide regions are stored once for every page, so they must be identical on every page
  // (ignoring which menu link is marked as the current page). One that still differs stays developer-only.
  const seen = new Map();
  const track = new Set();
  for (const f of htmlFiles) {
    annotateHtml(readFileSync(f, 'utf8'), {
      collect: (key, h, current) => {
        if (!key.startsWith('@')) return;
        (seen.get(key) || seen.set(key, new Set()).get(key)).add(h);
        if (current.length) track.add(key);
      },
    });
  }
  const skip = new Set([...seen].filter(([, hashes]) => hashes.size > 1).map(([key]) => key));
  let pages = 0;
  for (const f of htmlFiles) {
    const html = readFileSync(f, 'utf8');
    const out = annotateHtml(html, { skip, track });
    if (out !== html) { writeFileSync(f, out); pages++; }
  }
  const images = files
    .map((f) => '/' + relative(dir, f).split(sep).join('/'))
    .filter((u) => IMAGE_EXT.test(u) && !SKIP_IMAGE.test(u))
    .sort()
    .map((url) => ({ url, name: url.split('/').pop() }));
  writeFileSync(join(dir, 'editlayer-images.json'), JSON.stringify(images, null, 0));
  return { pages, images: images.length, skipped: [...skip] };
}
