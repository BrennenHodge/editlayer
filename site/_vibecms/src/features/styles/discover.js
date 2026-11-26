// Reads the custom properties a site defines on :root, from its own stylesheets (static assets).

const ORIGIN = 'https://vibecms.local';
const TTL = 5 * 60 * 1000;
const MAX_SHEETS = 6;
const MAX_CSS = 600_000;
let cache = null; // { at, vars }

/**
 * Map prop → raw value for every custom property set in a top-level `:root` / `html` rule of the
 * stylesheets linked from the page (same-site files only). null if nothing could be read.
 */
export async function siteVars(env, path = '/') {
  if (cache && Date.now() - cache.at < TTL) return cache.vars;
  let vars = null;
  try {
    const hrefs = await sheetsOf(env, path) || (path !== '/' ? await sheetsOf(env, '/') : null) || [];
    const css = [];
    for (const href of hrefs.slice(0, MAX_SHEETS)) {
      const res = await env.ASSETS.fetch(new Request(new URL(href, ORIGIN)));
      if (res.ok && (res.headers.get('content-type') || '').includes('css')) css.push((await res.text()).slice(0, MAX_CSS));
      else if (res.body) await res.body.cancel();
    }
    if (css.length) vars = rootVars(css.join('\n'));
  } catch (err) {
    console.error('vibecms styles: could not read the site stylesheets', err && err.stack || err);
  }
  cache = { at: Date.now(), vars };
  return vars;
}

async function sheetsOf(env, path) {
  const res = await env.ASSETS.fetch(new Request(new URL(path, ORIGIN)));
  if (!res.ok || !(res.headers.get('content-type') || '').includes('text/html')) { if (res.body) await res.body.cancel(); return null; }
  const hrefs = [];
  await new HTMLRewriter().on('link[rel~="stylesheet"][href]', {
    element(el) {
      const href = el.getAttribute('href') || '';
      // Same-site files only: "/styles.css", "styles.css", never "//cdn…" or "https://…".
      if (/^(?![a-z][a-z0-9+.-]*:|\/\/)[^\s"'<>]+$/i.test(href)) hrefs.push(new URL(href, new URL(path, ORIGIN)).pathname);
    },
  }).transform(res).text();
  return hrefs.length ? hrefs : null;
}

/** Custom properties from top-level :root / html rules, in source order (first definition wins). */
export function rootVars(css) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const vars = new Map();
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) break;
    const selector = css.slice(i, open).trim();
    const close = matching(css, open);
    if (close < 0) break;
    if (!selector.startsWith('@') && selector.split(',').some((s) => /^(:root|html)$/i.test(s.trim()))) {
      for (const decl of css.slice(open + 1, close).split(';')) {
        const m = /^\s*(--[a-zA-Z][a-zA-Z0-9_-]*)\s*:\s*([\s\S]+?)\s*$/.exec(decl);
        if (m && !vars.has(m[1])) vars.set(m[1], m[2].replace(/\s*!important$/i, ''));
      }
    }
    i = close + 1;
  }
  return vars;
}

function matching(css, open) {
  let depth = 0;
  for (let j = open; j < css.length; j++) {
    if (css[j] === '{') depth++;
    else if (css[j] === '}' && --depth === 0) return j;
  }
  return -1;
}
