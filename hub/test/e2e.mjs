// End-to-end test of the Editlayer connector against a local Editlayer site. Never point it at live services.
//
//   1. A throwaway Editlayer site on http://127.0.0.1:8797 (login: 'password'), with migrations applied.
//   2. The hub on http://127.0.0.1:8798 with .dev.vars: HUB_KEY=<32 bytes base64>, ALLOW_HTTP_SITES=1.
//   3. An admin on the site:  node <site>/_editlayer/cli/editlayer.mjs user add hubtest@example.test --admin --local
//      then:  HUB=http://127.0.0.1:8798 SITE=http://127.0.0.1:8797 INVITE=<invite url> node hub/test/e2e.mjs
//
// Walks the whole flow an assistant uses (register, authorize, approve on the site, token, MCP calls, refresh,
// disconnect) and the attacks the design blocks.
import { createHash, randomBytes } from 'node:crypto';

const HUB = process.env.HUB || 'http://127.0.0.1:8798';
const SITE = process.env.SITE || 'http://127.0.0.1:8797';
const INVITE = process.env.INVITE;
const REDIRECT = 'http://127.0.0.1:9911/callback';
const b64url = (b) => Buffer.from(b).toString('base64url');
const s256 = (v) => b64url(createHash('sha256').update(v).digest());
let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => { if (cond) { pass++; console.log(`PASS ${name}`); } else { fail++; console.log(`FAIL ${name} ${extra}`); } };

class Jar {
  constructor() { this.c = new Map(); }
  take(res) { for (const h of res.headers.getSetCookie?.() || []) { const [kv] = h.split(';'); const i = kv.indexOf('='); const v = kv.slice(i + 1); if (/max-age=0/i.test(h) || !v) this.c.delete(kv.slice(0, i)); else this.c.set(kv.slice(0, i), v); } }
  header() { return [...this.c].map(([k, v]) => `${k}=${v}`).join('; '); }
}
async function go(jar, url, opts = {}) {
  const res = await fetch(url, { redirect: 'manual', ...opts, headers: { ...(opts.headers || {}), cookie: jar.header() } });
  jar.take(res);
  return res;
}
const form = (o) => new URLSearchParams(o).toString();
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

async function mcp(token, method, params = {}, id = 1) {
  const res = await fetch(`${HUB}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) });
  return { res, body: await res.json().catch(() => null) };
}
const call = async (token, name, args = {}) => (await mcp(token, 'tools/call', { name, arguments: args })).body.result;
const data = (r) => r && (r.structuredContent || JSON.parse(r.content[0].text));

// Admin session on the site.
const siteJar = new Jar();
if (!INVITE) throw new Error('Set INVITE to a fresh admin invite URL from the site.');
const inv = new URL(INVITE);
const r0 = await go(siteJar, `${SITE}${inv.pathname}`, { method: 'POST', headers: { ...FORM, origin: SITE }, body: form({ password: 'hub-e2e-password-123', password2: 'hub-e2e-password-123' }) });
ok(r0.status === 303 && siteJar.header().includes('editlayer'), 'site admin session', `status ${r0.status}`);

// Discovery.
const unauth = await mcp(null, 'initialize', { protocolVersion: '2025-11-25' });
ok(unauth.res.status === 401 && /resource_metadata=/.test(unauth.res.headers.get('www-authenticate') || ''), 'unauthenticated MCP gets 401 + resource_metadata');
const prm = await (await fetch(`${HUB}/.well-known/oauth-protected-resource`)).json();
ok(prm.resource === `${HUB}/mcp` && prm.authorization_servers[0] === HUB, 'protected resource metadata');
const asm = await (await fetch(`${HUB}/.well-known/oauth-authorization-server`)).json();
ok(asm.code_challenge_methods_supported.includes('S256') && asm.registration_endpoint && asm.client_id_metadata_document_supported && asm.authorization_response_iss_parameter_supported, 'authorization server metadata');

// Registration.
const bad = await fetch(`${HUB}/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['http://evil.example/cb'] }) });
ok(bad.status === 400, 'non-https, non-loopback redirect refused');
const reg = await (await fetch(`${HUB}/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Test Assistant', redirect_uris: ['http://127.0.0.1/callback'], token_endpoint_auth_method: 'none' }) })).json();
ok(reg.client_id && reg.token_endpoint_auth_method === 'none', 'dynamic client registration');

// Authorize.
const verifier = b64url(randomBytes(32));
const state = b64url(randomBytes(12));
const hubJar = new Jar();
const authUrl = `${HUB}/authorize?${form({ response_type: 'code', client_id: reg.client_id, redirect_uri: REDIRECT, code_challenge: s256(verifier), code_challenge_method: 'S256', state, resource: `${HUB}/mcp`, scope: 'sites' })}`;
const a1 = await go(hubJar, authUrl);
const html = await a1.text();
const rid = /name="rid" value="([^"]+)"/.exec(html)?.[1];
ok(a1.status === 200 && rid && hubJar.header().includes('vhub_'), 'authorize page sets a browser cookie (loopback redirect, any port)');
const plain = await fetch(`${HUB}/authorize?${form({ response_type: 'code', client_id: reg.client_id, redirect_uri: REDIRECT, state })}`, { redirect: 'manual' });
ok(plain.status === 303 && /error=invalid_request/.test(plain.headers.get('location')) && /iss=/.test(plain.headers.get('location')), 'authorize without PKCE is refused, with iss');

const notVibe = await go(hubJar, `${HUB}/authorize/site`, { method: 'POST', headers: { ...FORM, origin: HUB }, body: form({ rid, site: 'http://127.0.0.1:9' }) });
ok(notVibe.status === 200 && /couldn’t find Editlayer/.test(await notVibe.text()), 'a non-Editlayer address is explained');
const stranger = await fetch(`${HUB}/authorize/site`, { method: 'POST', redirect: 'manual', headers: { ...FORM, origin: HUB }, body: form({ rid, site: SITE }) });
ok(/expired/.test(await stranger.text()), 'another browser (no cookie) cannot continue the sign-in');

const a2 = await go(hubJar, `${HUB}/authorize/site`, { method: 'POST', headers: { ...FORM, origin: HUB }, body: form({ rid, site: SITE }) });
const toSite = a2.headers.get('location') || '';
ok(a2.status === 303 && toSite.startsWith(`${SITE}/_cms/connect?`), 'redirects to the site to approve');

// On the site: signed out → sign-in; signed in admin → approval screen.
const anon = await fetch(toSite, { redirect: 'manual' });
ok(anon.status === 303 && (anon.headers.get('location') || '').startsWith('/_cms/login?next='), 'site asks a signed-out person to sign in first');
const forged = new URL(toSite); forged.searchParams.set('hub', 'https://evil.example');
const f1 = await go(siteJar, forged.toString());
ok(f1.status === 400, 'site refuses an untrusted connector');
const s1 = await go(siteJar, toSite);
const approve = await s1.text();
ok(s1.status === 200 && /Let Test Assistant edit this site/.test(approve), 'site shows the approval screen to the admin');
const fields = Object.fromEntries([...approve.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)].map((m) => [m[1], m[2].replace(/&amp;/g, '&')]));
const crossSite = await go(siteJar, `${SITE}/_cms/connect`, { method: 'POST', headers: { ...FORM, origin: 'https://evil.example' }, body: form({ ...fields, role: 'author', decision: 'allow' }) });
ok(crossSite.status === 403, 'site refuses a cross-site approval post');
const s2 = await go(siteJar, `${SITE}/_cms/connect`, { method: 'POST', headers: { ...FORM, origin: SITE }, body: form({ ...fields, role: 'author', decision: 'allow' }) });
const back = s2.headers.get('location') || '';
ok(s2.status === 303 && back.startsWith(`${HUB}/callback?`) && /code=/.test(back), 'approval returns a one-time code to the hub');

// Replaying the site code with a wrong verifier fails (and uses it up).
const siteCode = new URL(back).searchParams.get('code');
const stolen = await fetch(`${SITE}/_cms/connect/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: siteCode, code_verifier: b64url(randomBytes(32)), hub: HUB }) });
ok(stolen.status === 400, 'site code is useless without the hub’s PKCE verifier');

// That burned the code, so approve once more for real.
const s1b = await go(siteJar, toSite);
const fields2 = Object.fromEntries([...(await s1b.text()).matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)].map((m) => [m[1], m[2].replace(/&amp;/g, '&')]));
const s2b = await go(siteJar, `${SITE}/_cms/connect`, { method: 'POST', headers: { ...FORM, origin: SITE }, body: form({ ...fields2, role: 'author', decision: 'allow' }) });
const cb = await go(hubJar, s2b.headers.get('location'));
ok(cb.status === 303 && (cb.headers.get('location') || '').startsWith('/authorize/r?rid='), 'hub exchanges the code with the site');
const review = await (await go(hubJar, `${HUB}${cb.headers.get('location')}`)).text();
ok(/Security test/.test(review) && /drafts only/.test(review), 'connected site listed on the hub page');

const fin = await go(hubJar, `${HUB}/authorize/finish`, { method: 'POST', headers: { ...FORM, origin: HUB }, body: form({ rid }) });
const ret = new URL(fin.headers.get('location') || 'http://x/');
ok(fin.status === 303 && ret.origin + ret.pathname === REDIRECT && ret.searchParams.get('state') === state && ret.searchParams.get('iss') === HUB, 'returns to the client with code, state and iss');
const code = ret.searchParams.get('code');

// Token.
const tok = (body) => fetch(`${HUB}/token`, { method: 'POST', headers: FORM, body: form(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
const wrongVerifier = await tok({ grant_type: 'authorization_code', code, client_id: reg.client_id, redirect_uri: REDIRECT, code_verifier: b64url(randomBytes(32)) });
ok(wrongVerifier.status === 400 && wrongVerifier.body.error === 'invalid_grant', 'wrong code_verifier refused');
// The failed attempt used the code up: run the flow again quickly for a fresh one.
async function freshCode() {
  const jar = new Jar();
  const v = b64url(randomBytes(32));
  const p = await go(jar, `${HUB}/authorize?${form({ response_type: 'code', client_id: reg.client_id, redirect_uri: REDIRECT, code_challenge: s256(v), code_challenge_method: 'S256', state: 'abcdefgh12345678' })}`);
  const id = /name="rid" value="([^"]+)"/.exec(await p.text())[1];
  const to = (await go(jar, `${HUB}/authorize/site`, { method: 'POST', headers: { ...FORM, origin: HUB }, body: form({ rid: id, site: SITE }) })).headers.get('location');
  const f = Object.fromEntries([...(await (await go(siteJar, to)).text()).matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)].map((m) => [m[1], m[2].replace(/&amp;/g, '&')]));
  const b = (await go(siteJar, `${SITE}/_cms/connect`, { method: 'POST', headers: { ...FORM, origin: SITE }, body: form({ ...f, role: 'author', decision: 'allow' }) })).headers.get('location');
  await go(jar, b);
  const out = new URL((await go(jar, `${HUB}/authorize/finish`, { method: 'POST', headers: { ...FORM, origin: HUB }, body: form({ rid: id }) })).headers.get('location'));
  return { code: out.searchParams.get('code'), verifier: v };
}
const fresh = await freshCode();
const t1 = await tok({ grant_type: 'authorization_code', code: fresh.code, client_id: reg.client_id, redirect_uri: REDIRECT, code_verifier: fresh.verifier, resource: `${HUB}/mcp` });
ok(t1.status === 200 && t1.body.access_token && t1.body.refresh_token && t1.body.expires_in === 3600, 'code + verifier give access and refresh tokens');
const reuse = await tok({ grant_type: 'authorization_code', code: fresh.code, client_id: reg.client_id, redirect_uri: REDIRECT, code_verifier: fresh.verifier });
ok(reuse.status === 400 && reuse.body.error === 'invalid_grant', 'a code works once');
const access = t1.body.access_token;

// MCP.
const init = await mcp(access, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } });
ok(init.res.status === 200 && /Security test/.test(init.body.result.instructions), 'initialize names the connected site');
const list = (await mcp(access, 'tools/list')).body.result.tools;
ok(list.length === 11 && list.every((t) => t.title && typeof t.annotations.readOnlyHint === 'boolean' && typeof t.annotations.destructiveHint === 'boolean' && typeof t.annotations.openWorldHint === 'boolean'), 'every tool has a title and all three annotations', `${list.length} tools`);
const sites = data(await call(access, 'list_sites'));
ok(sites.sites.length === 1 && sites.sites[0].canPublish === false, 'list_sites');
const pages = data(await call(access, 'list_pages'));
ok(pages.pages.some((p) => p.path === '/'), 'list_pages through the hub');
const pg = data(await call(access, 'get_page', { path: '/' }));
ok(pg.regions.some((r) => r.key === 'main'), 'get_page through the hub');
// Edit whatever plain text the main region holds now (other test runs may have changed it).
const mainHtml = pg.regions.find((r) => r.key === 'main').html;
const snippet = [...mainHtml.matchAll(/>([^<>&]{6,})</g)].map((m) => m[1].trim()).find((t) => t.length >= 6);
const rep = await call(access, 'replace_text', { path: '/', find: snippet, replace: `${snippet} (edited by the connector test)`, all: true });
ok(!rep.isError && data(rep).saved === 'draft', 'replace_text saves a draft', JSON.stringify(rep).slice(0, 200));
const pub = await call(access, 'publish', { path: '/' });
ok(pub.isError && /drafts but not publish/.test(pub.content[0].text), 'drafts-only connection cannot publish');
const wrongSite = await call(access, 'get_page', { path: '/', site: 'other.example' });
ok(wrongSite.isError && /isn’t connected/.test(wrongSite.content[0].text), 'unknown site argument explained');

// Refresh rotation.
const t2 = await tok({ grant_type: 'refresh_token', refresh_token: t1.body.refresh_token, client_id: reg.client_id });
ok(t2.status === 200 && t2.body.refresh_token !== t1.body.refresh_token, 'refresh gives a new pair');
const t2again = await tok({ grant_type: 'refresh_token', refresh_token: t1.body.refresh_token, client_id: reg.client_id });
ok(t2again.status === 400 && t2again.body.error === 'invalid_grant', 'an old refresh token is invalid_grant');

// Disconnect.
const disc = data(await call(t2.body.access_token, 'disconnect_site', { site: '127.0.0.1:8797' }));
ok(disc.disconnected === '127.0.0.1:8797' && disc.stillConnected === 0, 'disconnect_site');
const after = await mcp(t2.body.access_token, 'tools/call', { name: 'list_pages', arguments: {} });
ok(after.res.status === 401, 'tokens stop working once nothing is connected');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
