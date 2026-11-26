// Editlayer connector ("the hub"): one public MCP server with OAuth sign-in, so ChatGPT, Claude and other
// assistants can list a single Editlayer app in their directories while every website keeps its own data.
//
//   Assistant ──OAuth 2.1 + PKCE──▶ hub ──(admin approves on their own site)──▶ site /_cms/connect
//   Assistant ──MCP (Bearer)──────▶ hub /mcp ──(site key, server to server)──▶ site /_cms/mcp
//
// The hub has no accounts and no passwords. Signing in means: type your site's address, sign in to that site
// as you always do, and approve the assistant there (drafts only, or drafts and publishing). The site hands the
// hub a connection key through a one-time code plus a PKCE verifier, server to server. The hub stores that key
// encrypted (AES-GCM, HUB_KEY) and forwards tool calls to the site, which enforces roles, sanitizing, history
// and rate limits exactly as for any other connection. Page content passes through; it is never stored.
//
// OAuth: authorization code + PKCE S256 only, public clients, dynamic client registration (RFC 7591) and client
// ID metadata documents, RFC 8414 + RFC 9728 metadata, RFC 9207 iss in every authorization response, rotating
// refresh tokens. Codes and tokens are stored as SHA-256 hashes.
import { TOOLS as SITE_TOOLS, UNTRUSTED } from '../../engine/src/features/mcp/tools.js';

const ACCESS_S = 3600;
const REFRESH_S = 90 * 86400;
const CODE_MS = 5 * 60 * 1000;
const REQUEST_MS = 30 * 60 * 1000;
const CIMD_MS = 24 * 3600 * 1000;
const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const SCOPES = ['sites'];
const VERSION = '1.0.0';

/* ------------------------------------------------------------------------------------------ helpers */

const enc = new TextEncoder();
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const randomToken = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));
const sha256 = async (s) => b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s))));
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const parseUrl = (s) => { try { return new URL(String(s)); } catch { return null; } };
const now = () => Date.now();

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization, mcp-protocol-version, mcp-session-id',
  'access-control-expose-headers': 'www-authenticate, mcp-session-id',
};
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...CORS, ...headers },
});
const oauthError = (error, description, status = 400) => json({ error, error_description: description }, status);

function redirect(location, headers = {}) {
  return new Response(null, { status: 303, headers: { location, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', ...headers } });
}

/** Redirects to the client with RFC 9207 iss on every response. */
function toClient(origin, redirectUri, params) {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries({ ...params, iss: origin })) if (v != null && v !== '') u.searchParams.set(k, v);
  return redirect(u.toString());
}

/* -------------------------------------------------------------------------------- site key crypto */

async function aesKey(env) {
  const raw = env.HUB_KEY ? fromB64url(String(env.HUB_KEY).trim().replace(/=+$/, '')) : null;
  if (!raw || raw.length !== 32) throw new Error('HUB_KEY secret is missing or is not 32 bytes of base64.');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function seal(env, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(env), enc.encode(text)));
  return `${b64url(iv)}.${b64url(ct)}`;
}
async function unseal(env, sealed) {
  const [iv, ct] = String(sealed).split('.');
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64url(iv) }, await aesKey(env), fromB64url(ct)));
}

/* ------------------------------------------------------------------------------------------ pages */

function page(env, title, body, status = 200, headers = {}) {
  const info = env.SITE_URL || 'https://editlayer.co';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>${escapeHtml(title)} · Editlayer</title>
<style>
:root{--ink:#121316;--mute:#5d6470;--line:#dcdfe4;--bg:#f5f4f0;--card:#fff;--accent:#5b3df5;--on:#fff;--err-bg:#fdecec;--err:#8a1c1c;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--ink:#eef0f3;--mute:#a5adb8;--line:#2d333b;--bg:#101215;--card:#181b20;--accent:#9d8bff;--on:#121316;--err-bg:#3a1717;--err:#ffc9c9;color-scheme:dark}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;min-height:100vh;background:var(--bg);color:var(--ink);font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;display:flex;flex-direction:column;align-items:center;padding:24px 16px}
main{width:100%;max-width:440px;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:28px 22px}
.brand{display:flex;align-items:center;gap:10px;font-weight:700;margin:0 0 22px}.brand svg{width:28px;height:28px;flex:none}
.eyebrow{font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:var(--mute);margin:0 0 6px}
h1{font-size:23px;line-height:1.25;margin:0 0 12px;text-wrap:balance}p{margin:0 0 14px}
label{display:block;font-size:14px;font-weight:600;margin:18px 0 6px}
input[type=text],input[type=url]{width:100%;font:inherit;padding:12px;border:1px solid var(--line);border-radius:10px;background:transparent;color:inherit}
input:focus-visible,button:focus-visible,a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
button{width:100%;font:inherit;font-weight:600;padding:13px;border:0;border-radius:10px;background:var(--accent);color:var(--on);cursor:pointer;margin-top:14px;min-height:48px}
button.quiet{background:transparent;color:inherit;border:1px solid var(--line)}
.err{background:var(--err-bg);color:var(--err);border-radius:10px;padding:10px 12px;font-size:15px}
.sites{list-style:none;padding:0;margin:0 0 6px}.sites li{border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin:8px 0;overflow-wrap:anywhere}
.sites small{display:block;color:var(--mute)}
.hint{font-size:14px;color:var(--mute)}a{color:inherit}
footer{max-width:440px;width:100%;font-size:13px;color:var(--mute);text-align:center;padding:16px 0}
</style></head><body><main>
<p class="brand"><svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="9" fill="#121316"/><path d="M7.6 10.4h11M7.6 16h7.6M7.6 21.6h11" fill="none" stroke="#c6f135" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/><rect x="23" y="8" width="2.8" height="16" rx="1.4" fill="#9d8bff"/></svg>Editlayer</p>
${body}</main>
<footer><a href="${escapeHtml(info)}/privacy/">Privacy</a> · <a href="${escapeHtml(info)}/terms/">Terms</a> · <a href="${escapeHtml(info)}/support/">Support</a></footer>
</body></html>`;
  return new Response(html, {
    status,
    headers: {
      // "same-origin", not "no-referrer": with no-referrer browsers send "Origin: null" on our own forms, which the
      // same-origin check refuses. Redirects that carry codes set no-referrer themselves.
      'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'same-origin',
      'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY',
      // Forms post here, then redirect to the site (https) or back to the assistant (https or loopback).
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; form-action 'self' https: http://localhost:* http://127.0.0.1:*; frame-ancestors 'none'; base-uri 'none'",
      ...headers,
    },
  });
}

const errorPage = (env, title, text, status = 400) => page(env, title, `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(text)}</p>`, status);

function requestPage(env, { req, client, sites, error = '', site = '' }) {
  const name = escapeHtml(client.name);
  const list = sites.length
    ? `<p class="hint" style="margin-bottom:4px">Connected so far:</p><ul class="sites">${sites.map((s) => `<li><strong>${escapeHtml(s.name)}</strong><small>${escapeHtml(new URL(s.origin).host)} · ${s.role === 'editor' ? 'drafts and publishing' : 'drafts only'}</small></li>`).join('')}</ul>`
    : '';
  const finish = sites.length
    ? `<form method="post" action="/authorize/finish"><input type="hidden" name="rid" value="${escapeHtml(req.id)}"><button type="submit">Done, go back to ${name}</button></form>`
    : '';
  return page(env, `Connect ${client.name}`, `
<p class="eyebrow">Connect an assistant</p>
${sites.length
    ? `<h1>${name} is connected</h1>
<p>Go back to ${name} and ask it to change something on your website. You can also add another website now.</p>`
    : `<h1>Let ${name} edit your website</h1>
<p>Enter the address of a website that uses Editlayer. You’ll sign in to that site and choose what ${name} may do there.</p>`}
${list}
${error ? `<p class="err" role="alert">${escapeHtml(error)}</p>` : ''}
<form method="post" action="/authorize/site">
  <input type="hidden" name="rid" value="${escapeHtml(req.id)}">
  <label for="site">${sites.length ? 'Add another website' : 'Website address'}</label>
  <input id="site" name="site" type="text" inputmode="url" autocomplete="url" autocapitalize="off" spellcheck="false" required placeholder="example.com" value="${escapeHtml(site)}"${sites.length ? '' : ' autofocus'}>
  <button type="submit"${sites.length ? ' class="quiet"' : ''}>${sites.length ? 'Add this website' : 'Continue'}</button>
</form>
${finish}
<form method="post" action="/authorize/cancel"><input type="hidden" name="rid" value="${escapeHtml(req.id)}"><button type="submit" class="quiet">Cancel</button></form>
<p class="hint" style="margin-top:16px">Only a site admin can approve. Your password stays with your website; this connector never sees it.</p>`);
}

/* ---------------------------------------------------------------------------------------- clients */

function validRedirect(u) {
  const x = parseUrl(u);
  if (!x || x.hash || x.username || x.password) return false;
  if (x.protocol === 'https:') return true;
  return x.protocol === 'http:' && LOOPBACK.has(x.hostname);
}

/** Exact match, except that loopback redirects may use any port (RFC 8252). */
function redirectMatches(registered, uri) {
  if (registered.includes(uri)) return true;
  const u = parseUrl(uri);
  if (!u || u.protocol !== 'http:' || !LOOPBACK.has(u.hostname)) return false;
  return registered.some((r) => {
    const v = parseUrl(r);
    return v && v.protocol === 'http:' && v.hostname === u.hostname && v.pathname === u.pathname && v.search === u.search;
  });
}

const cleanName = (s, fallback) => String(s || '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60) || fallback;

async function getClient(env, id) {
  if (typeof id !== 'string' || !id || id.length > 500) return null;
  if (id.startsWith('https://')) return metadataClient(env, id);
  const row = await env.DB.prepare("SELECT * FROM clients WHERE id = ? AND kind = 'dcr'").bind(id).first();
  return row ? { id: row.id, name: row.name, redirect_uris: JSON.parse(row.redirect_uris) } : null;
}

/** Client ID metadata document: the client_id is an https URL serving the client's own description. */
async function metadataClient(env, id) {
  const u = parseUrl(id);
  if (!u || u.protocol !== 'https:' || u.pathname === '/' || u.hash || u.username || u.password) return null;
  const cached = await env.DB.prepare("SELECT * FROM clients WHERE id = ? AND kind = 'cimd'").bind(id).first();
  if (cached && cached.fetched_at > now() - CIMD_MS) return { id, name: cached.name, redirect_uris: JSON.parse(cached.redirect_uris) };
  let doc;
  try {
    // Workers don't support redirect: 'error'; 'manual' plus the status check below refuses redirects the same way.
    const res = await fetch(id, { headers: { accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(5000) });
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (text.length > 20000) throw new Error('too large');
    doc = JSON.parse(text);
  } catch (err) {
    console.log(JSON.stringify({ t: 'cimd_fetch_failed', client: u.host, error: String(err && err.message) }));
    return cached ? { id, name: cached.name, redirect_uris: JSON.parse(cached.redirect_uris) } : null;
  }
  if (!doc || doc.client_id !== id || !Array.isArray(doc.redirect_uris) || !doc.redirect_uris.length || !doc.redirect_uris.every(validRedirect)) return null;
  const name = cleanName(doc.client_name, u.host);
  await env.DB.prepare(`INSERT INTO clients (id, kind, name, redirect_uris, created_at, fetched_at) VALUES (?, 'cimd', ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET name = excluded.name, redirect_uris = excluded.redirect_uris, fetched_at = excluded.fetched_at`)
    .bind(id, name, JSON.stringify(doc.redirect_uris), now(), now()).run();
  return { id, name, redirect_uris: doc.redirect_uris };
}

async function register(request, env) {
  let body;
  try { body = await request.json(); } catch { return oauthError('invalid_client_metadata', 'Send the client metadata as JSON.'); }
  const uris = body && body.redirect_uris;
  if (!Array.isArray(uris) || !uris.length || uris.length > 10 || !uris.every((u) => typeof u === 'string' && u.length <= 2000 && validRedirect(u))) {
    return oauthError('invalid_redirect_uri', 'redirect_uris must be https URLs, or http URLs on localhost / 127.0.0.1.');
  }
  for (const g of body.grant_types || []) if (!['authorization_code', 'refresh_token'].includes(g)) return oauthError('invalid_client_metadata', `Unsupported grant type: ${g}`);
  const id = `vc_${randomToken(18)}`;
  const name = cleanName(body.client_name, 'AI assistant');
  await env.DB.prepare("INSERT INTO clients (id, kind, name, redirect_uris, created_at) VALUES (?, 'dcr', ?, ?, ?)").bind(id, name, JSON.stringify(uris), now()).run();
  return json({
    client_id: id, client_id_issued_at: Math.floor(now() / 1000), client_name: name, redirect_uris: uris,
    grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none',
  }, 201);
}

/* ------------------------------------------------------------------------------------ authorization */

const resourceOf = (origin) => `${origin}/mcp`;
function resourceOk(origin, r) {
  if (!r) return true;
  const want = resourceOf(origin);
  return r === want || r === `${want}/` || r === origin || r === `${origin}/`;
}

const browserCookie = (url, rid) => `${url.protocol === 'https:' ? '__Host-' : ''}vhub_${rid.slice(0, 12)}`;
function readCookie(request, name) {
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

/** The sign-in in progress, if this browser started it and it hasn't expired. */
async function loadRequest(request, env, url, rid) {
  if (typeof rid !== 'string' || !/^[A-Za-z0-9_-]{20,40}$/.test(rid)) return null;
  const req = await env.DB.prepare('SELECT * FROM requests WHERE id = ?').bind(rid).first();
  if (!req || req.expires_at < now()) return null;
  const b = readCookie(request, browserCookie(url, rid));
  if (!b || (await sha256(b)) !== req.browser_hash) return null;
  return req;
}

const sitesOf = async (env, grantId) => (await env.DB.prepare('SELECT origin, name, role, approved_by, key_enc, created_at FROM sites WHERE grant_id = ? ORDER BY created_at').bind(grantId).all()).results;

async function authorize(request, env, url) {
  const q = url.searchParams;
  const client = await getClient(env, q.get('client_id'));
  if (!client) return errorPage(env, 'Unknown app', 'The app that sent you here isn’t registered with the Editlayer connector. Try connecting again from the app.');
  const redirectUri = q.get('redirect_uri') || (client.redirect_uris.length === 1 ? client.redirect_uris[0] : '');
  if (!redirectUri || !redirectMatches(client.redirect_uris, redirectUri)) return errorPage(env, 'Unknown return address', 'The app asked to return to an address it didn’t register, so this sign-in was stopped.');
  const state = q.get('state') || '';
  const back = (error, description) => toClient(url.origin, redirectUri, { error, error_description: description, state });
  if (q.get('response_type') !== 'code') return back('unsupported_response_type', 'Only response_type=code is supported.');
  const challenge = q.get('code_challenge') || '';
  if (q.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) return back('invalid_request', 'PKCE with code_challenge_method=S256 is required.');
  const resource = q.get('resource') || '';
  if (!resourceOk(url.origin, resource)) return back('invalid_target', `This server's resource is ${resourceOf(url.origin)}.`);
  if (state.length > 2000) return back('invalid_request', 'state is too long.');

  const rid = randomToken(18);
  const browser = randomToken(24);
  const req = { id: rid };
  await env.DB.prepare(`INSERT INTO requests (id, browser_hash, client_id, redirect_uri, state, code_challenge, resource, scope, grant_id, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(rid, await sha256(browser), client.id, redirectUri, state, challenge, resource || null, (q.get('scope') || '').slice(0, 200), `g_${randomToken(18)}`, now() + REQUEST_MS).run();
  const secure = url.protocol === 'https:' ? '; Secure' : '';
  return withCookie(requestPage(env, { req, client, sites: [] }), `${browserCookie(url, rid)}=${browser}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${REQUEST_MS / 1000}${secure}`);
}

function withCookie(res, cookie) {
  const out = new Response(res.body, res);
  out.headers.append('set-cookie', cookie);
  return out;
}

/** "example.com", "https://example.com/about" → "https://example.com". */
function siteOrigin(env, input) {
  let s = String(input || '').trim();
  if (!s || s.length > 300) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`;
  const u = parseUrl(s);
  if (!u || u.username || u.password || !u.hostname.includes('.') && !LOOPBACK.has(u.hostname)) return null;
  if (u.protocol === 'https:') return LOOPBACK.has(u.hostname) && env.ALLOW_HTTP_SITES !== '1' ? null : u.origin;
  if (u.protocol === 'http:' && env.ALLOW_HTTP_SITES === '1' && LOOPBACK.has(u.hostname)) return u.origin;
  return null;
}

async function addSite(request, env, url) {
  const form = await request.formData();
  const req = await loadRequest(request, env, url, form.get('rid'));
  if (!req) return errorPage(env, 'This sign-in has expired', 'Start connecting again from your AI assistant.');
  const client = await getClient(env, req.client_id);
  if (!client) return errorPage(env, 'Unknown app', 'Start connecting again from your AI assistant.');
  const sites = await sitesOf(env, req.grant_id);
  const typed = String(form.get('site') || '');
  const origin = siteOrigin(env, typed);
  const again = (error) => requestPage(env, { req, client, sites, error, site: typed });
  if (!origin) return again('Enter a website address, such as example.com.');
  if (sites.length >= 20) return again('You can connect up to 20 websites at once.');
  let info;
  try {
    const res = await fetch(`${origin}/_cms/connect/info`, { headers: { accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(8000) });
    info = res.ok ? await res.json() : null;
  } catch { info = null; }
  if (!info || info.editlayer !== true || !info.connect) {
    return again(`We couldn’t find Editlayer at ${new URL(origin).host}. Check the address, or ask the site’s developer to update Editlayer.`);
  }
  const verifier = randomToken(32);
  const siteState = randomToken(24);
  await env.DB.prepare('UPDATE requests SET site_origin = ?, site_verifier = ?, site_state = ? WHERE id = ?').bind(origin, verifier, siteState, req.id).run();
  const to = new URL('/_cms/connect', origin);
  to.searchParams.set('hub', url.origin);
  to.searchParams.set('client', client.name);
  to.searchParams.set('state', siteState);
  to.searchParams.set('code_challenge', await sha256(verifier));
  to.searchParams.set('code_challenge_method', 'S256');
  return redirect(to.toString());
}

async function siteCallback(request, env, url) {
  const q = url.searchParams;
  const siteState = q.get('state') || '';
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(siteState)) return errorPage(env, 'This link is broken', 'Start connecting again from your AI assistant.');
  const row = await env.DB.prepare('SELECT id FROM requests WHERE site_state = ?').bind(siteState).first();
  const req = row && await loadRequest(request, env, url, row.id);
  if (!req) return errorPage(env, 'This sign-in has expired', 'Start connecting again from your AI assistant, in the same browser.');
  const client = await getClient(env, req.client_id);
  const origin = req.site_origin;
  await env.DB.prepare('UPDATE requests SET site_state = NULL, site_verifier = NULL WHERE id = ?').bind(req.id).run();
  const sites = await sitesOf(env, req.grant_id);
  const host = new URL(origin).host;
  if (q.get('error')) return requestPage(env, { req, client, sites, error: `Not connected: approval was cancelled on ${host}.` });
  let got;
  try {
    const res = await fetch(`${origin}/_cms/connect/token`, {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, redirect: 'manual',
      body: JSON.stringify({ code: q.get('code') || '', code_verifier: req.site_verifier, hub: url.origin }),
      signal: AbortSignal.timeout(10000),
    });
    got = await res.json().catch(() => null);
    if (!res.ok || !got || typeof got.key !== 'string') throw new Error((got && got.error_description) || `HTTP ${res.status}`);
  } catch (err) {
    return requestPage(env, { req, client, sites, error: `${host} didn’t confirm the connection (${String(err && err.message).slice(0, 160)}). Try again.` });
  }
  if (got.url && new URL(got.url).origin !== origin) return requestPage(env, { req, client, sites, error: `${host} answered for a different address. Try again.` });
  await env.DB.prepare(`INSERT INTO sites (grant_id, origin, name, role, approved_by, key_enc, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (grant_id, origin) DO UPDATE SET name = excluded.name, role = excluded.role, approved_by = excluded.approved_by, key_enc = excluded.key_enc`)
    .bind(req.grant_id, origin, cleanName(got.site, host), got.role === 'editor' ? 'editor' : 'author', cleanName(got.approved_by, ''), await seal(env, got.key), now()).run();
  return redirect(`/authorize/r?rid=${encodeURIComponent(req.id)}`);
}

async function showRequest(request, env, url) {
  const req = await loadRequest(request, env, url, url.searchParams.get('rid'));
  if (!req) return errorPage(env, 'This sign-in has expired', 'Start connecting again from your AI assistant.');
  const client = await getClient(env, req.client_id);
  return requestPage(env, { req, client, sites: await sitesOf(env, req.grant_id) });
}

async function finish(request, env, url) {
  const form = await request.formData();
  const req = await loadRequest(request, env, url, form.get('rid'));
  if (!req) return errorPage(env, 'This sign-in has expired', 'Start connecting again from your AI assistant.');
  const sites = await sitesOf(env, req.grant_id);
  if (!sites.length) return showRequest(request, env, new URL(`/authorize/r?rid=${req.id}`, url));
  const code = randomToken(32);
  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO grants (id, client_id, created_at) VALUES (?, ?, ?)').bind(req.grant_id, req.client_id, now()),
    env.DB.prepare('INSERT INTO codes (hash, grant_id, client_id, redirect_uri, code_challenge, resource, scope, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(await sha256(code), req.grant_id, req.client_id, req.redirect_uri, req.code_challenge, req.resource, req.scope, now() + CODE_MS),
    env.DB.prepare('DELETE FROM requests WHERE id = ?').bind(req.id),
  ]);
  const res = toClient(url.origin, req.redirect_uri, { code, state: req.state });
  return withCookie(res, `${browserCookie(url, req.id)}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${url.protocol === 'https:' ? '; Secure' : ''}`);
}

async function cancel(request, env, url) {
  const form = await request.formData();
  const req = await loadRequest(request, env, url, form.get('rid'));
  if (!req) return errorPage(env, 'This sign-in has expired', 'You can close this page.');
  // Turn off any site keys already collected for this sign-in.
  for (const s of await sitesOf(env, req.grant_id)) await revokeAtSite(env, s);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sites WHERE grant_id = ?').bind(req.grant_id),
    env.DB.prepare('DELETE FROM requests WHERE id = ?').bind(req.id),
  ]);
  return toClient(url.origin, req.redirect_uri, { error: 'access_denied', error_description: 'The person cancelled.', state: req.state });
}

/* ------------------------------------------------------------------------------------------- token */

async function issueTokens(env, grant) {
  const access = `vca_${randomToken(32)}`;
  const refresh = `vcr_${randomToken(32)}`;
  await env.DB.batch([
    env.DB.prepare('INSERT INTO tokens (hash, kind, grant_id, client_id, resource, scope, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(await sha256(access), 'access', grant.grant_id, grant.client_id, grant.resource, grant.scope, now() + ACCESS_S * 1000),
    env.DB.prepare('INSERT INTO tokens (hash, kind, grant_id, client_id, resource, scope, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(await sha256(refresh), 'refresh', grant.grant_id, grant.client_id, grant.resource, grant.scope, now() + REFRESH_S * 1000),
  ]);
  return json({ access_token: access, token_type: 'Bearer', expires_in: ACCESS_S, refresh_token: refresh, scope: grant.scope || SCOPES.join(' ') });
}

async function token(request, env, url) {
  const type = (request.headers.get('content-type') || '').toLowerCase();
  let p;
  if (type.startsWith('application/x-www-form-urlencoded')) p = new URLSearchParams(await request.text());
  else if (type.startsWith('application/json')) p = new URLSearchParams(Object.entries(await request.json().catch(() => ({}))).map(([k, v]) => [k, String(v)]));
  else return oauthError('invalid_request', 'Send the token request as application/x-www-form-urlencoded.');
  const clientId = p.get('client_id') || '';
  const resource = p.get('resource') || '';
  if (!resourceOk(url.origin, resource)) return oauthError('invalid_target', `This server's resource is ${resourceOf(url.origin)}.`);

  if (p.get('grant_type') === 'authorization_code') {
    const hash = await sha256(p.get('code') || '');
    const code = await env.DB.prepare('SELECT * FROM codes WHERE hash = ?').bind(hash).first();
    await env.DB.prepare('DELETE FROM codes WHERE hash = ?').bind(hash).run();   // one use
    if (!code || code.expires_at < now()) return oauthError('invalid_grant', 'The authorization code is wrong, used or expired.');
    if (code.client_id !== clientId) return oauthError('invalid_grant', 'The code was issued to a different client.');
    if (code.redirect_uri !== (p.get('redirect_uri') || '')) return oauthError('invalid_grant', 'redirect_uri doesn’t match the authorization request.');
    const verifier = p.get('code_verifier') || '';
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || (await sha256(verifier)) !== code.code_challenge) return oauthError('invalid_grant', 'code_verifier doesn’t match the code_challenge.');
    if (resource && code.resource && !resourceOk(url.origin, code.resource)) return oauthError('invalid_target', 'resource doesn’t match the authorization request.');
    return issueTokens(env, { grant_id: code.grant_id, client_id: code.client_id, resource: resource || code.resource, scope: code.scope });
  }

  if (p.get('grant_type') === 'refresh_token') {
    const hash = await sha256(p.get('refresh_token') || '');
    const row = await env.DB.prepare("SELECT * FROM tokens WHERE hash = ? AND kind = 'refresh'").bind(hash).first();
    if (!row || row.expires_at < now()) return oauthError('invalid_grant', 'The refresh token is wrong, expired or was replaced.');
    if (clientId && row.client_id !== clientId) return oauthError('invalid_grant', 'The refresh token was issued to a different client.');
    const live = await env.DB.prepare('SELECT COUNT(*) AS n FROM sites WHERE grant_id = ?').bind(row.grant_id).first();
    await env.DB.prepare('DELETE FROM tokens WHERE hash = ?').bind(hash).run();   // rotate
    if (!live || !live.n) return oauthError('invalid_grant', 'No websites are connected any more. Connect again.');
    return issueTokens(env, { grant_id: row.grant_id, client_id: row.client_id, resource: row.resource, scope: row.scope });
  }
  return oauthError('unsupported_grant_type', 'Use authorization_code or refresh_token.');
}

async function revokeToken(request, env) {
  const p = new URLSearchParams(await request.text().catch(() => ''));
  const t = p.get('token');
  if (t) await env.DB.prepare('DELETE FROM tokens WHERE hash = ?').bind(await sha256(t)).run();
  return new Response(null, { status: 200, headers: CORS });   // RFC 7009: same answer either way
}

/* -------------------------------------------------------------------------------------------- MCP */

const SITE_ARG = {
  type: 'string',
  description: 'Which connected website to use: its address (e.g. "example.com") or name from list_sites. Only needed when more than one website is connected.',
};

const HUB_TOOLS = [
  {
    name: 'list_sites', title: 'List connected websites',
    description: 'Lists the websites this connection can reach, with what it may do on each (drafts only, or drafts and publishing). Call it first when the person has more than one website.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  ...SITE_TOOLS.map((t) => ({ ...t, inputSchema: { ...t.inputSchema, properties: { ...t.inputSchema.properties, site: SITE_ARG } } })),
  {
    name: 'disconnect_site', title: 'Disconnect a website',
    description: 'Turns off this assistant’s access to one website: its connection key is deleted on the website and here. Only when the person asks to disconnect. To use the website again they connect it again.',
    inputSchema: { type: 'object', properties: { site: SITE_ARG }, required: ['site'] },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
];
const SITE_TOOL_NAMES = new Set(SITE_TOOLS.map((t) => t.name));

const unauthorized = (url, error) => json(
  { jsonrpc: '2.0', id: null, error: { code: -32001, message: error ? 'The sign-in has expired or was revoked. Reconnect Editlayer in your assistant.' : 'Sign in to Editlayer first.' } },
  401,
  { 'www-authenticate': `Bearer resource_metadata="${url.origin}/.well-known/oauth-protected-resource"${error ? `, error="${error}"` : ''}` },
);

function pickSite(sites, wanted) {
  if (!sites.length) throw toolError('No websites are connected. Connect one again from your assistant’s settings.');
  if (!wanted) {
    if (sites.length === 1) return sites[0];
    throw toolError(`Several websites are connected (${sites.map((s) => new URL(s.origin).host).join(', ')}). Say which one with the "site" argument.`);
  }
  const w = String(wanted).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const hit = sites.find((s) => new URL(s.origin).host.toLowerCase() === w || new URL(s.origin).host.toLowerCase() === `www.${w}` || s.name.toLowerCase() === String(wanted).trim().toLowerCase());
  if (!hit) throw toolError(`"${String(wanted).slice(0, 80)}" isn’t connected. Connected: ${sites.map((s) => new URL(s.origin).host).join(', ')}.`);
  return hit;
}

const toolError = (message) => Object.assign(new Error(message), { tool: true });
const toolResult = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data });

async function revokeAtSite(env, site) {
  try {
    await fetch(`${site.origin}/_cms/connect/revoke`, { method: 'POST', headers: { authorization: `Bearer ${await unseal(env, site.key_enc)}` }, signal: AbortSignal.timeout(8000) });
  } catch { /* the key is deleted here either way */ }
}

async function callTool(env, grant, name, args) {
  const sites = await sitesOf(env, grant.grant_id);
  if (name === 'list_sites') {
    return toolResult({ sites: sites.map((s) => ({ site: s.name, address: new URL(s.origin).host, url: s.origin, canPublish: s.role === 'editor', approvedBy: s.approved_by || undefined })) });
  }
  if (name === 'disconnect_site') {
    const s = pickSite(sites, args.site);
    await revokeAtSite(env, s);
    await env.DB.prepare('DELETE FROM sites WHERE grant_id = ? AND origin = ?').bind(grant.grant_id, s.origin).run();
    const left = sites.length - 1;
    if (!left) await env.DB.prepare('DELETE FROM tokens WHERE grant_id = ?').bind(grant.grant_id).run();
    return toolResult({ disconnected: new URL(s.origin).host, stillConnected: left, note: left ? undefined : 'No websites are connected now. Remove or reconnect Editlayer in the assistant’s settings.' });
  }
  if (!SITE_TOOL_NAMES.has(name)) throw toolError(`Unknown tool: ${String(name).slice(0, 60)}`);
  const site = pickSite(sites, args.site);
  const { site: _drop, ...forward } = args;
  const host = new URL(site.origin).host;
  let res;
  try {
    res = await fetch(`${site.origin}/_cms/mcp`, {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(25000),
      headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${await unseal(env, site.key_enc)}`, 'mcp-protocol-version': PROTOCOLS[0] },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: forward } }),
    });
  } catch {
    throw toolError(`${host} didn’t answer in time. It may be down; try again in a minute.`);
  }
  if (res.status === 401) {
    await env.DB.prepare('DELETE FROM sites WHERE grant_id = ? AND origin = ?').bind(grant.grant_id, site.origin).run();
    throw toolError(`${host} has turned off this connection (an admin removed it, or the person who approved it is no longer an admin). Connect the website again from the assistant’s settings.`);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) throw toolError(`${host} answered with an error (HTTP ${res.status}). Try again in a minute.`);
  if (data.error) throw toolError(`${host}: ${String(data.error.message || 'the request was refused').slice(0, 400)}`);
  return data.result;
}

async function rpc(env, grant, msg) {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return { jsonrpc: '2.0', id: (msg && msg.id) ?? null, error: { code: -32600, message: 'Invalid request' } };
  if (msg.id === undefined || msg.id === null) return null;   // notification
  const { id, method } = msg;
  const params = msg.params && typeof msg.params === 'object' ? msg.params : {};
  switch (method) {
    case 'initialize': {
      const sites = await sitesOf(env, grant.grant_id);
      const names = sites.map((s) => `${s.name} (${new URL(s.origin).host}, ${s.role === 'editor' ? 'can publish' : 'drafts only'})`).join('; ');
      return {
        jsonrpc: '2.0', id,
        result: {
          protocolVersion: PROTOCOLS.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOLS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'editlayer', title: 'Editlayer', version: VERSION },
          instructions: `You can read and edit the person's websites that use Editlayer. Connected: ${names || 'none'}. `
            + 'Call list_pages, then get_page before editing; prefer replace_text for small changes and keep the site\'s HTML structure and classes. '
            + 'Every change is saved as a draft until it is published: tell the person, share the review link, and ask before calling publish. '
            + (sites.length > 1 ? 'Pass "site" to say which website. ' : '')
            + UNTRUSTED,
        },
      };
    }
    case 'ping': return { jsonrpc: '2.0', id, result: {} };
    case 'tools/list': return { jsonrpc: '2.0', id, result: { tools: HUB_TOOLS } };
    case 'resources/list': return { jsonrpc: '2.0', id, result: { resources: [] } };
    case 'resources/templates/list': return { jsonrpc: '2.0', id, result: { resourceTemplates: [] } };
    case 'prompts/list': return { jsonrpc: '2.0', id, result: { prompts: [] } };
    case 'tools/call': {
      const name = String(params.name || '');
      const args = params.arguments && typeof params.arguments === 'object' && !Array.isArray(params.arguments) ? params.arguments : {};
      const started = now();
      try {
        const result = await callTool(env, grant, name, args);
        console.log(JSON.stringify({ t: 'tool', tool: name, ms: now() - started, ok: !result.isError }));
        return { jsonrpc: '2.0', id, result };
      } catch (e) {
        console.log(JSON.stringify({ t: 'tool', tool: name, ms: now() - started, ok: false, handled: Boolean(e && e.tool) }));
        if (!(e && e.tool)) console.error('editlayer hub tool failed', e && e.stack || e);
        return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: e && e.tool ? e.message : 'The Editlayer connector hit an unexpected problem. Try again; if it keeps happening, reconnect Editlayer.' }], isError: true } };
      }
    }
    default: return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
  }
}

async function mcp(request, env, url) {
  const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') || '')?.[1];
  if (!bearer) return unauthorized(url);
  const row = await env.DB.prepare("SELECT * FROM tokens WHERE hash = ? AND kind = 'access'").bind(await sha256(bearer)).first();
  if (!row || row.expires_at < now()) return unauthorized(url, 'invalid_token');
  if (request.method === 'GET') return new Response(null, { status: 405, headers: { ...CORS, allow: 'POST, OPTIONS' } });
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: CORS });
  const text = await request.text();
  if (text.length > 2 * 1024 * 1024) return json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Request too large' } }, 413);
  let body;
  try { body = JSON.parse(text); } catch { return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400); }
  const grant = { grant_id: row.grant_id, client_id: row.client_id };
  env.DB.prepare('UPDATE grants SET last_used = ? WHERE id = ?').bind(now(), row.grant_id).run().catch(() => {});
  if (Array.isArray(body)) {
    if (body.length > 20) return json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Send at most 20 messages at once' } }, 400);
    const out = [];
    for (const m of body) { const r = await rpc(env, grant, m); if (r) out.push(r); }
    return out.length ? json(out) : new Response(null, { status: 202, headers: CORS });
  }
  const out = await rpc(env, grant, body);
  return out ? json(out) : new Response(null, { status: 202, headers: CORS });
}

/* --------------------------------------------------------------------------------------- metadata */

const protectedResource = (url) => json({
  resource: resourceOf(url.origin),
  authorization_servers: [url.origin],
  scopes_supported: SCOPES,
  bearer_methods_supported: ['header'],
  resource_name: 'Editlayer',
  resource_documentation: 'https://editlayer.co/ai/',
});

const authServer = (url) => json({
  issuer: url.origin,
  authorization_endpoint: `${url.origin}/authorize`,
  token_endpoint: `${url.origin}/token`,
  registration_endpoint: `${url.origin}/register`,
  revocation_endpoint: `${url.origin}/revoke`,
  response_types_supported: ['code'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
  code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['none'],
  revocation_endpoint_auth_methods_supported: ['none'],
  scopes_supported: SCOPES,
  client_id_metadata_document_supported: true,
  authorization_response_iss_parameter_supported: true,
  service_documentation: 'https://editlayer.co/ai/',
});

function home(env, url) {
  return page(env, 'Editlayer connector', `
<p class="eyebrow">MCP server</p>
<h1>Editlayer connector</h1>
<p>Lets ChatGPT, Claude and other AI assistants edit websites that use Editlayer, after a site admin approves it.</p>
<p>Add this address as a connector in your assistant:</p>
<p><code style="display:block;padding:10px 12px;border:1px solid var(--line);border-radius:10px;overflow-wrap:anywhere">${escapeHtml(resourceOf(url.origin))}</code></p>
<p class="hint">Learn more at <a href="${escapeHtml(env.SITE_URL || 'https://editlayer.co')}/ai/">editlayer.co</a>.</p>`);
}

/* ------------------------------------------------------------------------------------------ router */

async function route(request, env, url) {
  const p = url.pathname.replace(/\/+$/, '') || '/';
  const m = request.method;
  if (m === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (p === '/.well-known/oauth-protected-resource' || p === '/.well-known/oauth-protected-resource/mcp') return protectedResource(url);
  if (p === '/.well-known/oauth-authorization-server' || p === '/.well-known/oauth-authorization-server/mcp') return authServer(url);
  if (p === '/.well-known/openai-apps-challenge') {
    return env.OPENAI_APPS_CHALLENGE ? new Response(String(env.OPENAI_APPS_CHALLENGE).trim(), { headers: { 'content-type': 'text/plain; charset=utf-8' } }) : new Response('Not found', { status: 404 });
  }
  if (p === '/mcp') return mcp(request, env, url);
  if (p === '/register' && m === 'POST') return register(request, env);
  if (p === '/token' && m === 'POST') return token(request, env, url);
  if (p === '/revoke' && m === 'POST') return revokeToken(request, env);
  if (p === '/authorize' && m === 'GET') return authorize(request, env, url);
  if (p === '/authorize/r' && m === 'GET') return showRequest(request, env, url);
  if (p === '/callback' && m === 'GET') return siteCallback(request, env, url);
  const form = m === 'POST' && (request.headers.get('content-type') || '').startsWith('application/x-www-form-urlencoded');
  const sameSite = !request.headers.get('origin') || request.headers.get('origin') === url.origin;
  if (form && !sameSite) return errorPage(env, 'Forbidden', 'That form came from another website.', 403);
  if (p === '/authorize/site' && form) return addSite(request, env, url);
  if (p === '/authorize/finish' && form) return finish(request, env, url);
  if (p === '/authorize/cancel' && form) return cancel(request, env, url);
  if (p === '/' && m === 'GET') return home(env, url);
  if (p === '/health') return json({ ok: true, version: VERSION });
  return json({ error: 'not_found' }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      return await route(request, env, url);
    } catch (err) {
      console.error('editlayer hub error', err && err.stack || err);
      const html = !url.pathname.startsWith('/mcp') && !url.pathname.startsWith('/token') && !url.pathname.startsWith('/register');
      return html ? errorPage(env, 'Something went wrong', 'The connector hit an unexpected problem. Try again in a moment.', 500)
        : json({ error: 'server_error', error_description: 'The connector hit an unexpected problem. Try again in a moment.' }, 500);
    }
  },

  // Daily: drop expired sign-ins, codes and tokens; turn off site keys from sign-ins that were never finished.
  async scheduled(event, env) {
    const t = now();
    const orphans = (await env.DB.prepare(`SELECT * FROM sites WHERE created_at < ? AND grant_id NOT IN (SELECT id FROM grants) AND grant_id NOT IN (SELECT grant_id FROM requests)`).bind(t - REQUEST_MS).all()).results;
    for (const s of orphans) await revokeAtSite(env, s);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM requests WHERE expires_at < ?').bind(t),
      env.DB.prepare('DELETE FROM codes WHERE expires_at < ?').bind(t),
      env.DB.prepare('DELETE FROM tokens WHERE expires_at < ?').bind(t),
      env.DB.prepare('DELETE FROM sites WHERE created_at < ? AND grant_id NOT IN (SELECT id FROM grants) AND grant_id NOT IN (SELECT grant_id FROM requests)').bind(t - REQUEST_MS),
      env.DB.prepare('DELETE FROM grants WHERE id NOT IN (SELECT grant_id FROM sites)'),
      env.DB.prepare("DELETE FROM clients WHERE kind = 'dcr' AND created_at < ? AND id NOT IN (SELECT client_id FROM grants)").bind(t - 30 * 86400 * 1000),
    ]);
  },
};
