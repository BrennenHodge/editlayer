// Runs the finder on every text of a built site, the way the editor would call it (text plus its section's
// other texts as neighbours), and reports how often it finds one place, has to ask, or finds nothing.
//   node test/eval-site.mjs <built html dir> <repo dir> [--branch editlayer-test]
import fs from 'node:fs';
import path from 'node:path';
import { parseHTML } from 'linkedom';
import { localRepo } from '../src/repo-local.js';
import { locate } from '../src/find.js';

const [, , htmlDir, repoDir] = process.argv;
const branch = process.argv.includes('--branch') ? process.argv[process.argv.indexOf('--branch') + 1] : 'editlayer-test';
const files = localRepo(path.resolve(repoDir), { branch }).readAll();
const norm = (s) => String(s || '').replace(/[\s ​]+/g, ' ').trim();

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(d, e.name);
  return e.isDirectory() ? walk(p) : p.endsWith('.html') && !/spa\.html$/.test(p) ? [p] : [];
});

const totals = {};
const examples = { ambiguous: [], missing: [] };
for (const file of walk(htmlDir)) {
  const rel = path.relative(htmlDir, file).replace(/\\/g, '/');
  const page = '/' + rel.replace(/(^|\/)index\.html$/, '').replace(/\.html$/, '');
  const group = /^find-a-dealer\/[^/]+\/index\.html$/.test(rel) ? 'dealer state pages' : 'marketing pages';
  const { document } = parseHTML(fs.readFileSync(file, 'utf8'));
  for (const s of document.querySelectorAll('script, style, noscript, template, svg')) s.remove();
  const texts = [];
  const walkNodes = (n) => {
    for (const c of n.childNodes) {
      if (c.nodeType === 3 && norm(c.data).length >= 2 && /\p{L}/u.test(c.data)) texts.push(c);
      else if (c.nodeType === 1) walkNodes(c);
    }
  };
  walkNodes(document.body);
  for (const node of texts) {
    const el = node.parentElement;
    const where = el.closest('header, footer, nav') ? 'menus and footer' : 'page content';
    const t = (totals[`${group}, ${where}`] ||= { pages: new Set(), n: 0, unique: 0, neighbours: 0, copies: 0, ambiguous: 0, missing: 0 });
    t.pages.add(page);
    const sec = el.closest('section, header, footer, nav, article, aside, form, main') || el.parentElement;
    const neighbours = [];
    const collect = (n) => { for (const c of n.childNodes) { if (c.nodeType === 3 && c !== node) { const v = norm(c.data); if (v.length >= 6) neighbours.push(v); } else if (c.nodeType === 1) collect(c); } };
    collect(sec);
    const r = locate(files, { text: node.data, neighbours: neighbours.slice(0, 24), path: page, shared: where === 'menus and footer' });
    t.n++;
    if (r.status === 'found') t[r.how]++;
    else t[r.status]++;
    if (r.status !== 'found' && examples[r.status].length < 15) examples[r.status].push(`${page}: "${norm(node.data).slice(0, 60)}"${r.candidates ? ` (${r.candidates.length} places)` : ''}`);
  }
}
const pct = (a, b) => `${Math.round((100 * a) / (b || 1))}%`.padStart(4);
for (const [g, t] of Object.entries(totals)) {
  console.log(`\n${g}: ${t.pages.size} pages, ${t.n} texts`);
  console.log(`  ${pct(t.unique, t.n)} found, only one place`);
  console.log(`  ${pct(t.neighbours, t.n)} found, picked by neighbouring text`);
  console.log(`  ${pct(t.copies, t.n)} found, copies in one file changed together`);
  console.log(`  ${pct(t.ambiguous, t.n)} several places, the editor is asked`);
  console.log(`  ${pct(t.missing, t.n)} not in the source (built by code or from data)`);
}
for (const k of ['ambiguous', 'missing']) { console.log(`\n${k} examples:`); for (const e of examples[k]) console.log('  ' + e); }
