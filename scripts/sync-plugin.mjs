// Copies the engine into the Claude Code plugin (plugins/claude-code/engine), because installed plugins are
// copied into Claude's cache and can't see files outside their own folder. Run after changing engine/:
//   node scripts/sync-plugin.mjs
import { cpSync, rmSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const engine = join(root, 'engine');
const dest = join(root, 'plugins', 'claude-code', 'engine');

const build = spawnSync(process.execPath, [join(engine, 'scripts', 'build-client.mjs')], { stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status || 1);

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
for (const d of ['src', 'migrations', 'cli', 'docs']) cpSync(join(engine, d), join(dest, d), { recursive: true });
for (const f of ['package.json', 'README.md']) cpSync(join(engine, f), join(dest, f));

// Keep the plugin version in step with the engine.
const version = JSON.parse(readFileSync(join(engine, 'package.json'), 'utf8')).version;
const manifest = join(root, 'plugins', 'claude-code', '.claude-plugin', 'plugin.json');
const m = JSON.parse(readFileSync(manifest, 'utf8'));
m.version = version;
writeFileSync(manifest, JSON.stringify(m, null, 2) + '\n');
console.log(`plugin engine synced (v${version})`);
