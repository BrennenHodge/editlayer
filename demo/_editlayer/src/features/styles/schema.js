// Which settings the Site styles panel offers, and strict checks for every value.
//
// A setting: { prop, type, label, ... }
//   color   any colour (#hex, rgb(), hsl())
//   font    a font from the allowed list (stored by name, written as a font stack)
//   weight  100–900 (min/max optional)
//   length  number + unit (unit: px|rem|em|%, min, max, step, ends: ['Sharp', 'Round'])
//   choice  one of options [{ value, label }] (value null = the site's original)
//   toggle  on / off values (e.g. uppercase / none)

export const PROP_RE = /^--[a-zA-Z][a-zA-Z0-9_-]{0,47}$/;
const N = '(?:\\d{1,3}(?:\\.\\d{1,4})?|\\.\\d{1,4})';
const SEP = '\\s*[,\\s]\\s*';
const ALPHA = `(?:\\s*[,/]\\s*${N}%?)?`;
const HEX_RE = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_RE = new RegExp(`^rgba?\\(\\s*${N}%?${SEP}${N}%?${SEP}${N}%?${ALPHA}\\s*\\)$`, 'i');
const HSL_RE = new RegExp(`^hsla?\\(\\s*${N}(?:deg)?${SEP}${N}%${SEP}${N}%${ALPHA}\\s*\\)$`, 'i');
const LEN_RE = /^(\d{1,4}(?:\.\d{1,3})?|\.\d{1,3})(px|rem|em|%)$/;
const NUM_RE = /^\d{1,2}(?:\.\d{1,3})?$/;
const WORD_RE = /^[a-z][a-z-]{0,19}$/;

export const isColor = (v) => typeof v === 'string' && v.length <= 64 && (HEX_RE.test(v) || RGB_RE.test(v) || HSL_RE.test(v));
export const isLength = (v) => typeof v === 'string' && (LEN_RE.test(v) || v === '0');
export const isWeight = (v) => /^[1-9]00$/.test(String(v));
/** Anything a stored value may be at render time: a second, type-blind check before writing CSS. */
export const isSafeValue = (v) => typeof v === 'string' && (isColor(v) || isLength(v) || isWeight(v) || NUM_RE.test(v) || WORD_RE.test(v));

export const GROUP_LABELS = { colours: 'Colours', fonts: 'Fonts', weights: 'Text weight', corners: 'Corners', buttons: 'Buttons', spacing: 'Spacing' };
const GROUP_ORDER = ['colours', 'fonts', 'weights', 'corners', 'buttons', 'spacing'];

/** The standard properties a site can adopt (see README "Site styles"). */
export const STANDARD = [
  { group: 'fonts', prop: '--font-heading', type: 'font', label: 'Headings' },
  { group: 'fonts', prop: '--font-body', type: 'font', label: 'Body text' },
  { group: 'weights', prop: '--weight-heading', type: 'weight', label: 'Headings' },
  { group: 'weights', prop: '--weight-body', type: 'weight', label: 'Body text', min: 300, max: 600 },
  { group: 'corners', prop: '--radius', type: 'length', label: 'Cards, pictures and boxes', unit: 'px', min: 0, max: 24, step: 1, ends: ['Sharp', 'Round'] },
  { group: 'buttons', prop: '--radius-btn', type: 'choice', label: 'Shape', options: [
    { value: null, label: 'Match corners' }, { value: '0px', label: 'Square' }, { value: '6px', label: 'Rounded' }, { value: '999px', label: 'Pill' },
  ] },
  { group: 'buttons', prop: '--weight-button', type: 'weight', label: 'Text weight' },
  { group: 'buttons', prop: '--btn-case', type: 'toggle', label: 'All capitals', on: 'uppercase', off: 'none' },
  { group: 'spacing', prop: '--space-scale', type: 'choice', label: 'Space around sections', options: [
    { value: '0.75', label: 'Compact' }, { value: '1', label: 'Normal' }, { value: '1.35', label: 'Airy' },
  ] },
];

const str = (v, max = 80) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);

/** Cleans one setting from site options; returns null if it can't be used. */
function cleanSetting(s) {
  if (!s || !PROP_RE.test(String(s.prop || ''))) return null;
  const type = String(s.type || 'color');
  const out = { prop: s.prop, type, label: str(s.label) || humanize(s.prop) };
  if (s.hint) out.hint = str(s.hint, 120);
  if (type === 'color' || type === 'font') return out;
  if (type === 'weight') {
    out.min = isWeight(s.min) ? +s.min : 100;
    out.max = isWeight(s.max) ? +s.max : 900;
    return out;
  }
  if (type === 'length') {
    out.unit = ['px', 'rem', 'em', '%'].includes(s.unit) ? s.unit : 'px';
    out.min = Number.isFinite(+s.min) ? +s.min : 0;
    out.max = Number.isFinite(+s.max) && +s.max > out.min ? +s.max : out.min + 24;
    out.step = Number.isFinite(+s.step) && +s.step > 0 ? +s.step : (out.unit === 'px' ? 1 : 0.05);
    if (Array.isArray(s.ends)) out.ends = s.ends.slice(0, 2).map((e) => str(e, 24));
    return out;
  }
  if (type === 'choice') {
    const opts = (Array.isArray(s.options) ? s.options : []).map((o) => ({
      value: o.value === null || o.value === undefined ? null : String(o.value),
      label: str(o.label, 30),
    })).filter((o) => o.label && (o.value === null || isSafeValue(o.value))).slice(0, 8);
    if (opts.length < 2) return null;
    out.options = opts;
    return out;
  }
  if (type === 'toggle') {
    const on = String(s.on ?? ''); const off = String(s.off ?? '');
    if (!isSafeValue(on) || !isSafeValue(off) || on === off) return null;
    Object.assign(out, { on, off });
    return out;
  }
  return null;
}

/** "--gold-soft" → "Gold soft". */
export function humanize(prop) {
  const words = { bg: 'background', fg: 'text', btn: 'button', hdr: 'header', ftr: 'footer', clr: '', c: '', color: '', colour: '' };
  const parts = prop.replace(/^--/, '').split(/[-_]+/).map((w) => (w.toLowerCase() in words ? words[w.toLowerCase()] : w)).filter(Boolean);
  const s = parts.join(' ').trim() || prop;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function cleanContrast(list) {
  return (Array.isArray(list) ? list : []).map((p) => {
    const ok = (v) => PROP_RE.test(String(v)) || isColor(String(v));
    if (!p || !ok(p.text) || !ok(p.on)) return null;
    return { text: String(p.text), on: String(p.on), label: str(p.label, 100) || `${humanize(String(p.text))} on ${humanize(String(p.on)).toLowerCase()}`, min: Number(p.min) >= 1 && Number(p.min) <= 21 ? Number(p.min) : 4.5 };
  }).filter(Boolean).slice(0, 40);
}

function sortGroups(groups) {
  const rank = (g) => { const i = GROUP_ORDER.indexOf(g.id); return i < 0 ? 50 : i; };
  return groups.filter((g) => g.settings.length).sort((a, b) => rank(a) - rank(b));
}

function standardGroups(vars) {
  const groups = new Map();
  for (const s of STANDARD) {
    if (vars && !vars.has(s.prop)) continue;
    if (!groups.has(s.group)) groups.set(s.group, { id: s.group, label: GROUP_LABELS[s.group], settings: [] });
    const { group, ...rest } = s;
    groups.get(s.group).settings.push(cleanSetting(rest));
  }
  return [...groups.values()];
}

/**
 * The settings for this site.
 * - opts.styles.groups: [{ id, label, settings: [...] } | 'standard'] declared by the site. 'standard'
 *   adds the standard groups for the standard properties the site's stylesheet defines.
 * - Otherwise: discovered from the :root custom properties in the site's stylesheets: every colour,
 *   plus the standard controls for the standard properties it uses.
 * vars: Map prop → raw value from the site's :root (null if the stylesheets couldn't be read).
 */
export function buildSchema(opts, vars) {
  const cfg = opts && opts.styles;
  let groups = [];
  let contrast = [];
  let auto = false;
  if (cfg && Array.isArray(cfg.groups)) {
    for (const g of cfg.groups) {
      if (g === 'standard') { groups.push(...standardGroups(vars)); continue; }
      if (!g || !Array.isArray(g.settings)) continue;
      const id = /^[a-z0-9-]{1,30}$/.test(String(g.id || '')) ? g.id : `g${groups.length}`;
      groups.push({ id, label: str(g.label, 40) || GROUP_LABELS[id] || 'Settings', settings: g.settings.map(cleanSetting).filter(Boolean) });
    }
    contrast = cleanContrast(cfg.contrast);
  } else if (vars) {
    auto = true;
    const standard = new Set(STANDARD.map((s) => s.prop));
    const colours = [...vars].filter(([p, v]) => !standard.has(p) && isColor(v.trim())).map(([p]) => ({ prop: p, type: 'color', label: humanize(p) }));
    groups.push({ id: 'colours', label: 'Colours', settings: colours.slice(0, 40) }, ...standardGroups(vars));
    contrast = guessContrast(colours.map((c) => c.prop));
  }
  // One setting per property, first one wins.
  const seen = new Set();
  for (const g of groups) g.settings = g.settings.filter((s) => (seen.has(s.prop) ? false : seen.add(s.prop)));
  return { groups: sortGroups(groups), contrast, auto };
}

/** Text/background pairs to check when the site didn't list any (only warned about once they get worse). */
function guessContrast(props) {
  const text = props.filter((p) => /(^|-)(text|ink|fg|foreground|body|muted|heading)(-|$)/i.test(p.slice(2)));
  const bg = props.filter((p) => /(^|-)(bg|background|paper|surface|white|base|page|canvas)(-|$)/i.test(p.slice(2)));
  const pairs = [];
  for (const t of text) for (const b of bg) if (t !== b) pairs.push({ text: t, on: b, label: `${humanize(t)} on ${humanize(b).toLowerCase()}`, min: 4.5 });
  return pairs.slice(0, 24);
}

export function settingsByProp(schema) {
  const m = new Map();
  for (const g of schema.groups) for (const s of g.settings) m.set(s.prop, s);
  return m;
}

const bad = (msg) => Object.assign(new Error(msg), { status: 400 });

/**
 * Checks a theme sent by the editor against the site's settings. Throws (plain words) on anything
 * unknown or invalid. Returns { props, fonts } with only known, valid entries.
 */
export function validateTheme(value, schema, fonts) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw bad('Site styles couldn’t be saved. Reload the page and try again.');
  const byProp = settingsByProp(schema);
  const props = {};
  const outFonts = {};
  const inProps = value.props && typeof value.props === 'object' ? value.props : {};
  const inFonts = value.fonts && typeof value.fonts === 'object' ? value.fonts : {};
  if (Object.keys(inProps).length > 80 || Object.keys(inFonts).length > 8) throw bad('Too many style settings.');
  for (const [prop, raw] of Object.entries(inProps)) {
    const s = byProp.get(prop);
    if (!s || s.type === 'font') throw bad('One of the style settings isn’t used on this site. Reload the page and try again.');
    const v = String(raw ?? '').trim();
    const name = `“${s.label}”`;
    if (s.type === 'color') {
      if (!isColor(v)) throw bad(`${name} needs a colour such as #1a2b3c.`);
    } else if (s.type === 'weight') {
      if (!isWeight(v) || +v < s.min || +v > s.max) throw bad(`${name} must be a weight from ${s.min} to ${s.max}.`);
    } else if (s.type === 'length') {
      const m = LEN_RE.exec(v);
      const n = v === '0' ? 0 : m ? +m[1] : NaN;
      if (!(m || v === '0') || (m && m[2] !== s.unit) || n < s.min || n > s.max) throw bad(`${name} is out of range.`);
    } else if (s.type === 'choice') {
      if (!s.options.some((o) => o.value !== null && o.value === v)) throw bad(`${name} isn’t one of the choices.`);
    } else if (s.type === 'toggle') {
      if (v !== s.on && v !== s.off) throw bad(`${name} isn’t valid.`);
    } else {
      throw bad('One of the style settings isn’t valid.');
    }
    props[prop] = v;
  }
  for (const [prop, raw] of Object.entries(inFonts)) {
    const s = byProp.get(prop);
    if (!s || s.type !== 'font') throw bad('One of the font settings isn’t used on this site. Reload the page and try again.');
    const f = fonts.find((x) => x.name === String(raw));
    if (!f) throw bad(`That font isn’t one of the choices for “${s.label}”.`);
    outFonts[prop] = f.name;
  }
  return { props, fonts: outFonts };
}

/** Parses a stored theme. Returns null if missing or broken. */
export function parseTheme(text) {
  try {
    const t = JSON.parse(text);
    if (!t || typeof t !== 'object') return null;
    const props = t.props && typeof t.props === 'object' && !Array.isArray(t.props) ? t.props : {};
    const fonts = t.fonts && typeof t.fonts === 'object' && !Array.isArray(t.fonts) ? t.fonts : {};
    return { props, fonts };
  } catch { return null; }
}

/** The :root rule for a stored theme, re-checking every entry. Returns '' when there's nothing to write. */
export function themeCss(theme, fonts) {
  const decl = [];
  for (const [p, v] of Object.entries(theme.props)) if (PROP_RE.test(p) && isSafeValue(v)) decl.push(`${p}:${v}`);
  for (const [p, name] of Object.entries(theme.fonts)) {
    const f = PROP_RE.test(p) && fonts.find((x) => x.name === name);
    if (f) decl.push(`${p}:${f.css}`);
  }
  return decl.length ? `:root{${decl.join(';')}}` : '';
}
