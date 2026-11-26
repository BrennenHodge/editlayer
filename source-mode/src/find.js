// Find: from a piece of text an editor clicked on a page, to the place in the site's source code it comes from.
//
// 1. Search every source file for the text as a literal (entities decoded, whitespace collapsed).
// 2. Keep only matches that sit in text the page shows: JSX text, a string literal that isn't an import, a class
//    name or similar, Markdown or HTML text outside tags.
// 3. Several matches: score each by how many of the clicked section's other texts are in the same file (and how
//    close they are). A clear winner is used; otherwise the editor is asked.

import ts from 'typescript';
import { normalizeWithMap, norm, occurrences, lineCol } from './text.js';

const CODE_EXT = /\.(tsx|ts|jsx|js|mjs|cjs|mts|cts)$/i;
const MARKUP_EXT = /\.(html?|md|mdx|markdown|astro|vue|svelte|njk|liquid|hbs|ejs)$/i;
const JSON_EXT = /\.json$/i;
/** How to read a file's text: JSX expressions, JS escapes. */
export const readOpts = (file) => ({ jsx: /\.(tsx|jsx|astro)$/i.test(file), js: CODE_EXT.test(file) || JSON_EXT.test(file) });

export const SEARCHABLE = /\.(tsx|ts|jsx|js|mjs|cjs|mts|cts|html?|md|mdx|markdown|astro|vue|svelte|njk|liquid|hbs|ejs|json)$/i;

// Attributes whose values never show on the page.
const NON_TEXT_ATTRS = new Set([
  'className', 'class', 'id', 'key', 'style', 'type', 'name', 'rel', 'target', 'role', 'htmlFor', 'for', 'src',
  'srcSet', 'href', 'to', 'variant', 'size', 'as', 'method', 'action', 'autoComplete', 'inputMode', 'loading',
  'decoding', 'fetchPriority', 'viewBox', 'd', 'fill', 'stroke', 'xmlns', 'data-testid', 'pattern', 'lang',
]);
// Object keys whose values never show on the page. Shorter than the attribute list: in data arrays,
// { name, title, label, body } are page text.
const NON_TEXT_KEYS = new Set(['className', 'class', 'id', 'key', 'style', 'href', 'src', 'srcSet', 'to', 'slug', 'path',
  'url', 'icon', 'image', 'img', 'photo', 'logo', 'variant', 'size', 'type', 'as', 'target', 'rel', 'color', 'bg',
  'background', 'tone', 'theme', 'route', 'file', 'video', 'poster', 'lat', 'lng', 'zip', 'email']);
// Call names whose string arguments aren't page text.
const NON_TEXT_CALLS = new Set(['require', 'import', 'cn', 'clsx', 'twMerge', 'cva', 'fetch', 'useQuery', 'console.log',
  'console.error', 'console.warn', 'querySelector', 'querySelectorAll', 'getElementById', 'addEventListener']);

const scriptKind = (file) => {
  if (/\.tsx$/i.test(file)) return ts.ScriptKind.TSX;
  if (/\.jsx$/i.test(file)) return ts.ScriptKind.JSX;
  if (/\.(ts|mts|cts)$/i.test(file)) return ts.ScriptKind.TS;
  if (JSON_EXT.test(file)) return ts.ScriptKind.JSON;
  return ts.ScriptKind.JS;
};

/** Parsed source files, cached by content. */
const astCache = new Map();
function parse(file, raw) {
  const key = file + '\0' + raw.length + '\0' + hash(raw);
  let sf = astCache.get(key);
  if (!sf) {
    sf = ts.createSourceFile(file, raw, ts.ScriptTarget.Latest, true, scriptKind(file));
    if (astCache.size > 500) astCache.clear();
    astCache.set(key, sf);
  }
  return sf;
}
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += Math.max(1, s.length >> 12)) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Deepest node of the source file that contains [a, b). */
function nodeAt(sf, a, b) {
  let found = null;
  const visit = (n) => {
    if (n.getStart(sf) <= a && b <= n.end) {
      found = n;
      ts.forEachChild(n, visit);
    }
  };
  ts.forEachChild(sf, visit);
  return found;
}

function calleeName(call) {
  const e = call.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return (ts.isIdentifier(e.expression) ? e.expression.text + '.' : '') + e.name.text;
  return '';
}

/**
 * What kind of text a code match sits in, or null if it isn't page text.
 * Returns { kind: 'jsx' | 'string' | 'template', quote?, node: [start, end] }.
 */
function codeContext(file, raw, a, b) {
  const sf = parse(file, raw);
  const n = nodeAt(sf, a, b);
  if (!n) return null;
  if (n.kind === ts.SyntaxKind.JsxText) return { kind: 'jsx', node: [n.getStart(sf), n.end] };
  const isStr = ts.isStringLiteral(n);
  const isTpl = ts.isNoSubstitutionTemplateLiteral(n) || n.kind === ts.SyntaxKind.TemplateHead ||
    n.kind === ts.SyntaxKind.TemplateMiddle || n.kind === ts.SyntaxKind.TemplateTail;
  if (!isStr && !isTpl) return null;
  // the match must be inside the quotes, not on them
  const s0 = n.getStart(sf);
  if (a <= s0 || b >= n.end) return null;
  const p = n.parent;
  if (p) {
    if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isExternalModuleReference(p)) return null;
    if (ts.isImportTypeNode?.(p) || ts.isLiteralTypeNode(p)) return null;
    if (ts.isJsxAttribute(p) && NON_TEXT_ATTRS.has(p.name.getText(sf))) return null;
    if (ts.isPropertyAssignment(p) && p.name === n) return null; // an object key
    if (ts.isCallExpression(p) && NON_TEXT_CALLS.has(calleeName(p))) return null;
    if (ts.isElementAccessExpression(p) || ts.isCaseClause(p)) return null;
    if (ts.isBinaryExpression(p) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken,
      ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(p.operatorToken.kind)) return null;
    if (ts.isPropertyAssignment(p) && NON_TEXT_KEYS.has(p.name.getText(sf).replace(/^["']|["']$/g, ''))) return null;
  }
  if (isStr) return { kind: 'string', quote: raw[s0], node: [s0, n.end] };
  return { kind: 'template', node: [s0, n.end] };
}

/** Markup files: the match must be outside tags (and outside <script>/<style>). */
function markupContext(file, raw, a) {
  const lt = raw.lastIndexOf('<', a);
  const gt = raw.lastIndexOf('>', a);
  if (lt > gt) {
    // inside a tag: allow alt="" / title="" / content="" / placeholder="" / aria-label=""
    const m = /\s(alt|title|content|placeholder|aria-label|label|value)\s*=\s*(["'])[^"']*$/i.exec(raw.slice(lt, a));
    return m ? { kind: 'attr', quote: m[2] } : null;
  }
  const before = raw.slice(0, a).toLowerCase();
  for (const tag of ['script', 'style']) {
    const open = before.lastIndexOf('<' + tag);
    if (open !== -1 && open > before.lastIndexOf('</' + tag)) {
      // .astro/.vue/.svelte frontmatter and <script> blocks hold code; treat as code text
      return null;
    }
  }
  if (/\.(md|mdx|markdown)$/i.test(file)) return { kind: 'markdown' };
  return { kind: 'html' };
}

/** Front matter / code fences in .astro and .md: the `---` block at the top holds JS or YAML strings. */
function inFrontmatter(raw, a) {
  if (!raw.startsWith('---')) return false;
  const close = raw.indexOf('\n---', 3);
  return close !== -1 && a < close;
}

/** Context for a raw match in a file. */
export function contextFor(file, raw, a, b) {
  if (CODE_EXT.test(file) || JSON_EXT.test(file)) return codeContext(file, raw, a, b);
  if (MARKUP_EXT.test(file)) {
    if (inFrontmatter(raw, a)) {
      // YAML strings (Markdown) or JS (Astro). Both: plain or quoted values.
      if (/\.astro$/i.test(file)) {
        const fm = raw.slice(0, raw.indexOf('\n---', 3));
        return codeContext(file.replace(/\.astro$/i, '.ts'), fm, a, b);
      }
      return { kind: 'yaml' };
    }
    return markupContext(file, raw, a);
  }
  return null;
}

/**
 * True when the match is the whole of its string, JSX text or tag content, not part of a longer one.
 * A text on the page is usually exactly one of those, so whole matches beat partial ones.
 */
function isWhole(file, raw, a, b, ctx, needle) {
  if (ctx.node) {
    const [s, e] = ctx.node;
    const inner = ctx.kind === 'jsx' ? raw.slice(s, e) : raw.slice(s + 1, e - 1);
    return normalizeWithMap(inner, ctx.kind === 'jsx' ? { jsx: true } : { js: true }).text === needle;
  }
  if (ctx.kind === 'html' || ctx.kind === 'attr') {
    const before = raw.slice(Math.max(0, a - 200), a).replace(/\s+$/, '');
    const after = raw.slice(b, b + 200).replace(/^\s+/, '');
    return ctx.kind === 'html' ? before.endsWith('>') && after.startsWith('<') : /["']$/.test(before) && /^["']/.test(after);
  }
  return false;
}

/** Normalized index of a file, cached by content. */
const normCache = new Map();
function normalized(file, raw) {
  const key = file + '\0' + raw.length + '\0' + hash(raw);
  let n = normCache.get(key);
  if (!n) {
    n = normalizeWithMap(raw, readOpts(file));
    if (normCache.size > 2000) normCache.clear();
    normCache.set(key, n);
  }
  return n;
}

/** Every place in the files where `text` appears as page text. files: Map<path, raw>. */
export function findAll(files, text) {
  const needle = norm(text);
  const out = [];
  if (!needle) return out;
  for (const [file, raw] of files) {
    if (raw.length > 2_000_000) continue;
    const n = normalized(file, raw);
    for (const k of occurrences(n.text, needle)) {
      const a = n.start[k];
      const b = n.end[k + needle.length - 1];
      const ctx = contextFor(file, raw, a, b);
      if (!ctx) continue;
      out.push({ file, start: a, end: b, normIndex: k, whole: isWhole(file, raw, a, b, ctx, needle), ...lineCol(raw, a), ...ctx });
    }
  }
  return out;
}

/** How many files each neighbour text appears in (rare texts say more about where we are). */
function documentFrequency(files, neighbours) {
  const df = new Map();
  for (const t of neighbours) {
    let n = 0;
    for (const [file, raw] of files) if (normalized(file, raw).text.includes(t)) n++;
    df.set(t, n);
  }
  return df;
}

/**
 * Scores a candidate by the clicked section's other texts. Each neighbour found in the same file adds 1/(number
 * of files that contain it), doubled when it is near the candidate. A small bonus when the file name matches the page.
 */
const LAYOUT_FILE = /(^|\/)[^/]*(layout|header|footer|navbar|nav|menu|site-?header|site-?footer|shell|chrome)[^/]*$/i;

function score(files, cand, neighbours, df, pagePath, shared) {
  const n = normalized(cand.file, files.get(cand.file));
  let s = 0;
  // text clicked in a header, footer or nav lives in a layout component far more often than in a page
  if (shared && LAYOUT_FILE.test(cand.file)) s += 1;
  for (const t of neighbours) {
    const occ = occurrences(n.text, t);
    if (!occ.length) continue;
    let nearest = Infinity;
    for (const k of occ) nearest = Math.min(nearest, Math.abs(k - cand.normIndex));
    const w = 1 / Math.max(1, df.get(t) || 1);
    s += w * (1 + 1 / (1 + nearest / 600));
  }
  const seg = (pagePath || '/').split('/').filter(Boolean).pop() || 'home|index';
  const base = cand.file.split('/').pop().replace(/\.[^.]+$/, '').toLowerCase();
  if (new RegExp(`^(${seg.toLowerCase().replace(/[^a-z0-9|-]/g, '')})$`).test(base)) s += 0.3;
  return s;
}

/**
 * Finds where a clicked text comes from.
 * input: { text, neighbours: string[], path, prefer?: {file, start} }
 * Returns { status: 'found', loc, others } | { status: 'ambiguous', candidates } | { status: 'missing' }.
 */
export function locate(files, { text, neighbours = [], path, prefer, shared = false }) {
  let cands = findAll(files, text);
  if (!cands.length) return { status: 'missing' };
  if (cands.some((c) => c.whole)) cands = cands.filter((c) => c.whole);
  if (prefer) {
    const p = cands.find((c) => c.file === prefer.file && c.line === prefer.line) || null;
    if (p) return { status: 'found', loc: p, others: cands.length - 1, how: 'chosen' };
  }
  if (cands.length === 1) return { status: 'found', loc: cands[0], others: 0, how: 'unique' };
  const ns = [...new Set(neighbours.map(norm).filter((t) => t.length >= 6 && t !== norm(text)))].slice(0, 24);
  const df = documentFrequency(files, ns);
  const scored = cands.map((c) => ({ ...c, score: score(files, c, ns, df, path, shared) })).sort((x, y) => y.score - x.score);
  const [best, second] = scored;
  if (best.score >= 0.5 && best.score - second.score >= Math.max(0.4, 0.25 * best.score)) {
    return { status: 'found', loc: best, others: cands.length - 1, how: 'neighbours' };
  }
  // The leaders are all copies in one file (the same menu label in the desktop menu, the phone menu and the
  // footer): change them together. That is nearly always what an editor means, and the editor says so.
  const top = scored.filter((c) => best.score - c.score < 0.4);
  if (best.score >= 0.5 && top.length > 1 && top.every((c) => c.file === best.file)) {
    return { status: 'found', loc: best, copies: top.slice(1), others: cands.length - 1, how: 'copies' };
  }
  return { status: 'ambiguous', candidates: scored.slice(0, 20) };
}

/** A short line of source around a candidate, for the editor's "which one?" question. */
export function snippet(raw, start, end) {
  const ls = raw.lastIndexOf('\n', start) + 1;
  let le = raw.indexOf('\n', end);
  if (le === -1) le = raw.length;
  return raw.slice(ls, le).trim().slice(0, 160);
}
