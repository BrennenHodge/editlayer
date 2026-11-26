// Connecting a hosted AI connector (the Vibe CMS connector that ChatGPT and Claude list in their directories).
//
// The connector never sees a password. It sends the site's admin here; the admin signs in to their own site as
// usual, chooses what the assistant may do, and the site redirects back to the connector with a one-time code.
// The connector then swaps that code, plus the PKCE verifier only it knows, for a connection key over a direct
// server-to-server call, so the key never passes through the browser.
//
//   GET  /_cms/connect/info      public: is this a Vibe CMS site, and its name
//   GET  /_cms/connect           the approval screen (admins only)
//   POST /_cms/connect           approve or cancel; redirects to <hub>/callback
//   POST /_cms/connect/token     connector: { code, code_verifier, hub } -> { key, role, ... }
//   POST /_cms/connect/revoke    connector: "Authorization: Bearer <key>" turns that key off
//
// Only listed connectors can ask (OFFICIAL_HUBS, opts.connect.hubs, or env.VIBECMS_HUBS), so a look-alike site
// can't use this screen to collect keys. A site running on localhost also accepts a connector on localhost.
import { json, randomToken, sha256Hex, escapeHtml, hasRole, b64url } from '../util.js';
import { screen } from '../pages.js';
import { createToken } from './mcp.js';

export const OFFICIAL_HUBS = [];   // the hosted connector's origin, set once its domain is chosen
const CODE_MS = 5 * 60 * 1000;

const isLocal = (host) => host === 'localhost' || host === '127.0.0.1' || host === '[::1]';

function allowedHubs(env, opts, url) {
  const extra = String(env.VIBECMS_HUBS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return new Set([...OFFICIAL_HUBS, ...((opts.connect && opts.connect.hubs) || []), ...extra]);
}

/** The connector's origin if this site accepts it, else null. */
function checkHub(env, opts, url, value) {
  let hub;
  try { hub = new URL(String(value || '')); } catch { return null; }
  if (hub.pathname !== '/' || hub.search || hub.hash || hub.username || hub.password) return null;
  if (allowedHubs(env, opts, url).has(hub.origin)) return hub.origin;
  if (isLocal(url.hostname) && hub.protocol === 'http:' && isLocal(hub.hostname)) return hub.origin;
  return null;
}

const cleanName = (s) => String(s || '').replace(/[^\p{L}\p{N} ._()'&+-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 40) || 'AI assistant';
const challengeOk = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{43}$/.test(s);
const stateOk = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(s);

async function s256(verifier) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return b64url(new Uint8Array(buf));
}

function backTo(hub, params) {
  const u = new URL('/callback', hub);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return new Response(null, { status: 303, headers: { location: u.toString(), 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
}

function approvalScreen(opts, { hub, name, state, challenge, user }) {
  const hubHost = new URL(hub).host;
  const hidden = (k, v) => `<input type="hidden" name="${k}" value="${escapeHtml(v)}">`;
  return screen(opts, `Let ${name} edit this site?`, `
<p style="margin-top:0">${escapeHtml(name)} is asking, through the Vibe CMS connector at <strong>${escapeHtml(hubHost)}</strong>, to read and edit <strong>${escapeHtml(opts.siteName)}</strong> when you ask it to in a conversation.</p>
<form method="post" action="/_cms/connect">
  ${hidden('hub', hub)}${hidden('name', name)}${hidden('state', state)}${hidden('code_challenge', challenge)}
  <fieldset style="border:1px solid var(--line);border-radius:9px;padding:6px 14px 12px;margin:18px 0 0">
    <legend style="font-size:14px;font-weight:600;padding:0 4px">What may it do?</legend>
    <label style="display:flex;gap:10px;align-items:flex-start;font-weight:400;margin:10px 0 0"><input type="radio" name="role" value="author" checked style="width:auto;margin-top:5px"><span><strong>Save drafts only.</strong> You review and publish from the editor.</span></label>
    <label style="display:flex;gap:10px;align-items:flex-start;font-weight:400;margin:10px 0 0"><input type="radio" name="role" value="editor" style="width:auto;margin-top:5px"><span><strong>Save drafts and publish.</strong> It asks you before publishing.</span></label>
  </fieldset>
  <button type="submit" name="decision" value="allow">Allow</button>
  <button type="submit" name="decision" value="deny" style="margin-top:10px;background:transparent;color:inherit;border:1px solid var(--line)">Cancel</button>
</form>
<p class="hint">Signed in as ${escapeHtml(user.email)}. Every change it makes is kept in the page history. You can turn it off any time under Editors &gt; AI assistants.</p>`);
}

async function connectPage(rctx) {
  const { request, env, url, opts } = rctx;
  if (request.method === 'GET') {
    const q = url.searchParams;
    const hub = checkHub(env, opts, url, q.get('hub'));
    if (!hub) return screen(opts, 'Unknown connector', '<p>This link didn’t come from a connector this site trusts, so it can’t be used to connect an assistant.</p>', 400);
    const state = q.get('state');
    const challenge = q.get('code_challenge');
    if (!stateOk(state) || !challengeOk(challenge) || (q.get('code_challenge_method') || 'S256') !== 'S256') {
      return screen(opts, 'This link is broken', '<p>Start connecting again from your AI assistant.</p>', 400);
    }
    const user = await rctx.getUser();
    if (!user) {
      return new Response(null, { status: 303, headers: { location: `/_cms/login?next=${encodeURIComponent(url.pathname + url.search)}`, 'cache-control': 'no-store' } });
    }
    if (!hasRole(user, 'admin')) {
      return screen(opts, 'Ask a site admin', `<p>Only an admin of ${escapeHtml(opts.siteName)} can connect an AI assistant. You’re signed in as ${escapeHtml(user.email)}.</p>`, 403);
    }
    return approvalScreen(opts, { hub, name: cleanName(q.get('client')), state, challenge, user });
  }

  if (request.method !== 'POST' || !rctx.sameOrigin) return new Response('Forbidden', { status: 403 });
  const form = await request.formData();
  const hub = checkHub(env, opts, url, form.get('hub'));
  const state = form.get('state');
  const challenge = form.get('code_challenge');
  if (!hub || !stateOk(state) || !challengeOk(challenge)) return screen(opts, 'This link is broken', '<p>Start connecting again from your AI assistant.</p>', 400);
  if (form.get('decision') !== 'allow') return backTo(hub, { error: 'access_denied', state });
  const user = await rctx.getUser();
  if (!user || !hasRole(user, 'admin')) return screen(opts, 'Ask a site admin', '<p>Only an admin can connect an AI assistant.</p>', 403);

  const code = randomToken(32);
  const role = form.get('role') === 'editor' ? 'editor' : 'author';
  await env.CMS_DB.batch([
    env.CMS_DB.prepare('DELETE FROM cms_connect_grants WHERE expires_at < ?').bind(Date.now()),
    env.CMS_DB.prepare('INSERT INTO cms_connect_grants (code_hash, hub, name, role, created_by, challenge, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(await sha256Hex(code), hub, cleanName(form.get('name')), role, user.email, challenge, Date.now() + CODE_MS),
  ]);
  return backTo(hub, { code, state });
}

async function tokenRoute(rctx) {
  const { request, env, url, opts } = rctx;
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_request', error_description: 'Send JSON.' }, 400); }
  const code = typeof body.code === 'string' ? body.code : '';
  const verifier = typeof body.code_verifier === 'string' ? body.code_verifier : '';
  const hub = checkHub(env, opts, url, body.hub);
  if (!hub || code.length < 20 || code.length > 100 || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) {
    return json({ error: 'invalid_request', error_description: 'code, code_verifier and a trusted hub are required.' }, 400);
  }
  const hash = await sha256Hex(code);
  const row = await env.CMS_DB.prepare('SELECT * FROM cms_connect_grants WHERE code_hash = ?').bind(hash).first();
  // One use, whatever happens next.
  await env.CMS_DB.prepare('DELETE FROM cms_connect_grants WHERE code_hash = ?').bind(hash).run();
  if (!row || row.expires_at < Date.now() || row.hub !== hub || (await s256(verifier)) !== row.challenge) {
    return json({ error: 'invalid_grant', error_description: 'The approval code is wrong, used or expired. Connect again.' }, 400);
  }
  const admin = await env.CMS_DB.prepare("SELECT 1 FROM cms_users WHERE email = ? AND role = 'admin'").bind(row.created_by).first();
  if (!admin) return json({ error: 'invalid_grant', error_description: 'The person who approved this is no longer an admin.' }, 400);
  const key = await createToken(env, { name: row.name, role: row.role, createdBy: row.created_by });
  return json({ key, role: row.role, site: opts.siteName, url: url.origin, approved_by: row.created_by }, 200, { 'cache-control': 'no-store' });
}

async function revokeRoute(rctx) {
  const { request, env } = rctx;
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const key = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') || '')?.[1] || '';
  if (!/^vcms_[A-Za-z0-9_-]{20,}$/.test(key)) return json({ error: 'invalid_token' }, 401);
  const r = await env.CMS_DB.prepare('DELETE FROM cms_ai_tokens WHERE token_hash = ?').bind(await sha256Hex(key)).run();
  return json({ ok: true, revoked: Boolean(r.meta && r.meta.changes) });
}

function infoRoute(rctx) {
  return json({ vibecms: true, name: rctx.opts.siteName, connect: 1 }, 200, { 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
}

export default {
  name: 'connect',
  routes: [
    { path: /^\/_cms\/connect\/info\/?$/, handler: infoRoute },
    { path: /^\/_cms\/connect\/token\/?$/, handler: tokenRoute },
    { path: /^\/_cms\/connect\/revoke\/?$/, handler: revokeRoute },
    { path: /^\/_cms\/connect\/?$/, handler: connectPage },
  ],
};
