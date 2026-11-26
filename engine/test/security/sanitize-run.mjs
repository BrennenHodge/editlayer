// node sanitize-run.mjs <miniflare dir> <engine/src dir> <payloads.json> [options json]  -> writes payloads.out.json
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
const [mfDir, engineSrc, payloadFile, optsJson] = process.argv.slice(2);
const { Miniflare } = await import(pathToFileURL(path.join(mfDir, 'dist/src/index.js')).href);
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
const src = fs.readFileSync(path.join(here, 'sanitize-worker.mjs'), 'utf8').replace("'ENGINE/sanitize.js'", "'./sanitize.js'");
const modules = { '__test_worker.mjs': { type: 'esm', contents: src } };
for (const f of ['sanitize.js', 'junk.js', 'util.js', 'clobber.js']) modules[f] = { type: 'esm', contents: fs.readFileSync(path.join(engineSrc, f), 'utf8') };
const mf = new Miniflare({ workers: [{ config: { name: 't', compatibilityDate: '2025-01-01', manifest: { mainModule: '__test_worker.mjs', modules } } }] });
const payloads = JSON.parse(fs.readFileSync(payloadFile, 'utf8'));
const res = await mf.dispatchFetch('http://x/', { method: 'POST', body: JSON.stringify({ payloads, opts: optsJson ? JSON.parse(optsJson) : undefined }) });
const text = await res.text();
let out; try { out = JSON.parse(text); } catch { console.log(text); process.exit(1); }
fs.writeFileSync(payloadFile.replace(/\.json$/, '.out.json'), JSON.stringify(out, null, 1));
for (let i = 0; i < payloads.length; i++) console.log(`--- ${i}\nIN : ${payloads[i]}\nOUT: ${out[i]}`);
await mf.dispose();
