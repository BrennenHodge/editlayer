// Phase 0 service: serves the editor script, takes text changes from the page, publishes them as a commit.
//
//   node server.mjs --repo <local test repo> --branch vibecms-test --site http://localhost:3310 \
//     [--build "pnpm --filter @workspace/lexar-website run build"] [--build-env PORT=3000,BASE_PATH=/]
//
// It prints a one-time sign-in link for the site. "Deploying" here is the test stand-in for a host: after each
// commit it runs the build command in the repository, the way Railway or Vercel would after a push.
// Phase 0 only talks to a local repository with no remotes (see src/repo-local.js).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { localRepo } from './src/repo-local.js';
import { createService } from './src/service.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
  return acc;
}, []));

const PORT = Number(args.port || 8790);
const SITE = String(args.site || 'http://localhost:3310').replace(/\/$/, '');
const REPO_DIR = path.resolve(String(args.repo || ''));
const BRANCH = String(args.branch || 'vibecms-test');
const BUILD = args.build ? String(args.build) : null;
const BUILD_ENV = Object.fromEntries(String(args['build-env'] || '').split(',').filter(Boolean).map((kv) => kv.split('=')));
const EDITOR = { email: String(args.email || 'editor@example.test'), name: String(args.name || 'Test Editor') };

if (!args.repo) { console.error('--repo is required'); process.exit(1); }
const repo = localRepo(REPO_DIR, { branch: BRANCH });
repo.assertSafe();
const service = createService({ repo, dataDir: path.join(HERE, '.data') });

// ---- sign-in hand-off: a one-time code in the site's URL becomes a token the page keeps
const codes = new Map(); // code -> expires
const tokens = new Map(); // token -> user
function newLink() {
  const code = crypto.randomBytes(18).toString('base64url');
  codes.set(code, Date.now() + 15 * 60_000);
  return `${SITE}/#vibe=${code}`;
}

// ---- the test deployer
const deploy = { state: 'idle', sha: repo.head(), startedAt: null, finishedAt: null, log: [] };
function runDeploy(sha) {
  if (!BUILD) { Object.assign(deploy, { state: 'live', sha, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString() }); return; }
  Object.assign(deploy, { state: 'building', sha, startedAt: new Date().toISOString(), finishedAt: null, log: [] });
  const child = spawn(BUILD, { cwd: REPO_DIR, shell: true, env: { ...process.env, NODE_ENV: 'production', ...BUILD_ENV } });
  const keep = (b) => { for (const l of String(b).split(/\r?\n/)) if (l.trim()) deploy.log.push(l); deploy.log = deploy.log.slice(-40); };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  child.on('close', (code) => {
    if (deploy.sha !== sha) return; // a newer deploy started
    Object.assign(deploy, { state: code === 0 ? 'live' : 'failed', finishedAt: new Date().toISOString() });
    console.log(`deploy ${sha.slice(0, 7)}: ${deploy.state}`);
  });
}

// ---- HTTP
const cors = (req) => {
  const origin = req.headers.origin;
  return origin === SITE ? {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  } : {};
};
function send(req, res, status, body, type = 'application/json') {
  const data = type === 'application/json' ? JSON.stringify(body) : body;
  res.writeHead(status, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store', ...cors(req) });
  res.end(data);
}
async function readJson(req) {
  let s = '';
  for await (const c of req) { s += c; if (s.length > 200_000) throw new Error('Too large'); }
  return s ? JSON.parse(s) : {};
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (req.method === 'OPTIONS') return send(req, res, 204, '', 'text/plain');
    if (url.pathname === '/vibe.js') {
      return send(req, res, 200, fs.readFileSync(path.join(HERE, 'client', 'vibe.js'), 'utf8'), 'text/javascript');
    }
    if (url.pathname === '/link') {
      // only from this computer
      const ip = req.socket.remoteAddress || '';
      if (!/^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(ip)) return send(req, res, 403, { error: 'Local only' });
      return send(req, res, 200, newLink() + '\n', 'text/plain');
    }
    if (!url.pathname.startsWith('/api/')) return send(req, res, 404, { error: 'Not found' });
    if (req.headers.origin !== SITE) return send(req, res, 403, { error: 'Wrong origin' });

    if (url.pathname === '/api/handoff' && req.method === 'POST') {
      const { code } = await readJson(req);
      const exp = codes.get(code);
      codes.delete(code);
      if (!exp || exp < Date.now()) return send(req, res, 401, { error: 'This sign-in link has expired. Ask for a new one.' });
      const token = crypto.randomBytes(24).toString('base64url');
      tokens.set(token, EDITOR);
      return send(req, res, 200, { token, user: EDITOR });
    }

    const auth = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    const user = auth && tokens.get(auth[1]);
    if (!user) return send(req, res, 401, { error: 'Signed out. Open a new sign-in link.' });

    if (url.pathname === '/api/state' && req.method === 'GET') {
      return send(req, res, 200, { user, drafts: service.list(), deploy: { ...deploy, log: deploy.log.slice(-8) }, history: repo.log(8) });
    }
    if (url.pathname === '/api/drafts' && req.method === 'POST') {
      return send(req, res, 200, await service.change(await readJson(req), user));
    }
    const m = /^\/api\/drafts\/([\w*-]+)(\/choose)?$/.exec(url.pathname);
    if (m && m[2] && req.method === 'POST') return send(req, res, 200, { draft: service.choose(m[1], (await readJson(req)).choice) });
    if (m && !m[2] && req.method === 'DELETE') return send(req, res, 200, { removed: service.discard(m[1]) });
    if (url.pathname === '/api/publish' && req.method === 'POST') {
      if (deploy.state === 'building') return send(req, res, 409, { error: 'A publish is still building. Try again when it is live.' });
      const r = await service.publish(user);
      if (r.sha) runDeploy(r.sha);
      return send(req, res, 200, r);
    }
    return send(req, res, 404, { error: 'Not found' });
  } catch (e) {
    console.error(e);
    return send(req, res, 500, { error: e.message });
  }
});

server.listen(PORT, () => {
  console.log(`Vibe CMS source mode on http://localhost:${PORT}  (repo ${REPO_DIR}, branch ${BRANCH})`);
  console.log(`Sign-in link (15 minutes, once): ${newLink()}`);
  console.log(`More links: http://localhost:${PORT}/link`);
});
