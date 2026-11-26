// node bench.cjs <outs.json>  -> prints which payload indexes executed script in Chromium
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const fs = require('fs');
(async () => {
  const outs = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const browser = await chromium.launch({ channel: "msedge" });
  const page = await browser.newPage();
  await page.setContent('<!doctype html><title>b</title>');
  const fired = await page.evaluate(async (outs) => {
    const fired = new Set();
    addEventListener('message', (e) => { if (typeof e.data === 'string' && e.data.startsWith('XSS-')) fired.add(e.data); });
    for (const h of outs) {
      // 1) parsed directly as a document (what visitors get)
      const f = document.createElement('iframe'); f.srcdoc = h; document.body.append(f);
      // 2) parsed via innerHTML into a live element (what the editor does with region HTML)
      const f2 = document.createElement('iframe'); f2.srcdoc = '<div id=r></div><script>document.getElementById("r").innerHTML = ' + JSON.stringify(h).replace(/</g, '\u003c') + '<\/script>'; document.body.append(f2);
    }
    await new Promise((r) => setTimeout(r, 2500));
    return [...fired].sort();
  }, outs);
  console.log('FIRED:', JSON.stringify(fired));
  await browser.close();
})();
