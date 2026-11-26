// Vibe CMS: click-to-edit CMS for static sites on Cloudflare Workers.
//
//   import { createCms } from '<path>/vibecms/src/worker.js';
//   export default createCms({ siteName: 'Example Co', accent: '#eac44f' });
//
// Bindings expected in wrangler.jsonc: ASSETS (static assets), CMS_DB (D1), CMS_MEDIA (R2).
// Features (src/features/*.js) add API routes, other /_cms routes, render steps, pages without a
// static file, transforms of specific static files and scheduled jobs. See README "Writing a feature".

import { renderPage, specialKeys } from './render.js';
import { getUser, checkLogin, startSession, endSession, sessionCookie, findInvite, acceptInvite, issueInvite } from './auth.js';
import { saveDrafts, publish, discard, history, restore, resetPage, draftPaths, storagePath } from './content.js';
import * as media from './media.js';
import { loginScreen, inviteScreen, linkSentScreen, linkConfirmScreen } from './pages.js';
import { createLoginLink, findLoginLink, useLoginLink } from './auth.js';
import { emailEnabled, sendEmail, siteOrigin } from './features/review/email.js';
import { CLIENT, CLIENT_VERSION } from './client-assets.js';
import { json, normalizePath, safeNext, isSecure, hasRole } from './util.js';
import { FEATURES } from './features/index.js';

const DEFAULTS = { siteName: 'Website', accent: '#2563eb' };

export function createCms(options = {}) {
  const opts = { ...DEFAULTS, ...options };
  return {
    async fetch(request, env, ctx) {
      const url = new URL(request.url);
      try {
        if (url.pathname === '/_cms' || url.pathname.startsWith('/_cms/')) return await cmsRoute(request, env, url, opts, ctx);
        const res = await loadPage(request, env, url, opts);
        const type = res.headers.get('content-type') || '';
        if (!type.includes('text/html') || !['GET', 'HEAD'].includes(request.method)) return res;
        return await renderPage(request, env, res, url, opts);
      } catch (err) {
        console.error('vibecms error', err && err.stack || err);
        if (url.pathname.startsWith('/_cms/api/')) return json({ error: 'Something went wrong. Try again.' }, 500);
        // Never take the public site down because of the CMS: fall back to the static page.
        if (!url.pathname.startsWith('/_cms')) return env.ASSETS.fetch(request);
        return new Response('Something went wrong.', { status: 500 });
      }
    },
    async scheduled(event, env, ctx) {
      for (const f of FEATURES) {
        if (!f.scheduled) continue;
        try { await f.scheduled({ event, env, opts, waitUntil: (p) => ctx.waitUntil(p) }); } catch (err) { console.error(`vibecms: ${f.name} scheduled job failed`, err && err.stack || err); }
      }
    },
  };
}

/**
 * The response for a URL before edits are applied: the static file, transformed by any feature that
 * claims it (sitemap.xml), or, when there is no static page, a page a feature provides (CMS-made pages).
 */
async function loadPage(request, env, url, opts, mode = {}) {
  // Drop conditional headers: a 304 for the static file would hide newer published edits.
  let assetRequest = request;
  if (request.method === 'GET' || request.method === 'HEAD') {
    const headers = new Headers(request.headers);
    headers.delete('if-none-match');
    headers.delete('if-modified-since');
    assetRequest = new Request(request.url, { method: request.method, headers, redirect: 'manual' });
  }
  let res = await env.ASSETS.fetch(assetRequest);
  const fctx = { request, env, url, opts, path: normalizePath(url.pathname), drafts: Boolean(mode.drafts), getUser: () => getUser(request, env) };
  for (const f of FEATURES) {
    const hook = f.assets && f.assets[url.pathname];
    if (hook) res = (await hook(fctx, res)) || res;
  }
  if (res.status === 404 && ['GET', 'HEAD'].includes(request.method)) {
    for (const f of FEATURES) {
      if (!f.source) continue;
      const page = await f.source(fctx);
      if (page) return page;
    }
  }
  return res;
}

/** Renders any page of the site as HTML with edits applied, for feature routes (share-preview links). */
async function renderPath(env, origin, path, opts, mode) {
  const url = new URL(path, origin);
  const request = new Request(url, { method: 'GET' });
  const res = await loadPage(request, env, url, opts, mode);
  if (!(res.headers.get('content-type') || '').includes('text/html')) return res;
  return renderPage(request, env, res, url, opts, mode);
}

function sameOrigin(request, url) {
  const origin = request.headers.get('origin');
  return !origin || origin === url.origin;
}

async function cmsRoute(request, env, url, opts, ectx) {
  const p = url.pathname;
  const method = request.method;

  // Editor assets (public: they do nothing without a session).
  if (p === '/_cms/editor.js' || p === '/_cms/launcher.js' || p === '/_cms/editor.css') {
    const name = p.slice('/_cms/'.length);
    const type = name.endsWith('.css') ? 'text/css' : 'text/javascript';
    const cache = url.searchParams.get('v') === CLIENT_VERSION ? 'public, max-age=31536000, immutable' : 'no-cache';
    return new Response(CLIENT[name], { headers: { 'content-type': `${type}; charset=utf-8`, 'cache-control': cache } });
  }
  if (p.startsWith('/_cms/media/') && (method === 'GET' || method === 'HEAD')) return media.serve(env, p.slice('/_cms/media/'.length));

  if (p === '/_cms' || p === '/_cms/') return Response.redirect(`${url.origin}/?edit`, 302);

  const mode = loginMode(env, opts);

  if (p === '/_cms/login') {
    if (method === 'GET') return noFraming(loginScreen(opts, { next: safeNext(url.searchParams.get('next')), mode }));
    if (method !== 'POST' || !sameOrigin(request, url)) return new Response('Forbidden', { status: 403 });
    if (mode === 'link') return new Response('Sign in with an email link instead.', { status: 403 });
    const form = await request.formData();
    const next = safeNext(form.get('next'));
    const result = await checkLogin(env, form.get('email'), form.get('password'));
    if (result.error) return loginScreen(opts, { next, error: result.error, email: form.get('email'), mode });
    const token = await startSession(env, result.user.id);
    return new Response(null, { status: 303, headers: { location: next, 'set-cookie': sessionCookie(token, isSecure(url)), 'cache-control': 'no-store' } });
  }

  // Email sign-in links ("magic links").
  if (p === '/_cms/login/link') {
    if (method !== 'POST' || !sameOrigin(request, url) || mode === 'password') return new Response('Forbidden', { status: 403 });
    const form = await request.formData();
    const email = String(form.get('email') || '').trim().toLowerCase().slice(0, 200);
    const next = safeNext(form.get('next'));
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return loginScreen(opts, { next, error: 'Enter your email address.', email, mode });
    const link = await createLoginLink(env, email, next);
    if (link) {
      const href = `${siteOrigin(opts, url)}/_cms/magic/${link.token}`;
      const send = sendEmail(env, opts, {
        to: link.user.email,
        subject: `Sign in to edit ${opts.siteName}`,
        lines: [`Here’s your link to sign in and edit ${opts.siteName}. It works once, for the next 15 minutes.`, 'If you didn’t ask for it, you can ignore this email: nobody can sign in without the link.'],
        action: { text: 'Sign in', href },
      }).catch((err) => console.error('vibecms: sign-in email failed', err && err.message));
      if (ectx && ectx.waitUntil) ectx.waitUntil(send); else await send;
    }
    // Same answer whether or not the address has an account.
    return noFraming(linkSentScreen(opts, { email }));
  }
  if (p.startsWith('/_cms/magic/')) {
    const token = p.slice('/_cms/magic/'.length);
    if (method === 'GET') return noFraming(linkConfirmScreen(opts, { token, user: await findLoginLink(env, token) }));
    if (method !== 'POST' || !sameOrigin(request, url)) return new Response('Forbidden', { status: 403 });
    const used = await useLoginLink(env, token);
    if (!used) return linkConfirmScreen(opts, { token, user: null });
    const session = await startSession(env, used.userId);
    return new Response(null, { status: 303, headers: { location: safeNext(used.next), 'set-cookie': sessionCookie(session, isSecure(url)), 'cache-control': 'no-store' } });
  }

  if (p === '/_cms/logout' && method === 'POST') {
    if (!sameOrigin(request, url)) return new Response('Forbidden', { status: 403 });
    await endSession(request, env);
    return new Response(null, { status: 303, headers: { location: '/', 'set-cookie': sessionCookie('', isSecure(url), 0) } });
  }

  if (p.startsWith('/_cms/invite/')) {
    const token = p.slice('/_cms/invite/'.length);
    const invite = await findInvite(env, token);
    if (mode === 'link') {
      // Email-only sign-in: an invite is just a first sign-in link (7 days), no password to choose.
      if (method === 'GET') return noFraming(invite ? linkConfirmScreen(opts, { token, user: invite, action: `/_cms/invite/${token}` }) : inviteScreen(opts, { token, invite: null }));
      if (method !== 'POST' || !sameOrigin(request, url)) return new Response('Forbidden', { status: 403 });
      if (!invite) return inviteScreen(opts, { token, invite: null });
      await env.CMS_DB.prepare('UPDATE cms_users SET invite_hash = NULL, invite_expires = NULL WHERE id = ?').bind(invite.id).run();
      const session = await startSession(env, invite.id);
      return new Response(null, { status: 303, headers: { location: '/?edit', 'set-cookie': sessionCookie(session, isSecure(url)) } });
    }
    if (method === 'GET') return noFraming(inviteScreen(opts, { token, invite }));
    if (method !== 'POST' || !sameOrigin(request, url)) return new Response('Forbidden', { status: 403 });
    if (!invite) return inviteScreen(opts, { token, invite: null });
    const form = await request.formData();
    const pw = String(form.get('password') || '');
    if (pw.length < 10) return inviteScreen(opts, { token, invite, error: 'Use at least 10 characters.' });
    if (pw !== form.get('password2')) return inviteScreen(opts, { token, invite, error: 'The two passwords don’t match.' });
    await acceptInvite(env, invite.id, pw);
    const session = await startSession(env, invite.id);
    return new Response(null, { status: 303, headers: { location: '/?edit', 'set-cookie': sessionCookie(session, isSecure(url)) } });
  }

  if (p.startsWith('/_cms/api/')) return api(request, env, url, p.slice('/_cms/api/'.length), opts);
  return noFraming(await featureRoute(request, env, url, opts, ectx));
}

/**
 * How editors sign in: opts.login = "password", "link" (emailed sign-in links only) or "both". Links need email
 * (RESEND_API_KEY + opts.email.from); without it the site falls back to passwords so nobody is locked out.
 * Default: "both" when email is set up, otherwise "password".
 */
function loginMode(env, opts) {
  const canEmail = emailEnabled(env, opts);
  const want = opts.login;
  if (!canEmail) return 'password';
  if (want === 'link' || want === 'password' || want === 'both') return want;
  return 'both';
}

/** CMS pages (sign-in, previews …) must not be framed by other sites, including sibling subdomains. */
export function noFraming(res) {
  if (!res || !(res.headers.get('content-type') || '').includes('text/html')) return res;
  const out = new Response(res.body, res);
  out.headers.set('x-frame-options', 'SAMEORIGIN');
  out.headers.set('content-security-policy', "frame-ancestors 'self'");
  return out;
}

async function featureRoute(request, env, url, opts, ectx) {
  const p = url.pathname;
  const method = request.method;

  // Feature routes (public form posts, share-preview links …). They check sessions themselves.
  for (const f of FEATURES) {
    for (const r of f.routes || []) {
      if (r.method && r.method !== method) continue;
      const m = p.match(r.path);
      if (!m) continue;
      return r.handler({
        request, env, url, opts, params: m.slice(1), sameOrigin: sameOrigin(request, url),
        getUser: () => getUser(request, env),
        renderPath: (path, mode) => renderPath(env, url.origin, path, opts, mode),
        waitUntil: (promise) => ectx && ectx.waitUntil(promise),
      });
    }
  }
  return new Response('Not found', { status: 404 });
}

async function api(request, env, url, route, opts) {
  const user = await getUser(request, env);
  if (!user) return json({ error: 'Your session ended. Sign in again.' }, 401);
  const method = request.method;
  if (method !== 'GET') {
    // Cross-site requests can't send this header without a CORS preflight, which we never allow.
    if (request.headers.get('x-vibecms') !== '1' || !sameOrigin(request, url)) return json({ error: 'Forbidden' }, 403);
  }

  // Feature API routes first, so a feature can extend the CMS without touching this file.
  for (const f of FEATURES) {
    for (const r of f.api || []) {
      if (r.method !== method) continue;
      const m = typeof r.route === 'string' ? (r.route === route ? [route] : null) : route.match(r.route);
      if (!m) continue;
      if (!hasRole(user, r.role || 'editor')) return json({ error: 'You don’t have permission to do that.' }, 403);
      const body = method !== 'GET' && !r.raw ? await request.json().catch(() => ({})) : {};
      try {
        return await r.handler({
          request, env, url, opts, user, body, params: m.slice(1),
          pagePath: (v) => normalizePath(String(v || '/')),
          renderPath: (path, mode) => renderPath(env, url.origin, path, opts, mode),
        });
      } catch (e) {
        if (e && e.status) return json({ error: e.message }, e.status);
        throw e;
      }
    }
  }

  const body = method !== 'GET' && route !== 'media' ? await request.json().catch(() => ({})) : {};
  const pagePath = (v) => normalizePath(String(v || '/'));
  const can = (role) => hasRole(user, role);
  const denied = () => json({ error: 'You don’t have permission to do that.' }, 403);

  switch (`${method} ${route}`) {
    case 'GET me':
      return json({ user });
    case 'PUT draft': {
      // Authors change page content only: parts shared by every page (header, footer, shared sections,
      // site styles) would otherwise go live with the next page an editor publishes, unreviewed.
      if (!can('editor') && Object.keys(body.regions || {}).some((k) => k.startsWith('@'))) {
        return json({ error: 'Only editors can change parts shared by every page.' }, 403);
      }
      try {
        const n = await saveDrafts(env, pagePath(body.path), body.regions, user, featureKeys(opts));
        return json({ saved: n });
      } catch (e) {
        return json({ error: e.message }, e && e.status >= 400 && e.status < 500 ? e.status : 400);
      }
    }
    case 'POST publish': {
      if (!can('editor')) return denied();
      const paths = body.all ? [...new Set([...(await draftPaths(env)), '*'])] : [pagePath(body.path), '*'];
      const n = await publish(env, paths, user);
      return json({ published: n });
    }
    case 'POST discard':
      await discard(env, [pagePath(body.path), ...(body.includeSiteWide && can('editor') ? ['*'] : [])]);
      return json({ ok: true });
    case 'POST reset':
      if (!can('editor')) return denied();
      await resetPage(env, pagePath(body.path));
      return json({ ok: true });
    case 'GET history':
      return json({ versions: await history(env, pagePath(url.searchParams.get('path'))) });
    case 'POST restore':
      return json({ restored: await restore(env, String(body.batch || ''), pagePath(body.path), user) });
    case 'GET pages':
      return json(await listPages(env, url, opts, user));
    case 'GET media':
      return media.list(env, url.origin);
    case 'POST media':
      return media.upload(request, env, user);
  }

  // Admin only below.
  if (!can('admin')) return json({ error: 'Only admins can manage editors.' }, 403);
  switch (`${method} ${route}`) {
    case 'GET users': {
      const { results } = await env.CMS_DB.prepare('SELECT id, email, name, role, last_login, (pass_hash IS NOT NULL OR last_login IS NOT NULL) AS active, invite_expires FROM cms_users ORDER BY email').all();
      return json({ users: results });
    }
    case 'POST users': {
      const email = String(body.email || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Enter a valid email address.' }, 400);
      const token = await issueInvite(env, { email, name: String(body.name || '').trim().slice(0, 80), role: body.role });
      return json({ link: `${url.origin}/_cms/invite/${token}` });
    }
    case 'DELETE users': {
      const id = Number(body.id);
      if (id === user.id) return json({ error: 'You can’t remove yourself.' }, 400);
      await env.CMS_DB.batch([
        env.CMS_DB.prepare('DELETE FROM cms_sessions WHERE user_id = ?').bind(id),
        env.CMS_DB.prepare('DELETE FROM cms_users WHERE id = ?').bind(id),
      ]);
      return json({ ok: true });
    }
  }
  return json({ error: 'Not found' }, 404);
}

/** Serializers for feature draft keys ("@theme" …): key → (value, ctx) => string to store. ctx: {env, path, user, opts}. */
function featureKeys(opts) {
  const keys = {};
  for (const f of FEATURES) {
    for (const [key, fn] of Object.entries(f.keys || {})) keys[key] = (value, ctx) => fn(value, { ...ctx, opts });
  }
  return keys;
}

async function listPages(env, url, opts, user) {
  let paths = [];
  try {
    const res = await loadPage(new Request(`${url.origin}/sitemap.xml`), env, new URL('/sitemap.xml', url.origin), opts);
    if (res.ok) {
      const xml = await res.text();
      paths = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => {
        try { return normalizePath(new URL(m[1]).pathname); } catch { return null; }
      }).filter(Boolean);
    }
  } catch { /* no sitemap */ }
  // Features can add pages that aren't in the sitemap yet (unpublished CMS-made pages).
  for (const f of FEATURES) {
    if (!f.pages) continue;
    try { paths.push(...(await f.pages({ env, url, opts, user }))); } catch (err) { console.error(`vibecms: ${f.name} pages failed`, err); }
  }
  if (!paths.includes('/')) paths.unshift('/');
  const drafts = new Set(await draftPaths(env));
  const pages = [...new Set(paths)].sort((a, b) => (a === '/' ? -1 : b === '/' ? 1 : a.localeCompare(b))).map((path) => ({ path, draft: drafts.has(path) }));
  return { pages, siteWideDraft: drafts.has('*') };
}

export { storagePath, specialKeys, renderPage };
