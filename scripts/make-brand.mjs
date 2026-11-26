// Renders the Vibe CMS brand images with Edge: OG image (1200x630), the 1024 mark (for pwa.py), favicons.
//   node scripts/make-brand.mjs   (needs playwright from ~/.claude/skills/modern-website/scripts)
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
const require = createRequire(join(homedir(), '.claude/skills/modern-website/scripts/package.json'));
const { chromium } = require('playwright');
const site = join(dirname(fileURLToPath(import.meta.url)), '..', 'site');
const img = join(site, 'assets', 'img');
mkdirSync(img, { recursive: true });

const mark = (size) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${size}" height="${size}"><path d="M8.2 9.6 13.7 22.4h1.5L20.6 9.6" fill="none" stroke="#c6f135" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/><rect x="23" y="8" width="2.8" height="16" rx="1.4" fill="#9d8bff"/></svg>`;
const tile = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="9" fill="#121316"/><path d="M8.2 9.6 13.7 22.4h1.5L20.6 9.6" fill="none" stroke="#c6f135" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/><rect x="23" y="8" width="2.8" height="16" rx="1.4" fill="#9d8bff"/></svg>`;
writeFileSync(join(site, 'favicon.svg'), tile + '\n');

const fonts = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700&family=Inter:wght@500&family=JetBrains+Mono:wght@600&display=block">';
const og = `<!doctype html><html><head>${fonts}<style>
body{margin:0;width:1200px;height:630px;background:#121316;color:#f1f2ec;font-family:Inter;position:relative;overflow:hidden}
.k{position:absolute;left:80px;top:72px;display:flex;align-items:center;gap:16px;font:700 34px 'Bricolage Grotesque'}
.k i{width:56px;height:56px;display:block}
h1{position:absolute;left:80px;top:170px;margin:0;font:700 104px/1 'Bricolage Grotesque';letter-spacing:-4px}
h1 span{background:#c6f135;color:#15180a;padding:0 10px;border-radius:8px}
h1 b{display:inline-block;width:8px;height:88px;background:#9d8bff;border-radius:4px;vertical-align:-8px;margin-left:8px}
p{position:absolute;left:80px;top:420px;margin:0;font:500 32px/1.35 Inter;color:#c3c6cc;width:900px}
.m{position:absolute;left:80px;bottom:64px;font:600 22px 'JetBrains Mono';color:#9a9ea6;letter-spacing:1px}
</style></head><body><div class="k"><i>${tile}</i>Vibe CMS</div>
<h1>Click the page.<br>Type. <span>Publish</span><b></b></h1>
<p>The click-to-edit CMS for websites built with AI.</p>
<div class="m">CLAUDE CODE PLUGIN · CHATGPT · CLAUDE · GROK</div></body></html>`;

const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage();
await page.setViewportSize({ width: 1200, height: 630 });
await page.setContent(og, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: join(img, 'og.png') });

// Transparent mark for pwa.py (it adds the background and maskable padding).
await page.setViewportSize({ width: 1024, height: 1024 });
await page.setContent(`<html><body style="margin:0;background:transparent">${mark(1024)}</body></html>`);
await page.screenshot({ path: join(img, 'mark-1024.png'), omitBackground: true });

for (const [file, size] of [['favicon-32.png', 32], ['apple-touch-icon.png', 180], ['favicon-48.png', 48]]) {
  await page.setViewportSize({ width: size, height: size });
  const bg = file.startsWith('apple') ? `<rect width="32" height="32" fill="#121316"/>` : '';
  await page.setContent(`<html><body style="margin:0;background:transparent">${file.startsWith('apple') ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${size}" height="${size}">${bg}<g transform="translate(3.2 3.2) scale(.8)"><path d="M8.2 9.6 13.7 22.4h1.5L20.6 9.6" fill="none" stroke="#c6f135" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/><rect x="23" y="8" width="2.8" height="16" rx="1.4" fill="#9d8bff"/></g></svg>` : tile.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: join(site, file === 'favicon-48.png' ? 'assets/img/favicon-48.png' : file), omitBackground: true });
}
await browser.close();
console.log('brand images written');
