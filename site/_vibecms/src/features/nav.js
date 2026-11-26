// Menu editor, Worker side: keeps aria-current="page" right in site-wide menus.
//
// `vibecms annotate` records, on a site-wide region whose pages differ only by which menu link is
// marked current, the current link(s) of each page: <header data-cms="@header" data-cms-current="/services/">.
// The header an editor saved was edited on one page and may carry that page's aria-current, so
// whenever a page is rendered (visitors, previews and edit mode) this sets aria-current="page" on the
// recorded link(s) and removes it from every other link in the region.
// Value: space-separated hrefs. A href listed once marks the first link with that href (listed n
// times: the first n), so a page linked from both a menu and its own dropdown is marked once, like the build did.
// Pages nobody edited are served untouched (the static file already has the right mark).
import { normalizePath } from '../util.js';

const ENTITIES = { '&amp;': '&', '&quot;': '"', '&#39;': "'", '&#x27;': "'", '&lt;': '<', '&gt;': '>' };
const decode = (s) => String(s || '').replace(/&(amp|quot|#39|#x27|lt|gt);/gi, (m) => ENTITIES[m.toLowerCase()] || m);

/** Comparable form of a link: same-site links become "/path/?query#hash", others stay as written. */
export function linkKey(href, base) {
  const raw = decode(href).trim();
  if (!raw) return '';
  try {
    const u = new URL(raw, base);
    if (u.origin !== new URL(base).origin) return u.href;
    return normalizePath(u.pathname) + u.search + u.hash;
  } catch {
    return raw;
  }
}

/** Parses data-cms-current into Map<linkKey, how many links to mark>. */
export function currentCounts(value, base) {
  const counts = new Map();
  for (const tok of String(value || '').split(/\s+/)) {
    if (!tok) continue;
    let href = tok;
    try { href = decodeURIComponent(tok); } catch { /* keep as written */ }
    const k = linkKey(href, base);
    if (k) counts.set(k, (counts.get(k) || 0) + 1);
  }
  return counts;
}

export default {
  name: 'nav',
  render(ctx) {
    const base = ctx.url.href;
    let counts = null; // set while inside an element that has data-cms-current
    let depth = 0;
    // "After" pass: sees the edited header that the first pass swapped in.
    ctx.onAfter('[data-cms-current]', {
      element(el) {
        depth++;
        if (depth === 1) counts = currentCounts(el.getAttribute('data-cms-current'), base);
        try {
          el.onEndTag(() => { depth--; if (!depth) counts = null; });
        } catch { /* void element: nothing inside */ depth--; if (!depth) counts = null; }
      },
    });
    ctx.onAfter('[data-cms-current] a', {
      element(el) {
        if (!counts) return;
        const href = el.getAttribute('href');
        const k = href == null ? '' : linkKey(href, base);
        const left = k ? counts.get(k) || 0 : 0;
        if (left > 0) {
          counts.set(k, left - 1);
          el.setAttribute('aria-current', 'page');
        } else if ((el.getAttribute('aria-current') || '').toLowerCase() === 'page') {
          el.removeAttribute('aria-current');
        }
      },
    });
  },
};
