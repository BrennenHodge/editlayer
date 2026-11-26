// Read-only: how much of a built site's visible text can be found, verbatim, in its source files?
// usage: node textmap.mjs <built html dir> <source dir>
import fs from 'node:fs';
import path from 'node:path';

const [, , htmlDir, srcDir] = process.argv;
const walk = (d, ok) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(d, e.name);
  if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(p, ok);
  return ok(p) ? [p] : [];
});
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', mdash: '—', ndash: '–', hellip: '…', copy: '©', reg: '®', trade: '™' };
const decode = (s) => s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return ENT[e.toLowerCase()] ?? m;
});
const norm = (s) => decode(s).replace(/\s+/g, ' ').trim();

const srcFiles = walk(srcDir, (p) => /\.(tsx?|jsx?|json|html|md|mdx|astro|vue|svelte)$/.test(p));
const corpus = srcFiles.map((f) => ({ f: path.relative(srcDir, f).replace(/\\/g, '/'), text: norm(fs.readFileSync(f, 'utf8')), data: f.endsWith('.json') }));
const count = (needle) => {
  let n = 0; const files = [];
  for (const c of corpus) { let i = -1, k = 0; while ((i = c.text.indexOf(needle, i + 1)) !== -1) k++; if (k) { n += k; files.push(c); } }
  return { n, files };
};

const pages = walk(htmlDir, (p) => p.endsWith('.html') && !/spa\.html$/.test(p));
const groups = {};
for (const p of pages) {
  const rel = path.relative(htmlDir, p).replace(/\\/g, '/');
  const group = rel.startsWith('find-a-dealer/') && rel !== 'find-a-dealer/index.html' ? 'dealer state pages' : 'marketing pages';
  let html = fs.readFileSync(p, 'utf8');
  html = html.replace(/^[\s\S]*?<body[^>]*>/i, '').replace(/<(script|style|svg|noscript|template)[\s\S]*?<\/\1>/gi, ' ');
  const chunks = html.split(/<[^>]+>/).map(norm).filter((t) => t.length >= 3 && /[a-z]{2}/i.test(t));
  const g = (groups[group] ||= { pages: 0, chunks: 0, chars: 0, unique: 0, uniqueC: 0, multi: 0, multiC: 0, data: 0, dataC: 0, missing: 0, missingC: 0, examples: [] });
  g.pages++;
  for (const t of chunks) {
    g.chunks++; g.chars += t.length;
    const { n, files } = count(t);
    if (!n) { g.missing++; g.missingC += t.length; if (g.examples.length < 12) g.examples.push(`${rel}: ${t.slice(0, 80)}`); }
    else if (files.every((c) => c.data)) { g.data++; g.dataC += t.length; }
    else if (n === 1) { g.unique++; g.uniqueC += t.length; }
    else { g.multi++; g.multiC += t.length; }
  }
}
const pct = (a, b) => `${((100 * a) / (b || 1)).toFixed(0)}%`;
for (const [name, g] of Object.entries(groups)) {
  console.log(`\n${name}: ${g.pages} pages, ${g.chunks} text pieces`);
  console.log(`  found once in source     ${pct(g.unique, g.chunks)} of pieces, ${pct(g.uniqueC, g.chars)} of characters`);
  console.log(`  found in several places  ${pct(g.multi, g.chunks)} of pieces, ${pct(g.multiC, g.chars)} of characters`);
  console.log(`  only in data (JSON)      ${pct(g.data, g.chunks)} of pieces, ${pct(g.dataC, g.chars)} of characters`);
  console.log(`  not found verbatim       ${pct(g.missing, g.chunks)} of pieces, ${pct(g.missingC, g.chars)} of characters`);
  console.log('  examples not found:'); for (const e of g.examples) console.log('   - ' + e);
}
