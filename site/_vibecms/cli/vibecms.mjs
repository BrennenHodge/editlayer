#!/usr/bin/env node
// Vibe CMS CLI. Run from a site folder (the one with wrangler.jsonc), or pass --site <dir>.
//
//   vibecms init [--name "Site Name"] [--accent #hex]   add the editor to a static site on Cloudflare
//   vibecms update                                       copy this version of the engine into the site
//   vibecms annotate [dir]                               mark editable regions in built HTML (run after each build)
//   vibecms connect <name> [--publish]                   AI connection (ChatGPT, Claude, Grok): prints its MCP URL
//   vibecms connect list | connect remove <name>
//   vibecms user add <email> [--name N] [--admin]         create an editor and print their invite link
//   vibecms user link <email>                            new invite link (also how to reset a password)
//   vibecms user list | user remove <email>
//   vibecms status                                       pages with edits, drafts and conflicts
//   Add --local (and --port N) to use the local dev database (wrangler dev).
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync, cpSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { join, resolve, relative, dirname, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { annotateDir } from './annotate.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(`--${name}`); return i > -1 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args.splice(i, 2)[1] : (args.splice(i, 1), true)) : undefined; };
const siteDir = resolve(flag('site') || process.cwd());
const local = Boolean(flag('local'));
const port = flag('port'); // with --local: the wrangler dev port in printed links
const canPublish = Boolean(flag('publish')); // read before the positional arguments are split off
const [cmd, sub, ...rest] = args;

const die = (msg) => { console.error(`\n  ${msg}\n`); process.exit(1); };
const posix = (p) => p.split(sep).join('/');

function readConfig() {
  const file = join(siteDir, 'wrangler.jsonc');
  if (!existsSync(file)) die(`No wrangler.jsonc in ${siteDir}. Run this from the site folder or pass --site.`);
  const text = readFileSync(file, 'utf8');
  // Strip // and /* */ comments outside strings, then trailing commas.
  const noComments = text.replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m, str) => str || '');
  return { file, config: JSON.parse(noComments.replace(/,(\s*[}\]])/g, '$1')) };
}

function wrangler(argv, { capture = true } = {}) {
  // One quoted command string: Windows needs a shell to run npx.cmd, and Node warns about arg arrays with shell.
  const quote = (a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `"${String(a).replace(/"/g, '\\"')}"`);
  const line = ['npx', '--yes', 'wrangler', ...argv].map(quote).join(' ');
  const r = spawnSync(line, { cwd: siteDir, encoding: 'utf8', shell: true, stdio: capture ? 'pipe' : 'inherit', env: process.env });
  return { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}` };
}

function sqlValue(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
}

function d1(sql, { json = false } = {}) {
  const { config } = readConfig();
  const db = config.d1_databases?.find((x) => x.binding === 'CMS_DB');
  if (!db) die('This site has no CMS_DB database yet. Run: vibecms init');
  const where = local ? '--local' : '--remote';
  let r;
  if (json) {
    // Reads go through --command: remote --file runs report counts, not rows.
    r = wrangler(['d1', 'execute', db.database_name, where, '--command', sql.replace(/\s+/g, ' ').trim(), '--json']);
  } else {
    const dir = mkdtempSync(join(tmpdir(), 'vibecms-'));
    const file = join(dir, 'q.sql');
    writeFileSync(file, sql);
    r = wrangler(['d1', 'execute', db.database_name, where, '--file', file, '--yes']);
    rmSync(dir, { recursive: true, force: true });
  }
  if (!r.ok) die(`Database command failed:\n${r.out.slice(-1500)}`);
  if (!json) return null;
  const start = r.out.search(/\[\s*\{/);
  try { return JSON.parse(r.out.slice(start))[0]?.results || []; } catch { die(`Unexpected output:\n${r.out.slice(-800)}`); }
}

function siteUrl() {
  if (local) return `http://localhost:${port || 8787}`;
  const { config } = readConfig();
  const route = (config.routes || []).find((r) => r.custom_domain);
  return route ? `https://${route.pattern}` : `https://${config.name}.workers.dev`;
}

function invite(email, name, role) {
  const token = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(token).digest('hex');
  const now = Date.now();
  d1(`INSERT INTO cms_users (email, name, role, invite_hash, invite_expires, created_at) VALUES (${sqlValue(email)}, ${sqlValue(name || null)}, ${sqlValue(role)}, ${sqlValue(hash)}, ${now + 7 * 864e5}, ${now})
ON CONFLICT(email) DO UPDATE SET invite_hash = excluded.invite_hash, invite_expires = excluded.invite_expires, name = COALESCE(excluded.name, cms_users.name), role = excluded.role;`);
  return `${siteUrl()}/_cms/invite/${token}`;
}

// The engine is copied into each site (./_vibecms), so a site deploys on its own (CI, another machine)
// and keeps working whatever happens to the copy that installed it. `vibecms update` refreshes it.
const VENDOR = '_vibecms';
function vendor() {
  const dest = join(siteDir, VENDOR);
  // The site's own copy (./_vibecms/cli) can annotate and manage users, but can't replace itself.
  if (resolve(PKG) === resolve(dest)) die('This is the site\'s own copy of the engine. Run update with the Vibe CMS plugin or package instead.');
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  for (const d of ['src', 'migrations', 'cli']) cpSync(join(PKG, d), join(dest, d), { recursive: true });
  cpSync(join(PKG, 'package.json'), join(dest, 'package.json'));
  const version = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')).version;
  writeFileSync(join(dest, 'VERSION'), `${version}
`);
  writeFileSync(join(dest, 'README.md'), `Vibe CMS engine ${version}, copied here by \`vibecms init\` / \`vibecms update\`. Don't edit: run \`vibecms update\` instead.
`);
  return version;
}

function init() {
  const { file, config } = readConfig();
  const name = config.name;
  const siteName = flag('name') || name;
  const accent = flag('accent') || '#2563eb';
  const dbName = `${name}-cms`;
  const bucket = `${name}-cms-media`;

  // 1. D1 database
  let db = config.d1_databases?.find((x) => x.binding === 'CMS_DB');
  if (!db) {
    console.log(`Creating D1 database ${dbName}\u2026`);
    let r = wrangler(['d1', 'create', dbName]);
    let id = /"database_id":\s*"([0-9a-f-]{36})"/.exec(r.out)?.[1] || /database_id\s*=\s*"([0-9a-f-]{36})"/.exec(r.out)?.[1];
    if (!id) {
      r = wrangler(['d1', 'list', '--json']);
      try { id = JSON.parse(r.out.slice(r.out.indexOf('['))).find((x) => x.name === dbName)?.uuid; } catch { /* fallthrough */ }
    }
    if (!id) die(`Couldn't create or find D1 database ${dbName}:\n${r.out.slice(-1200)}`);
    db = { binding: 'CMS_DB', database_name: dbName, database_id: id };
  }
  const version = vendor();
  db.migrations_dir = `${VENDOR}/migrations`;
  config.d1_databases = [...(config.d1_databases || []).filter((x) => x.binding !== 'CMS_DB'), db];

  // 2. R2 bucket
  if (!config.r2_buckets?.find((x) => x.binding === 'CMS_MEDIA')) {
    console.log(`Creating R2 bucket ${bucket}\u2026`);
    const r = wrangler(['r2', 'bucket', 'create', bucket]);
    if (!r.ok && !/already exists|already own/i.test(r.out)) die(`Couldn't create R2 bucket ${bucket}:\n${r.out.slice(-1200)}`);
    config.r2_buckets = [...(config.r2_buckets || []), { binding: 'CMS_MEDIA', bucket_name: bucket }];
  }

  // 3. Worker entry + assets run through the Worker (except static files that never change)
  const entry = join(siteDir, 'cms.worker.js');
  if (!existsSync(entry)) {
    writeFileSync(entry, `// Vibe CMS: click-to-edit for this site. Engine: ./${VENDOR} (refresh with: vibecms update)\nimport { createCms } from './${VENDOR}/src/worker.js';\n\nexport default createCms({\n  siteName: ${JSON.stringify(siteName)},\n  accent: ${JSON.stringify(accent)},\n});\n`);
  }
  config.main = 'cms.worker.js';
  config.assets = {
    ...(config.assets || { directory: '.' }),
    binding: 'ASSETS',
    run_worker_first: ['/*', '!/assets/*', '!/styles.css', '!/script.js', '!/favicon.ico', '!/favicon.svg', '!/favicon-32.png', '!/apple-touch-icon.png', '!/robots.txt'],
  };
  // A zone route alongside each custom domain, so a wildcard Worker on the zone can't intercept POSTs.
  const routes = config.routes || [];
  for (const r of routes.filter((x) => x.custom_domain)) {
    const zone = r.pattern.split('.').slice(-2).join('.');
    if (!routes.some((x) => x.pattern === `${r.pattern}/*`)) routes.push({ pattern: `${r.pattern}/*`, zone_name: zone });
  }
  config.routes = routes;
  config.observability = config.observability || { enabled: true };
  writeFileSync(file, JSON.stringify(config, null, 2) + '\n');

  // 4. Keep CMS files out of the public assets
  const ignoreFile = join(siteDir, '.assetsignore');
  const ignore = existsSync(ignoreFile) ? readFileSync(ignoreFile, 'utf8').split(/\r?\n/).filter(Boolean) : [];
  for (const x of ['cms.worker.js', `/${VENDOR}`, 'node_modules', 'package.json', 'package-lock.json', '.dev.vars', '.wrangler']) if (!ignore.includes(x)) ignore.push(x);
  writeFileSync(ignoreFile, ignore.join('\n') + '\n');

  // 5. Tables
  console.log('Applying database migrations\u2026');
  for (const where of ['--local', '--remote']) {
    const r = wrangler(['d1', 'migrations', 'apply', dbName, where]);
    if (!r.ok) die(`Migrations failed (${where}):\n${r.out.slice(-1500)}`);
  }

  // 6. Regions
  const res = annotateDir(join(siteDir, config.assets.directory || '.'));
  console.log(`\nVibe CMS is set up for ${siteName}.`);
  console.log(`  Marked ${res.pages} pages, ${res.images} site images listed for the picker.`);
  console.log('  Next: add `vibecms annotate` to the end of your build, deploy, then create an editor:');
  console.log('    vibecms user add you@example.com --name "Your Name" --admin\n');
}

function status() {
  const rows = d1(`SELECT path, key, state, base, updated_at, updated_by FROM cms_regions ORDER BY path, key, state;`, { json: true });
  if (!rows.length) { console.log('No edits yet.'); return; }
  const { config } = readConfig();
  const dir = join(siteDir, config.assets?.directory || '.');
  for (const r of rows) {
    let note = '';
    if (r.path !== '*' && r.base) {
      const f = join(dir, r.path, r.path.endsWith('/') ? 'index.html' : '');
      if (existsSync(f)) {
        const m = new RegExp(`data-cms="${r.key.replace(/[#@]/g, '\\$&')}" data-cms-v="([0-9a-f]+)"`).exec(readFileSync(f, 'utf8'));
        if (m && m[1] !== r.base) note = '  \u26a0 source changed since this was edited';
      }
    }
    console.log(`${r.state.padEnd(5)}  ${r.path.padEnd(32)} ${r.key.padEnd(10)} ${new Date(r.updated_at).toLocaleString()}  ${r.updated_by || ''}${note}`);
  }
}

switch (cmd) {
  case 'init': init(); break;
  case 'annotate': {
    const { config } = existsSync(join(siteDir, 'wrangler.jsonc')) ? readConfig() : { config: {} };
    const dir = sub ? resolve(sub) : join(siteDir, config.assets?.directory || '.');
    const r = annotateDir(dir);
    console.log(`vibecms: marked ${r.pages} pages, listed ${r.images} images${r.skipped.length ? ` (not editable because they differ per page: ${r.skipped.join(', ')})` : ''}`);
    break;
  }
  case 'user': {
    const email = String(rest[0] || '').trim().toLowerCase();
    // Letters, digits and . _ + ' - only: the address ends up in a shell command line (wrangler --command).
    const EMAIL_OK = /^[a-z0-9._+'-]{1,64}@[a-z0-9.-]{1,190}\.[a-z]{2,24}$/;
    if (sub !== 'list' && !EMAIL_OK.test(email)) die('That doesn’t look like an email address. Usage: vibecms user add <email> [--name "Name"] [--admin]');
    if (sub === 'list') {
      for (const u of d1('SELECT email, name, role, (pass_hash IS NOT NULL OR last_login IS NOT NULL) AS active, last_login FROM cms_users ORDER BY email;', { json: true })) {
        console.log(`${u.email.padEnd(36)} ${String(u.name || '').padEnd(24)} ${u.role.padEnd(7)} ${u.active ? 'active' : 'invited'}`);
      }
    } else if (sub === 'add' || sub === 'link') {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) die('Usage: vibecms user add <email> [--name "Name"] [--admin]');
      const admin = Boolean(flag('admin'));
      const name = flag('name');
      let role = admin ? 'admin' : 'editor';
      if (sub === 'link' && !admin) {
        const u = d1(`SELECT role FROM cms_users WHERE email = ${sqlValue(email)};`, { json: true })[0];
        if (!u) die(`${email} isn't an editor yet. Use: vibecms user add ${email}`);
        role = u.role;
      }
      const link = invite(email, typeof name === 'string' ? name : null, role);
      console.log(`\nInvite link for ${email} (${role}). Works once, for 7 days:\n\n  ${link}\n`);
    } else if (sub === 'remove') {
      d1(`DELETE FROM cms_ai_tokens WHERE created_by = ${sqlValue(email)}; DELETE FROM cms_sessions WHERE user_id IN (SELECT id FROM cms_users WHERE email = ${sqlValue(email)}); DELETE FROM cms_users WHERE email = ${sqlValue(email)};`);
      console.log(`Removed ${email}.`);
    } else die('Usage: vibecms user add|link|list|remove');
    break;
  }
  case 'status': status(); break;
  case 'update': {
    readConfig();
    const v = vendor();
    console.log(`Engine ${v} copied into ${VENDOR}/. Applying database migrations…`);
    const { config } = readConfig();
    const db = config.d1_databases?.find((x) => x.binding === 'CMS_DB');
    if (db) {
      const r = wrangler(['d1', 'migrations', 'apply', db.database_name, local ? '--local' : '--remote']);
      if (!r.ok) die(`Migrations failed:
${r.out.slice(-1500)}`);
    }
    console.log('Done. Deploy the site to use the new version.');
    break;
  }
  case 'connect': {
    if (sub === 'list') {
      const rows = d1('SELECT name, role, created_at, last_used FROM cms_ai_tokens ORDER BY created_at DESC;', { json: true });
      if (!rows.length) console.log('No AI connections yet. Make one: vibecms connect ChatGPT');
      for (const t of rows) console.log(`${t.name.padEnd(24)} ${t.role === 'editor' ? 'can publish' : 'drafts only'}  ${t.last_used ? `last used ${new Date(t.last_used).toLocaleString()}` : 'not used yet'}`);
      break;
    }
    if (sub === 'remove') {
      const name = rest.join(' ').trim();
      if (!name) die('Usage: vibecms connect remove <name>');
      d1(`DELETE FROM cms_ai_tokens WHERE name = ${sqlValue(name)};`);
      console.log(`Turned off ${name}.`);
      break;
    }
    const name = [sub, ...rest].filter(Boolean).join(' ').trim();
    if (!name) die('Usage: vibecms connect <name> [--publish]   e.g. vibecms connect ChatGPT');
    const key = `vcms_${randomBytes(24).toString('base64url')}`;
    const hash = createHash('sha256').update(key).digest('hex');
    d1(`INSERT INTO cms_ai_tokens (name, token_hash, role, created_by, created_at) VALUES (${sqlValue(name.slice(0, 60))}, ${sqlValue(hash)}, ${sqlValue(canPublish ? 'editor' : 'author')}, 'cli', ${Date.now()});`);
    const url = `${siteUrl()}/_cms/mcp/${key}`;
    console.log(`
${name} can now ${canPublish ? 'edit and publish' : 'edit (as drafts)'} this site. MCP server URL (keep it private, it is shown once):

  ${url}
`);
    console.log('  ChatGPT: Settings > Apps > Advanced > Developer mode, then Create app and paste the URL (no authentication).');
    console.log('  Claude:  Settings > Connectors > Add custom connector, paste the URL.');
    console.log(`  Claude Code: claude mcp add --transport http ${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')} ${url}`);
    console.log('  Grok (xAI API): add it as a remote MCP tool with server_url set to the URL.\n');
    break;
  }
  default:
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 14).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
}
