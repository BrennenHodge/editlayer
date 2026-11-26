import { test } from 'node:test';
import assert from 'node:assert/strict';
import { locate, findAll } from '../src/find.js';
import { applyToFile, syntaxErrors } from '../src/apply.js';

const home = [
  "import { Hero } from './hero';",
  "import logo from './Insulate smarter.png';",
  "const features = [",
  "  { title: 'Fast install', body: \"It's ready in a day.\" },",
  "  { title: 'Lasts', body: 'Built for 50 years' },",
  "];",
  'export default function Home() {',
  '  return (',
  '    <main className="Insulate smarter">',
  '      <Hero title="Insulate smarter" />',
  '      <h2>Why builders pick',
  '        Lexar&nbsp;EPS</h2>',
  "      <p>No mess,{' '}no itch. <strong>Ever.</strong></p>",
  '      <a href="/dealers">Find a dealer</a>',
  '    </main>',
  '  );',
  '}',
].join('\r\n');

const contact = [
  'export const Contact = () => (',
  '  <section>',
  '    <h1>Talk to us</h1>',
  '    <a href="/dealers">Find a dealer</a>',
  '    <p>Call 555-0100 any weekday.</p>',
  '  </section>',
  ');',
].join('\n');

const files = new Map([['src/pages/home.tsx', home], ['src/pages/contact.tsx', contact]]);

test('a prop string, not the class name or the import path', () => {
  const all = findAll(files, 'Insulate smarter');
  assert.equal(all.length, 1);
  assert.equal(all[0].kind, 'string');
  assert.equal(all[0].line, 10);
});

test('JSX text across a line break, with an entity', () => {
  const r = locate(files, { text: 'Why builders pick Lexar EPS' });
  assert.equal(r.status, 'found');
  assert.equal(r.loc.kind, 'jsx');
});

test("JSX text next to {' '}: each piece is its own text node on the page, and each is found", () => {
  // React renders "No mess,", " " and "no itch." as separate text nodes, so the editor sends them separately.
  assert.equal(locate(files, { text: 'No mess,' }).status, 'found');
  assert.equal(locate(files, { text: 'no itch.' }).status, 'found');
  // one change spanning the expression isn't a single place in the source
  assert.equal(locate(files, { text: 'No mess, no itch.' }).status, 'missing');
});

test('a string in a content array', () => {
  const r = locate(files, { text: "It's ready in a day." });
  assert.equal(r.status, 'found');
  assert.equal(r.loc.kind, 'string');
});

test('the same link text on two pages: neighbours pick the page', () => {
  const r = locate(files, { text: 'Find a dealer', neighbours: ['Talk to us', 'Call 555-0100 any weekday.'], path: '/contact' });
  assert.equal(r.status, 'found');
  assert.equal(r.loc.file, 'src/pages/contact.tsx');
});

test('the same link text with no clues: ask', () => {
  const r = locate(files, { text: 'Find a dealer', neighbours: [] });
  assert.equal(r.status, 'ambiguous');
  assert.equal(r.candidates.length, 2);
});

test('text that is not in the source', () => {
  assert.equal(locate(files, { text: '39 stocking dealers' }).status, 'missing');
});

test('writing into a single-quoted string escapes the quote and keeps CRLF', () => {
  const r = locate(files, { text: 'Built for 50 years' });
  const out = applyToFile(r.loc.file, home, [{ ...r.loc, text: "Built for 50 years, and it's guaranteed" }]);
  assert.match(out, /body: 'Built for 50 years, and it\\'s guaranteed'/);
  assert.equal(out.split('\r\n').length, home.split('\r\n').length);
  assert.deepEqual(syntaxErrors('src/pages/home.tsx', out), []);
});

test('writing into JSX text escapes braces and angle brackets', () => {
  const r = locate(files, { text: 'Talk to us' });
  const out = applyToFile(r.loc.file, contact, [{ ...r.loc, text: 'Talk to us {today} <now>' }]);
  assert.match(out, /<h1>Talk to us &#123;today&#125; &lt;now&gt;<\/h1>/);
  assert.deepEqual(syntaxErrors('src/pages/contact.tsx', out), []);
});

test('a multi-line JSX text is replaced as a whole', () => {
  const r = locate(files, { text: 'Why builders pick Lexar EPS' });
  const out = applyToFile(r.loc.file, home, [{ ...r.loc, text: 'Why builders choose Lexar' }]);
  assert.match(out, /<h2>Why builders choose Lexar<\/h2>/);
});

test('two changes in one file', () => {
  const a = locate(files, { text: 'Fast install' }).loc;
  const b = locate(files, { text: 'Lasts' }).loc;
  const out = applyToFile(a.file, home, [{ ...a, text: 'Quick install' }, { ...b, text: 'Lasts decades' }]);
  assert.match(out, /title: 'Quick install'/);
  assert.match(out, /title: 'Lasts decades'/);
});
