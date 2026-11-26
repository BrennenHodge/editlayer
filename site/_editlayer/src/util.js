export const NO_STORE = { 'cache-control': 'no-store' };

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...NO_STORE, ...headers },
  });
}

export function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(str) {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

export function randomToken(bytes = 32) {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Canonical page path: "/" or "/about-us/". Files keep their extension. */
export function normalizePath(p) {
  if (p.endsWith('/index.html')) p = p.slice(0, -'index.html'.length);
  if (!p.endsWith('/') && !/\.[a-z0-9]+$/i.test(p)) p += '/';
  return p;
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** JSON that is safe inside a <script> element. */
export function scriptJson(data) {
  const bs = String.fromCharCode(92);
  return JSON.stringify(data)
    .replace(/</g, bs + 'u003c')
    .replace(new RegExp(String.fromCharCode(0x2028), 'g'), bs + 'u2028')
    .replace(new RegExp(String.fromCharCode(0x2029), 'g'), bs + 'u2029');
}


/** Only same-site relative paths are allowed as redirect targets. */
export function safeNext(next, fallback = '/?edit') {
  if (typeof next !== 'string' || next[0] !== '/' || next.length > 2000) return fallback;
  // No control characters or backslashes anywhere (browsers drop tabs/newlines, turning "/<tab>/x" into "//x").
  for (const ch of next) { const c = ch.charCodeAt(0); if (c < 32 || c === 127 || c === 92) return fallback; }
  try {
    const u = new URL(next, 'https://editlayer.invalid');
    if (u.origin !== 'https://editlayer.invalid') return fallback;
    return u.pathname + u.search + u.hash;
  } catch { return fallback; }
}

export function isSecure(url) {
  return url.protocol === 'https:';
}

export const KEY_RE = /^[@#]?[a-z0-9][a-z0-9_-]{0,63}$/i;

/** Role levels: authors edit and submit for review, editors also publish, admins also manage people. */
export const ROLE_LEVEL = { author: 1, editor: 2, admin: 3 };
export const hasRole = (user, role) => Boolean(user) && (ROLE_LEVEL[user.role] || 0) >= (ROLE_LEVEL[role] || 2);
