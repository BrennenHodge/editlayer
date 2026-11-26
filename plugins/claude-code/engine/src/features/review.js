// Approval, share-preview links, scheduled publishing and emailed invites.
//
// - Authors (role "author") edit and save drafts like editors, but send pages for review instead of
//   publishing. Editors and admins approve (publishes the page and the site-wide regions) or decline
//   with a comment.
// - Share-preview links (/_cms/preview/<secret>) show a page with its drafts to anyone with the link,
//   for 7 days or until turned off. Only a hash of the secret is stored.
// - Scheduled publishing: the Worker's cron trigger publishes pages whose time has come.
// - Emailed invites and review notifications, when RESEND_API_KEY and opts.email.from are set.
import { json, randomToken, sha256Hex, escapeHtml, hasRole } from '../util.js';
import { publish, draftPaths } from '../content.js';
import { issueInvite } from '../auth.js';
import { screen } from '../pages.js';
import { emailEnabled, notifyEnabled, sendEmail, sendEach, siteOrigin } from './review/email.js';

const DAY = 24 * 3600 * 1000;
const PREVIEW_MS = 7 * DAY;
const NOTE_MAX = 1000;
const ROLES = ['author', 'editor', 'admin'];
const ROLE_WORDS = { author: 'Author: you can edit pages and send them to an editor to publish.', editor: 'Editor: you can edit and publish pages.', admin: 'Admin: you can edit and publish pages and invite other people.' };

const fail = (status, message) => Object.assign(new Error(message), { status });
const clip = (v, n) => String(v ?? '').replace(/\r\n?/g, '\n').trim().slice(0, n);
const nameOf = (u) => (u && (u.name || u.email)) || '';
const pageName = (p) => (p === '/' ? 'Home' : p);

function pagePathOf(ctx, v) {
  const p = ctx.pagePath(v);
  // Same-site paths only: "//host/" would be a link to another site. No "?" or "#": a page address only.
  if (!/^\/(?![/\\])[^\s<>"'`\\?#]*$/.test(p) || p.length > 300) throw fail(400, 'That page address isn’t valid.');
  return p;
}

export function cleanTimeZone(tz) {
  tz = String(tz || '').slice(0, 64);
  if (!/^[A-Za-z][A-Za-z0-9_+\-/]*$/.test(tz)) return 'UTC';
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch { return 'UTC'; }
}

function formatDate(ms, tz, withTime = false) {
  const o = { timeZone: cleanTimeZone(tz), month: 'short', day: 'numeric', year: 'numeric' };
  if (withTime) Object.assign(o, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  try { return new Intl.DateTimeFormat('en-US', o).format(new Date(ms)); } catch { return new Date(ms).toUTCString(); }
}

/* ------------------------------------------------------------------ reviews */

function reviewOut(r, user) {
  return {
    id: r.id, path: r.path, status: r.status, note: r.note || '',
    author: r.author_name || r.author_email, mine: r.author_email === user.email,
    created: r.created_at, reviewer: r.reviewer_name || r.reviewer_email || '', comment: r.comment || '',
    decided: r.decided_at || null, published: r.published,
  };
}

/**
 * Pending requests whose drafts are gone are settled: published by someone (approved, with the
 * publisher as reviewer) or discarded (closed). Cheap when nothing is pending.
 */
async function settle(env) {
  const db = env.CMS_DB;
  const { results: pend } = await db.prepare("SELECT id, path, created_at FROM cms_reviews WHERE status = 'pending'").all();
  if (!pend.length) return;
  const drafts = new Set(await draftPaths(env));
  if (drafts.has('*')) return;
  const stmts = [];
  for (const r of pend) {
    if (drafts.has(r.path)) continue;
    const rev = await db.prepare("SELECT published_by, published_at FROM cms_revisions WHERE path IN (?, '*') AND published_at >= ? ORDER BY id DESC LIMIT 1")
      .bind(r.path, r.created_at).first();
    if (rev) {
      stmts.push(db.prepare("UPDATE cms_reviews SET status = 'approved', reviewer_email = ?, reviewer_name = NULL, decided_at = ? WHERE id = ? AND status = 'pending'")
        .bind(rev.published_by || '', rev.published_at, r.id));
    } else {
      stmts.push(db.prepare("UPDATE cms_reviews SET status = 'closed', decided_at = ? WHERE id = ? AND status = 'pending'").bind(Date.now(), r.id));
    }
  }
  if (stmts.length) await db.batch(stmts);
}

async function getState(ctx) {
  const { env, user, url } = ctx;
  const db = env.CMS_DB;
  const editor = hasRole(user, 'editor');
  const path = pagePathOf(ctx, url.searchParams.get('path') || '/');
  await settle(env);
  const now = Date.now();
  const out = { canPublish: editor, path };
  if (editor) {
    out.pending = (await db.prepare("SELECT * FROM cms_reviews WHERE status = 'pending' ORDER BY created_at LIMIT 100").all()).results.map((r) => reviewOut(r, user));
    out.decided = (await db.prepare("SELECT * FROM cms_reviews WHERE status != 'pending' AND decided_at > ? ORDER BY decided_at DESC LIMIT 20").bind(now - 30 * DAY).all()).results.map((r) => reviewOut(r, user));
    out.schedules = (await db.prepare("SELECT * FROM cms_schedules WHERE status IN ('pending', 'running') ORDER BY publish_at LIMIT 100").all()).results.map(scheduleOut);
    out.ran = (await db.prepare("SELECT * FROM cms_schedules WHERE status IN ('done', 'failed') AND ran_at > ? ORDER BY ran_at DESC LIMIT 10").bind(now - 14 * DAY).all()).results.map(scheduleOut);
  } else {
    out.mine = (await db.prepare('SELECT * FROM cms_reviews WHERE author_email = ? AND created_at > ? ORDER BY id DESC LIMIT 30').bind(user.email, now - 60 * DAY).all()).results.map((r) => reviewOut(r, user));
  }
  const links = editor
    ? await db.prepare('SELECT * FROM cms_preview_links WHERE revoked_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 50').bind(now).all()
    : await db.prepare('SELECT * FROM cms_preview_links WHERE revoked_at IS NULL AND expires_at > ? AND created_by = ? ORDER BY created_at DESC LIMIT 50').bind(now, user.email).all();
  out.previews = links.results.map((l) => ({ id: l.id, path: l.path, by: l.created_name || l.created_by, mine: l.created_by === user.email, created: l.created_at, expires: l.expires_at }));
  return json(out);
}

async function submitReview(ctx) {
  const { env, user, body, opts, url } = ctx;
  const db = env.CMS_DB;
  const path = pagePathOf(ctx, body.path);
  const drafts = new Set(await draftPaths(env));
  if (!drafts.has(path) && !drafts.has('*')) throw fail(400, 'There are no unpublished changes on this page to review.');
  const note = clip(body.note, NOTE_MAX);
  const now = Date.now();
  const existing = await db.prepare("SELECT id FROM cms_reviews WHERE status = 'pending' AND path = ? AND author_email = ?").bind(path, user.email).first();
  let id;
  if (existing) {
    await db.prepare('UPDATE cms_reviews SET note = ?, created_at = ?, author_name = ? WHERE id = ?').bind(note || null, now, user.name || null, existing.id).run();
    id = existing.id;
  } else {
    const r = await db.prepare("INSERT INTO cms_reviews (path, status, note, author_email, author_name, created_at) VALUES (?, 'pending', ?, ?, ?, ?)")
      .bind(path, note || null, user.email, user.name || null, now).run();
    id = r.meta.last_row_id;
  }
  if (!existing && notifyEnabled(env, opts)) { // a re-send while waiting only updates the note: no second email
    const { results: reviewers } = await db.prepare("SELECT email, name FROM cms_users WHERE role IN ('editor', 'admin') AND pass_hash IS NOT NULL").all();
    const href = `${siteOrigin(opts, url)}${path}?edit`;
    await sendEach(env, opts, reviewers.map((r) => r.email), (to) => ({
      to,
      subject: `Review requested: ${pageName(path)}`,
      lines: [`${nameOf(user)} changed ${pageName(path)} on ${opts.siteName} and asked for a review.`, ...(note ? [`Their note: “${note}”`] : []),
        'Open the page, check the changes, then approve and publish them or decline with a comment (Reviews button in the editor).'],
      action: { text: 'Open the page', href },
    }));
  }
  const row = await db.prepare('SELECT * FROM cms_reviews WHERE id = ?').bind(id).first();
  return json({ request: reviewOut(row, user), updated: Boolean(existing) });
}

async function decideReview(ctx) {
  const { env, user, body, params, opts, url } = ctx;
  const db = env.CMS_DB;
  const id = Number(params[0]);
  const action = params[1];
  const r = Number.isInteger(id) ? await db.prepare('SELECT * FROM cms_reviews WHERE id = ?').bind(id).first() : null;
  if (!r) throw fail(404, 'That request no longer exists.');
  if (r.status !== 'pending') throw fail(409, 'Someone already dealt with this request.');
  const now = Date.now();
  const tell = async (lines) => {
    if (!notifyEnabled(env, opts) || r.author_email === user.email) return;
    await sendEach(env, opts, [r.author_email], (to) => ({ to, subject: `${action === 'approve' ? 'Published' : 'Sent back'}: ${pageName(r.path)}`, lines, action: { text: 'Open the page', href: `${siteOrigin(opts, url)}${r.path}?edit` } }));
  };

  if (action === 'withdraw') {
    if (r.author_email !== user.email && !hasRole(user, 'editor')) throw fail(403, 'You don’t have permission to do that.');
    await db.prepare("UPDATE cms_reviews SET status = 'withdrawn', decided_at = ?, reviewer_email = ?, reviewer_name = ? WHERE id = ? AND status = 'pending'")
      .bind(now, user.email, user.name || null, id).run();
    return json({ ok: true });
  }
  if (!hasRole(user, 'editor')) throw fail(403, 'Only editors can approve or decline.');
  if (action === 'approve') {
    // Claim first so two editors approving at once publish only once.
    const claim = await db.prepare("UPDATE cms_reviews SET status = 'approved', reviewer_email = ?, reviewer_name = ?, decided_at = ? WHERE id = ? AND status = 'pending'")
      .bind(user.email, user.name || null, now, id).run();
    if (!claim.meta || claim.meta.changes !== 1) throw fail(409, 'Someone already dealt with this request.');
    let n;
    try {
      n = await publish(env, [r.path, '*'], user);
    } catch (err) {
      await db.prepare("UPDATE cms_reviews SET status = 'pending', reviewer_email = NULL, reviewer_name = NULL, decided_at = NULL WHERE id = ?").bind(id).run();
      throw err;
    }
    await db.prepare('UPDATE cms_reviews SET published = ? WHERE id = ?').bind(n, id).run();
    await tell([`${nameOf(user)} approved your changes to ${pageName(r.path)} and published them. Visitors see them now.`]);
    return json({ published: n });
  }
  // decline
  const comment = clip(body.comment, NOTE_MAX);
  if (!comment) throw fail(400, 'Say what should change, so the author knows what to fix.');
  const res = await db.prepare("UPDATE cms_reviews SET status = 'declined', reviewer_email = ?, reviewer_name = ?, comment = ?, decided_at = ? WHERE id = ? AND status = 'pending'")
    .bind(user.email, user.name || null, comment, now, id).run();
  // Someone approved or cancelled it a moment ago: don't tell the author it was sent back.
  if (!res.meta || res.meta.changes !== 1) throw fail(409, 'Someone already dealt with this request.');
  await tell([`${nameOf(user)} looked at your changes to ${pageName(r.path)} and sent them back.`, `Their comment: “${comment}”`, 'Your changes are still saved as a draft. Make the changes and send the page for review again.']);
  return json({ ok: true });
}

/* ------------------------------------------------------------------ share-preview links */

async function createPreview(ctx) {
  const { env, user, body, url } = ctx;
  const db = env.CMS_DB;
  const path = pagePathOf(ctx, body.path);
  const now = Date.now();
  await db.prepare('DELETE FROM cms_preview_links WHERE expires_at < ?').bind(now - 30 * DAY).run();
  const active = await db.prepare('SELECT COUNT(*) AS n FROM cms_preview_links WHERE path = ? AND revoked_at IS NULL AND expires_at > ?').bind(path, now).first();
  if (active && active.n >= 20) throw fail(400, 'This page already has 20 preview links. Turn some off first.');
  const token = randomToken();
  const expires = now + PREVIEW_MS;
  await db.prepare('INSERT INTO cms_preview_links (token_hash, path, time_zone, created_by, created_name, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(await sha256Hex(token), path, cleanTimeZone(body.timeZone), user.email, user.name || null, now, expires).run();
  return json({ link: `${url.origin}/_cms/preview/${token}`, expires });
}

async function revokePreview(ctx) {
  const { env, user, params } = ctx;
  const db = env.CMS_DB;
  const link = await db.prepare('SELECT id, created_by FROM cms_preview_links WHERE id = ?').bind(Number(params[0]) || 0).first();
  if (!link) throw fail(404, 'That link no longer exists.');
  if (link.created_by !== user.email && !hasRole(user, 'editor')) throw fail(403, 'Only the person who made this link, or an editor, can turn it off.');
  await db.prepare('UPDATE cms_preview_links SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').bind(Date.now(), link.id).run();
  return json({ ok: true });
}

function previewGone(opts, title = 'This preview link has expired') {
  return screen(opts, title, `<p>Preview links work for 7 days, and the person who shared one can turn it off sooner. Ask them for a new link.</p>
<p><a href="/" style="color:inherit;font-weight:600">Go to the website</a></p>`, 404);
}

async function servePreview(ctx) {
  const { env, opts, params } = ctx;
  const token = params[0] || '';
  let link = null;
  try {
    if (/^[A-Za-z0-9_-]{20,100}$/.test(token)) {
      link = await env.CMS_DB.prepare('SELECT path, expires_at, time_zone FROM cms_preview_links WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?')
        .bind(await sha256Hex(token), Date.now()).first();
    }
  } catch (err) { console.error('vibecms review: preview lookup failed', err); }
  if (!link) return previewGone(opts);
  let res;
  try {
    // user: null, so a signed-in viewer sees exactly what the link's recipient sees (no editor button).
    res = await ctx.renderPath(link.path, { drafts: true, user: null });
  } catch (err) {
    console.error('vibecms review: preview render failed', err);
    return previewGone(opts, 'This preview isn’t available');
  }
  if (res.status !== 200 || !(res.headers.get('content-type') || '').includes('text/html')) return previewGone(opts, 'This page no longer exists');
  const banner = `<div style="height:72px" aria-hidden="true"></div><div id="vibecms-preview-note" role="note" style="all:initial;position:fixed;z-index:2147483647;left:50%;bottom:14px;transform:translateX(-50%);box-sizing:border-box;width:max-content;max-width:calc(100% - 24px);padding:9px 16px;border-radius:12px;background:#16181c;color:#f3f4f6;font:500 13px/1.4 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;text-align:center;box-shadow:0 8px 28px rgba(0,0,0,.35),0 0 0 1px rgba(255,255,255,.12) inset">Preview of unpublished changes · <span style="white-space:nowrap">link expires ${escapeHtml(formatDate(link.expires_at, link.time_zone))}</span></div>`;
  const headers = new Headers(res.headers);
  headers.set('cache-control', 'private, no-store');
  headers.set('x-robots-tag', 'noindex, nofollow');
  headers.set('referrer-policy', 'no-referrer'); // the secret is in the URL: don't send it to sites the page links to
  headers.delete('content-length');
  return new HTMLRewriter()
    .on('head', { element: (el) => el.append('<meta name="referrer" content="no-referrer">', { html: true }) })
    .on('body', { element: (el) => el.onEndTag((end) => end.before(banner, { html: true })) })
    .transform(new Response(res.body, { status: 200, headers }));
}

/* ------------------------------------------------------------------ scheduled publishing */

function scheduleOut(s) {
  return { id: s.id, path: s.path, at: s.publish_at, status: s.status, by: s.created_name || s.created_by, ran: s.ran_at, published: s.published, result: s.result };
}

async function createSchedule(ctx) {
  const { env, user, body } = ctx;
  const db = env.CMS_DB;
  const path = pagePathOf(ctx, body.path);
  const at = Math.round(Number(body.at));
  const now = Date.now();
  if (!Number.isFinite(at) || at <= 0) throw fail(400, 'Pick a date and time.');
  if (at < now + 60 * 1000) throw fail(400, 'Pick a time at least a minute from now.');
  if (at > now + 366 * DAY) throw fail(400, 'Pick a time within the next year.');
  const tz = cleanTimeZone(body.timeZone);
  const existing = await db.prepare("SELECT id FROM cms_schedules WHERE path = ? AND status = 'pending'").bind(path).first();
  if (existing) {
    await db.prepare('UPDATE cms_schedules SET publish_at = ?, time_zone = ?, created_by = ?, created_name = ?, created_at = ? WHERE id = ?')
      .bind(at, tz, user.email, user.name || null, now, existing.id).run();
  } else {
    await db.prepare("INSERT INTO cms_schedules (path, publish_at, status, time_zone, created_by, created_name, created_at) VALUES (?, ?, 'pending', ?, ?, ?, ?)")
      .bind(path, at, tz, user.email, user.name || null, now).run();
  }
  return json({ ok: true, updated: Boolean(existing), at });
}

async function cancelSchedule(ctx) {
  const r = await ctx.env.CMS_DB.prepare("UPDATE cms_schedules SET status = 'cancelled' WHERE id = ? AND status = 'pending'").bind(Number(ctx.params[0]) || 0).run();
  if (!r.meta || r.meta.changes !== 1) throw fail(409, 'That scheduled publish already ran or was cancelled.');
  return json({ ok: true });
}

/** Cron job: publishes every page whose time has come. Each row is claimed first, so overlapping runs publish once. */
export async function runSchedules(env, now = Date.now()) {
  const db = env.CMS_DB;
  await db.prepare("UPDATE cms_schedules SET status = 'failed', result = 'stalled' WHERE status = 'running' AND ran_at < ?").bind(now - 15 * 60 * 1000).run();
  const { results } = await db.prepare("SELECT * FROM cms_schedules WHERE status = 'pending' AND publish_at <= ? ORDER BY publish_at LIMIT 25").bind(now).all();
  const done = [];
  for (const s of results) {
    const claim = await db.prepare("UPDATE cms_schedules SET status = 'running', ran_at = ? WHERE id = ? AND status = 'pending'").bind(Date.now(), s.id).run();
    if (!claim.meta || claim.meta.changes !== 1) continue;
    try {
      const n = await publish(env, [s.path, '*'], { email: `scheduled: ${s.created_by}` });
      await db.prepare("UPDATE cms_schedules SET status = 'done', published = ?, result = ?, ran_at = ? WHERE id = ?").bind(n, n ? 'published' : 'nothing', Date.now(), s.id).run();
      done.push({ id: s.id, path: s.path, published: n });
    } catch (err) {
      console.error('vibecms review: scheduled publish failed', s.path, err && err.stack || err);
      await db.prepare("UPDATE cms_schedules SET status = 'failed', result = 'error', ran_at = ? WHERE id = ?").bind(Date.now(), s.id).run();
    }
  }
  return done;
}

/* ------------------------------------------------------------------ emailed invites */

async function emailInvite(ctx) {
  const { env, opts, body, url, user } = ctx;
  if (!emailEnabled(env, opts)) throw fail(404, 'Email isn’t set up for this site. Create an invite link and send it yourself.');
  const email = String(body.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) throw fail(400, 'Enter a valid email address.');
  const name = String(body.name || '').trim().slice(0, 80);
  const role = ROLES.includes(body.role) ? body.role : 'editor';
  // The link is made here, never taken from the browser.
  const token = await issueInvite(env, { email, name, role });
  const link = `${siteOrigin(opts, url)}/_cms/invite/${token}`;
  try {
    await sendEmail(env, opts, {
      to: email,
      subject: `You’re invited to edit the ${opts.siteName} website`,
      lines: [`Hello${name ? ` ${name.split(' ')[0]}` : ''},`, `${nameOf(user)} invited you to edit the ${opts.siteName} website.`, ROLE_WORDS[role],
        'Use the button to choose your password. The link works once, for 7 days.'],
      action: { text: 'Choose your password', href: link },
    });
    return json({ sent: true, email });
  } catch (err) {
    console.error('vibecms review: invite email failed', err && err.message);
    return json({ sent: false, email, link });
  }
}

/* ------------------------------------------------------------------ feature */

export default {
  name: 'review',
  api: [
    { method: 'GET', route: 'review', role: 'author', handler: getState },
    { method: 'POST', route: 'review/requests', role: 'author', handler: submitReview },
    { method: 'POST', route: /^review\/requests\/(\d+)\/(approve|decline|withdraw)$/, role: 'author', handler: decideReview },
    { method: 'POST', route: 'review/previews', role: 'author', handler: createPreview },
    { method: 'DELETE', route: /^review\/previews\/(\d+)$/, role: 'author', handler: revokePreview },
    { method: 'POST', route: 'review/schedules', role: 'editor', handler: createSchedule },
    { method: 'DELETE', route: /^review\/schedules\/(\d+)$/, role: 'editor', handler: cancelSchedule },
    { method: 'POST', route: 'review/invite-email', role: 'admin', handler: emailInvite },
  ],
  routes: [
    { method: 'GET', path: /^\/_cms\/preview(?:\/([^/]*))?\/?$/, handler: servePreview },
  ],
  async render(ctx) {
    if (!ctx.editing) return;
    const { env, user, path, opts } = ctx;
    const db = env.CMS_DB;
    const editor = hasRole(user, 'editor');
    const data = { canPublish: editor, emailInvites: user.role === 'admin' && emailEnabled(env, opts) };
    try {
      await settle(env);
      const here = await db.prepare("SELECT * FROM cms_reviews WHERE status = 'pending' AND path = ? ORDER BY created_at LIMIT 5").bind(path).all();
      data.here = here.results.map((r) => reviewOut(r, user));
      if (editor) {
        data.pending = (await db.prepare("SELECT COUNT(*) AS n FROM cms_reviews WHERE status = 'pending'").first()).n;
        const s = await db.prepare("SELECT publish_at FROM cms_schedules WHERE path = ? AND status = 'pending'").bind(path).first();
        data.scheduled = s ? s.publish_at : null;
      } else {
        const mine = await db.prepare("SELECT * FROM cms_reviews WHERE author_email = ? AND (status = 'pending' OR decided_at > ?) ORDER BY id DESC LIMIT 20")
          .bind(user.email, Date.now() - 14 * DAY).all();
        data.mine = mine.results.map((r) => reviewOut(r, user));
      }
    } catch (err) {
      console.error('vibecms review: state failed (migration 0016 applied?)', err && err.message);
      data.unavailable = true;
    }
    ctx.share(data);
  },
  async scheduled({ env }) {
    await runSchedules(env);
  },
};
