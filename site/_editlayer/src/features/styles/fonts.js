// Fonts editors can pick in Site styles. All are Google Fonts with a variable weight axis, so one
// request (wght@min..max) covers every weight. Never Fraunces.

export const STACKS = {
  sans: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  serif: 'ui-serif, Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, "SFMono-Regular", Consolas, monospace',
};

export const CURATED = [
  { name: 'Inter', category: 'sans', min: 100, max: 900 },
  { name: 'Work Sans', category: 'sans', min: 100, max: 900 },
  { name: 'DM Sans', category: 'sans', min: 100, max: 900 },
  { name: 'Manrope', category: 'sans', min: 200, max: 800 },
  { name: 'Public Sans', category: 'sans', min: 100, max: 900 },
  { name: 'Plus Jakarta Sans', category: 'sans', min: 200, max: 800 },
  { name: 'Outfit', category: 'sans', min: 100, max: 900 },
  { name: 'Figtree', category: 'sans', min: 300, max: 900 },
  { name: 'Source Sans 3', category: 'sans', min: 200, max: 900 },
  { name: 'Space Grotesk', category: 'sans', min: 300, max: 700 },
  { name: 'Source Serif 4', category: 'serif', min: 200, max: 900 },
  { name: 'Lora', category: 'serif', min: 400, max: 700 },
  { name: 'Playfair Display', category: 'serif', min: 400, max: 900 },
  { name: 'Newsreader', category: 'serif', min: 200, max: 800 },
];

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 ]{0,39}$/;
const banned = (name) => /fraunces/i.test(name);

/**
 * The fonts this site allows: the curated list plus the site's own (opts.styles.fonts:
 * [{ name, category, min, max, google }]). google: false means the site loads it itself.
 */
export function fontList(opts) {
  const list = CURATED.map((f) => ({ ...f, google: true }));
  const extra = (opts && opts.styles && Array.isArray(opts.styles.fonts)) ? opts.styles.fonts : [];
  for (const f of extra) {
    if (!f || !NAME_RE.test(String(f.name || '')) || banned(f.name)) continue;
    if (list.some((x) => x.name.toLowerCase() === String(f.name).toLowerCase())) continue;
    const min = clampWeight(f.min, 100);
    const max = clampWeight(f.max, 900);
    list.push({ name: String(f.name), category: STACKS[f.category] ? f.category : 'sans', min: Math.min(min, max), max: Math.max(min, max), google: f.google !== false, site: true });
  }
  return list.filter((f) => !banned(f.name)).map((f) => ({ ...f, css: fontCss(f), href: f.google ? googleHref([f]) : null }));
}

function clampWeight(v, fallback) {
  const n = Math.round(Number(v) / 100) * 100;
  return Number.isFinite(n) && n >= 100 && n <= 900 ? n : fallback;
}

export const fontCss = (f) => `"${f.name}", ${STACKS[f.category] || STACKS.sans}`;

export function googleHref(fonts) {
  const fam = fonts.map((f) => `family=${encodeURIComponent(f.name).replace(/%20/g, '+')}:wght@${f.min}..${f.max}`);
  return `https://fonts.googleapis.com/css2?${fam.join('&')}&display=swap`;
}

/**
 * Weights a Google Fonts stylesheet URL loads: Map family (lower case) → [[min, max], …].
 * "Geist:wght@400;500;600" → [[400,400],[500,500],[600,600]], "Inter:wght@100..900" → [[100,900]],
 * "Lora:ital,wght@0,400;1,700", old "/css?family=Roboto:400,700italic", no weights → [[400,400]].
 */
export function weightsIn(href) {
  const out = new Map();
  try {
    const u = new URL(href, 'https://fonts.googleapis.com');
    // css2 has one family per parameter; the old /css API joins them with "|".
    for (const fam of u.searchParams.getAll('family').flatMap((f) => f.split('|'))) {
      const [rawName, spec = ''] = fam.split(':');
      const name = rawName.replace(/\+/g, ' ').trim().toLowerCase();
      const ranges = [];
      if (spec.includes('@')) {
        const [axes, values] = spec.split('@');
        const i = axes.split(',').indexOf('wght');
        for (const tuple of values.split(';')) {
          const v = i < 0 ? '400' : (tuple.split(',')[i] || '');
          const [a, b = a] = v.split('..').map(Number);
          if (Number.isFinite(a) && Number.isFinite(b)) ranges.push([Math.min(a, b), Math.max(a, b)]);
        }
      } else {
        for (const v of spec.split(',')) { const n = parseInt(v, 10); if (n >= 100 && n <= 900) ranges.push([n, n]); }
        if (/(^|,)(bold|b)(,|$)/i.test(spec)) ranges.push([700, 700]);
      }
      if (!ranges.length) ranges.push([400, 400]);
      out.set(name, [...(out.get(name) || []), ...ranges]);
    }
  } catch { /* not a URL */ }
  return out;
}

/** Family names a Google Fonts stylesheet URL loads (lower case). */
export function familiesIn(href) {
  const out = [];
  try {
    const u = new URL(href, 'https://fonts.googleapis.com');
    for (const fam of u.searchParams.getAll('family')) out.push(fam.split(':')[0].replace(/\+/g, ' ').trim().toLowerCase());
  } catch { /* not a URL */ }
  return out;
}
