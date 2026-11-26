import { b64url, fromB64url, randomToken, sha256Hex } from './util.js';

export const COOKIE = 'vibecms_session';
const SESSION_MS = 30 * 24 * 3600 * 1000;
const ITERATIONS = 100000; // Workers' PBKDF2 maximum
const MAX_FAILED = 8;
const LOCK_MS = 15 * 60 * 1000;
export const INVITE_MS = 7 * 24 * 3600 * 1000;

export async function hashPassword(password, saltB64) {
  const salt = saltB64 ? fromB64url(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, key, 256);
  return { hash: b64url(new Uint8Array(bits)), salt: b64url(salt) };
}

function sameString(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export function readCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

// On https the cookie is "__Host-" prefixed: the browser then only accepts it from this exact host, Secure,
// with Path=/ and no Domain, so a sibling subdomain (every site on *.example.com) can't plant or overwrite
// it. Plain http (local development) can't use the prefix and keeps the old name.
export const HOST_COOKIE = `__Host-${COOKIE}`;
const cookieName = (secure) => (secure ? HOST_COOKIE : COOKIE);

export function sessionCookie(token, secure, maxAgeSec = SESSION_MS / 1000) {
  return `${cookieName(secure)}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`;
}

/** The session token sent with this request (only the prefixed cookie counts on https). */
function sessionToken(request) {
  let secure = false;
  try { secure = new URL(request.url).protocol === 'https:'; } catch { /* keep false */ }
  const token = readCookie(request, cookieName(secure));
  return token && /^[A-Za-z0-9_-]{20,100}$/.test(token) ? token : null;
}

/** The signed-in user for this request, or null. Costs one D1 read, only when the cookie exists. */
export async function getUser(request, env) {
  const token = sessionToken(request);
  if (!token) return null;
  const row = await env.CMS_DB.prepare(
    `SELECT u.id, u.email, u.name, u.role FROM cms_sessions s JOIN cms_users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`
  ).bind(await sha256Hex(token), Date.now()).first();
  return row || null;
}

export async function startSession(env, userId) {
  const token = randomToken();
  const now = Date.now();
  await env.CMS_DB.batch([
    env.CMS_DB.prepare('DELETE FROM cms_sessions WHERE expires_at < ?').bind(now),
    env.CMS_DB.prepare('INSERT INTO cms_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').bind(await sha256Hex(token), userId, now + SESSION_MS),
    env.CMS_DB.prepare('UPDATE cms_users SET last_login = ?, failed = 0, locked_until = 0 WHERE id = ?').bind(now, userId),
  ]);
  return token;
}

export async function endSession(request, env) {
  const token = sessionToken(request);
  if (token) await env.CMS_DB.prepare('DELETE FROM cms_sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run();
}

/** Returns { user } or { error }. */
export async function checkLogin(env, email, password) {
  const user = await env.CMS_DB.prepare('SELECT * FROM cms_users WHERE email = ?').bind(String(email || '').trim().toLowerCase()).first();
  const generic = { error: 'That email and password don’t match.' };
  if (!user) {
    await hashPassword(password || 'x'); // keep timing similar for unknown emails
    return generic;
  }
  if (user.locked_until > Date.now()) return { error: 'Too many attempts. Try again in 15 minutes.' };
  if (!user.pass_hash) return { error: 'This account isn’t set up yet. Use the invite link you were sent.' };
  const { hash } = await hashPassword(password || '', user.pass_salt);
  if (!sameString(hash, user.pass_hash)) {
    const failed = user.failed + 1;
    await env.CMS_DB.prepare('UPDATE cms_users SET failed = ?, locked_until = ? WHERE id = ?')
      .bind(failed >= MAX_FAILED ? 0 : failed, failed >= MAX_FAILED ? Date.now() + LOCK_MS : 0, user.id).run();
    return generic;
  }
  return { user };
}

export async function findInvite(env, token) {
  if (!token) return null;
  return env.CMS_DB.prepare('SELECT id, email, name FROM cms_users WHERE invite_hash = ? AND invite_expires > ?')
    .bind(await sha256Hex(token), Date.now()).first();
}

export async function acceptInvite(env, userId, password) {
  const { hash, salt } = await hashPassword(password);
  // A new password ends every existing session (this is also how a lost or leaked password is reset).
  await env.CMS_DB.batch([
    env.CMS_DB.prepare('UPDATE cms_users SET pass_hash = ?, pass_salt = ?, invite_hash = NULL, invite_expires = NULL, failed = 0, locked_until = 0 WHERE id = ?')
      .bind(hash, salt, userId),
    env.CMS_DB.prepare('DELETE FROM cms_sessions WHERE user_id = ?').bind(userId),
  ]);
}

/* ------------------------------------------------------------------ email sign-in links */

export const LINK_MS = 15 * 60 * 1000;
const LINKS_PER_15_MIN = 3;

/**
 * Makes a one-time sign-in link for an email address, or returns null when there's no such editor or they
 * asked for too many in the last 15 minutes. The caller must answer the same way either way, so the
 * sign-in page never reveals who has an account.
 */
export async function createLoginLink(env, email, next) {
  const now = Date.now();
  const user = await env.CMS_DB.prepare('SELECT id, email, name FROM cms_users WHERE email = ?').bind(String(email || '').trim().toLowerCase()).first();
  if (!user) return null;
  const recent = await env.CMS_DB.prepare('SELECT COUNT(*) AS n FROM cms_login_links WHERE user_id = ? AND created_at > ?').bind(user.id, now - LINK_MS).first();
  if (recent && recent.n >= LINKS_PER_15_MIN) return null;
  const token = randomToken();
  await env.CMS_DB.batch([
    env.CMS_DB.prepare('DELETE FROM cms_login_links WHERE expires_at < ?').bind(now - 24 * 3600 * 1000),
    env.CMS_DB.prepare('INSERT INTO cms_login_links (token_hash, user_id, next, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
      .bind(await sha256Hex(token), user.id, next || null, now, now + LINK_MS),
  ]);
  return { token, user };
}

/** The editor a sign-in link belongs to, if it is still unused and in time (doesn't use it up). */
export async function findLoginLink(env, token) {
  if (!token || token.length < 20) return null;
  return env.CMS_DB.prepare(
    `SELECT u.id, u.email, u.name, l.next FROM cms_login_links l JOIN cms_users u ON u.id = l.user_id
     WHERE l.token_hash = ? AND l.used_at IS NULL AND l.expires_at > ?`
  ).bind(await sha256Hex(token), Date.now()).first();
}

/** Uses a sign-in link up (only once, even if two requests race) and returns the editor, or null. */
export async function useLoginLink(env, token) {
  if (!token || token.length < 20) return null;
  const now = Date.now();
  const row = await env.CMS_DB.prepare(
    'UPDATE cms_login_links SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING user_id, next'
  ).bind(now, await sha256Hex(token), now).first();
  if (!row) return null;
  // Proving they own the email address also completes a pending invite.
  await env.CMS_DB.prepare('UPDATE cms_users SET invite_hash = NULL, invite_expires = NULL WHERE id = ?').bind(row.user_id).run();
  return { userId: row.user_id, next: row.next };
}

/** Creates (or re-issues) an invite and returns the raw token. */
export async function issueInvite(env, { email, name, role }) {
  const token = randomToken();
  const hash = await sha256Hex(token);
  const expires = Date.now() + INVITE_MS;
  email = String(email).trim().toLowerCase();
  await env.CMS_DB.prepare(
    `INSERT INTO cms_users (email, name, role, invite_hash, invite_expires, created_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET invite_hash = excluded.invite_hash, invite_expires = excluded.invite_expires,
       name = COALESCE(excluded.name, cms_users.name), role = excluded.role`
  ).bind(email, name || null, ['admin', 'author'].includes(role) ? role : 'editor', hash, expires, Date.now()).run();
  return token;
}
