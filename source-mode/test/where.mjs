// Lists every place a text appears in a repo: node test/where.mjs <repo dir> "text" ["text" ...]
import path from 'node:path';
import { localRepo } from '../src/repo-local.js';
import { findAll } from '../src/find.js';
const [, , dir, ...texts] = process.argv;
const files = localRepo(path.resolve(dir), { branch: 'vibecms-test' }).readAll();
for (const t of texts) {
  console.log(`== ${t}`);
  for (const c of findAll(files, t)) console.log(`  ${c.whole ? 'whole' : 'part '} ${c.kind.padEnd(8)} ${c.file}:${c.line}`);
}
