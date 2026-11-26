// Forms: site forms post to the CMS, messages land in an Inbox editors read in the editor.
//
//   <form data-cms-form="contact" id="contact-form" action="/_cms/form/contact" method="post">
//
// Visitors without JavaScript get a 303 back to the page with ?sent=contact#contact-form and the
// success message filled into the form's [role="status"] element. With JavaScript, the site posts with
// Accept: application/json and gets { ok, message } or { ok: false, error }.
//
// Spam: a hidden honeypot field, a signed time field (HMAC with a per-site key) that rejects forms sent
// within 3 seconds of loading, a per-visitor rate limit (hashed IP), optional Cloudflare Turnstile, and a
// same-origin check. Caught submissions are kept under "Spam" for 30 days so nothing real is lost.
//
// Options (createCms({ forms: { … } }), all optional; forms: false turns the feature off):
//   labels      { contact: 'Contact page' }      names shown in the Inbox and emails
//   minSeconds  3                                 fastest a person can fill a form
//   rate        { max: 5, minutes: 10 }           submissions per visitor
//   keepDays    0                                 delete messages older than this (0 = keep)
//   timeZone    'America/Chicago'                 times in the CSV export
//   turnstile   '<site key>'                      plus the TURNSTILE_SECRET secret
//   notify      { from: 'Website <web@x.com>', to: ['a@x.com'], forms: ['contact'] }  plus RESEND_API_KEY
//   salesforce  { oid: '00D…', forms: ['contact'], fields: { email: 'email', company: 'company' }, leadSource }

import { json, sha256Hex, escapeHtml, b64url, randomToken, hasRole } from '../util.js';
import { FORM_RE, FIELD_RE, EMAIL_RE, MESSAGES, cleanValue, formLabel, safeAnchor, safePage, summarize, toCsv } from './forms/fields.js';
import { emailReady, recipients, sendEmail, sendToSalesforce, verifyTurnstile } from './forms/notify.js';

const MAX_FIELDS = 50;
const MAX_VALUE = 5000;
const MAX_TOTAL = 30 * 1024;
const MAX_BODY = 64 * 1024;          // raw body (multipart framing included)
const SPAM_KEEP_DAYS = 30;
const PAGE_SIZE = 50;
const HP = '_cms_website';           // honeypot: people never see it, bots fill it in
const TS = '_cms_t';                 // signed load time
const PAGE = '_cms_page';
const ANCHOR = '_cms_anchor';
const TURNSTILE = 'cf-turnstile-response';
const INTERNAL = new Set([HP, TS, PAGE, ANCHOR, TURNSTILE, 'g-recaptcha-response']);
const SETTINGS_KEY = '@forms';

function cfg(opts) {
  if (opts.forms === false) return null;
  const f = opts.forms && typeof opts.forms === 'object' ? opts.forms : {};
  const n = (v, d, lo, hi) => (Number.isFinite(+v) && +v >= lo && +v <= hi ? +v : d);
  const turnstile = typeof f.turnstile === 'string' ? f.turnstile : f.turnstile && f.turnstile.siteKey;
  return {
    labels: f.labels && typeof f.labels === 'object' ? f.labels : {},
    minMs: n(f.minSeconds, 3, 0, 60) * 1000,
    rateMax: n(f.rate && f.rate.max, 5, 1, 1000),
    rateMs: n(f.rate && f.rate.minutes, 10, 1, 1440) * 60000,
    keepDays: n(f.keepDays, 0, 0, 3650),
    timeZone: typeof f.timeZone === 'string' ? f.timeZone : undefined,
    turnstile: /^[A-Za-z0-9_-]{8,100}$/.test(String(turnstile || '')) ? turnstile : '',
    notify: f.notify && typeof f.notify === 'object' ? f.notify : null,
    salesforce: f.salesforce && typeof f.salesforce === 'object' ? f.salesforce : null,
  };
}
const turnstileOn = (c, env) => Boolean(c.turnstile && env.TURNSTILE_SECRET);

/* ------------------------------------------------------------------ signing key and time field */
let keyCache = null;  // { raw, key }
async function signingKey(env) {
  let raw = env.CMS_FORM_SECRET && String(env.CMS_FORM_SECRET).length >= 16 ? String(env.CMS_FORM_SECRET) : null;
  if (keyCache && (!raw || keyCache.raw === raw)) return keyCache;
  if (!raw) {
    const db = env.CMS_DB;
    let row = await db.prepare("SELECT value FROM cms_form_keys WHERE name = 'sign'").first();
    if (!row) {
      await db.prepare("INSERT OR IGNORE INTO cms_form_keys (name, value) VALUES ('sign', ?)").bind(randomToken(32)).run();
      row = await db.prepare("SELECT value FROM cms_form_keys WHERE name = 'sign'").first();
    }
    raw = row.value;
  }
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(raw), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  keyCache = { raw, key };
  return keyCache;
}
async function hmac(env, msg) {
  const { key } = await signingKey(env);
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg))));
}
const timeField = async (env, form, ts) => `${ts}.${await hmac(env, `t|${form}|${ts}`)}`;
function same(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
/** Milliseconds since the form was loaded, or null when the field is missing, forged or from the future. */
async function formAge(env, form, value) {
  const m = /^(\d{13})\.([A-Za-z0-9_-]{43})$/.exec(String(value || ''));
  if (!m) return null;
  const ts = Number(m[1]);
  const expect = await hmac(env, `t|${form}|${ts}`);
  if (!same(expect, m[2])) return null;
  const age = Date.now() - ts;
  return age < -60000 ? null : age;
}
const ipHash = async (env, ip) => (await sha256Hex(`${(await signingKey(env)).raw}|ip|${ip}`)).slice(0, 32);

/* ------------------------------------------------------------------ public form posts */
async function submit(ctx) {
  const { request, env, url, opts, params } = ctx;
  const c = cfg(opts);
  const form = params[0];
  if (!c || !FORM_RE.test(form)) return new Response('Not found', { status: 404 });
  const wantsJson = (request.headers.get('accept') || '').includes('application/json');

  // Same-origin only: browsers send Origin on form posts; fall back to Referer.
  const origin = request.headers.get('origin');
  let refPath = null;
  try {
    const ref = request.headers.get('referer');
    if (ref) {
      const r = new URL(ref);
      if (!origin && r.origin !== url.origin) return new Response('Forbidden', { status: 403 });
      if (r.origin === url.origin) refPath = safePage(r.pathname);
    }
  } catch { /* bad referer: ignore */ }
  if (origin && origin !== url.origin) return new Response('Forbidden', { status: 403 });

  let page = refPath || '/';
  let anchor = '';
  const reply = (code, status = 200) => {
    const ok = code === 'ok';
    if (wantsJson) return json(ok ? { ok: true, message: MESSAGES.ok } : { ok: false, code, error: MESSAGES[code] || MESSAGES.invalid }, ok ? 200 : status);
    const q = ok ? `sent=${form}` : `unsent=${form}&why=${code}`;
    return new Response(null, { status: 303, headers: { location: `${page}?${q}${anchor ? `#${anchor}` : ''}`, 'cache-control': 'no-store' } });
  };

  const type = (request.headers.get('content-type') || '').toLowerCase();
  if (!type.startsWith('application/x-www-form-urlencoded') && !type.startsWith('multipart/form-data')) return reply('invalid', 415);
  if (Number(request.headers.get('content-length') || 0) > MAX_BODY) return reply('big', 413);
  let fd;
  try {
    const buf = await request.arrayBuffer();
    if (buf.byteLength > MAX_BODY) return reply('big', 413);
    fd = await new Response(buf, { headers: { 'content-type': type } }).formData();
  } catch {
    return reply('invalid', 400);
  }
  page = safePage(fd.get(PAGE)) || page;
  anchor = safeAnchor(fd.get(ANCHOR));

  const pairs = [];
  let total = 0;
  for (const [k, v] of fd.entries()) {
    if (INTERNAL.has(k) || typeof v !== 'string') continue;   // files are not accepted
    if (!FIELD_RE.test(k)) continue;
    const value = cleanValue(v);
    if (!value) continue;
    if (value.length > MAX_VALUE) return reply('long', 400);
    total += k.length + value.length;
    pairs.push([k, value]);
    if (pairs.length > MAX_FIELDS || total > MAX_TOTAL) return reply('big', 413);
  }
  if (!pairs.length) return reply('empty', 400);

  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-real-ip') || 'unknown';
  let hash;
  try {
    hash = await ipHash(env, ip);
    const since = Date.now() - c.rateMs;
    const row = await env.CMS_DB.prepare('SELECT COUNT(*) AS n FROM cms_form_submissions WHERE ip_hash = ? AND created_at > ?').bind(hash, since).first();
    if (row && row.n >= c.rateMax) return reply('rate', 429);
  } catch (err) {
    console.error('vibecms forms: storage unavailable', err && err.message);
    return reply('down', 503);
  }

  let spam = null;
  if (String(fd.get(HP) || '').trim()) spam = 'honeypot';
  const age = await formAge(env, form, fd.get(TS));
  if (!spam && age === null) spam = 'no time check';     // page didn't come through the CMS, or a bot made up the form
  if (!spam && age < c.minMs) return reply('fast', 400);
  if (!spam && turnstileOn(c, env)) {
    const ok = await verifyTurnstile({ secret: env.TURNSTILE_SECRET, token: fd.get(TURNSTILE), ip });
    if (ok === false) return reply('check', 400);
    if (ok === null) spam = 'robot check unavailable';
  }

  try {
    await env.CMS_DB.prepare(
      'INSERT INTO cms_form_submissions (form, data, page, ip_hash, user_agent, created_at, spam, spam_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(form, JSON.stringify(pairs), page, hash, String(request.headers.get('user-agent') || '').slice(0, 300), Date.now(), spam ? 1 : 0, spam).run();
  } catch (err) {
    console.error('vibecms forms: could not store submission', err && err.message);
    return reply('down', 503);
  }

  // Old spam (and messages past opts.forms.keepDays) is cleared here as well as on the cron trigger,
  // because a site without a "triggers.crons" entry in wrangler.jsonc never runs scheduled().
  if (Date.now() - lastSweep > 3600000) {
    lastSweep = Date.now();
    ctx.waitUntil(sweep(env, c).catch((err) => console.error('vibecms forms: clean-up failed', err && err.message)));
  }

  if (!spam) {
    ctx.waitUntil((async () => {
      if (emailReady(env, c.notify)) {
        const to = recipients(c.notify.to, await savedRecipients(env));
        await sendEmail({ env, notify: c.notify, to, form, pairs, page, origin: url.origin, siteName: opts.siteName, labels: c.labels });
      }
      if (c.salesforce) await sendToSalesforce({ sf: c.salesforce, form, pairs });
    })().catch((err) => console.error('vibecms forms: notify failed', err && err.message)));
  }
  // Spam gets the same answer as a real message, so bots learn nothing.
  return reply('ok');
}

/** Email addresses editors set in the Inbox (published "@forms" setting), or undefined. */
async function savedRecipients(env) {
  try {
    const row = await env.CMS_DB.prepare("SELECT html FROM cms_regions WHERE path = '*' AND key = ? AND state = 'live'").bind(SETTINGS_KEY).first();
    if (!row) return undefined;
    const v = JSON.parse(row.html);
    return Array.isArray(v.notifyTo) ? v.notifyTo : undefined;
  } catch { return undefined; }
}

/* ------------------------------------------------------------------ rendering */
const HIDE = 'position:absolute!important;width:1px!important;height:1px!important;margin:-1px!important;padding:0!important;border:0!important;overflow:hidden!important;clip:rect(0 0 0 0)!important;clip-path:inset(50%)!important;white-space:nowrap!important';

function render(ctx) {
  const c = cfg(ctx.opts);
  if (!c) return;
  const { env, url } = ctx;

  if (ctx.editing) {
    // Never add the hidden fields while editing: they would be saved into the page.
    return shareInbox(ctx, c);
  }

  const sent = url.searchParams.get('sent');
  const unsent = url.searchParams.get('unsent');
  const why = url.searchParams.get('why');
  const result = sent && FORM_RE.test(sent) ? { form: sent, ok: true } : unsent && FORM_RE.test(unsent) ? { form: unsent, ok: false, code: MESSAGES[why] && why !== 'ok' ? why : 'invalid' } : null;
  const ts = turnstileOn(c, env);
  let seenForm = false;
  let cur = null;   // the form being streamed: { name, success, statusDone, widgetDone }

  ctx.onAfter('form[data-cms-form]', {
    async element(el) {
      const name = el.getAttribute('data-cms-form') || '';
      if (!FORM_RE.test(name)) return;
      seenForm = true;
      const me = { name, success: el.getAttribute('data-cms-success') || '', statusDone: false, widgetDone: !ts };
      cur = me;
      let hidden = '';
      try {
        hidden = `<input type="hidden" name="${TS}" value="${escapeHtml(await timeField(env, name, Date.now()))}">`;
      } catch (err) {
        console.error('vibecms forms: no signing key (run the forms migration)', err && err.message);
      }
      const id = safeAnchor(el.getAttribute('id'));
      hidden += `<input type="hidden" name="${PAGE}" value="${escapeHtml(safePage(url.pathname) || '/')}">`
        + (id ? `<input type="hidden" name="${ANCHOR}" value="${escapeHtml(id)}">` : '')
        + `<div aria-hidden="true" style="${HIDE}"><label>Leave this field empty <input type="text" name="${HP}" value="" tabindex="-1" autocomplete="off"></label></div>`;
      el.onEndTag((end) => {
        let html = hidden;
        if (result && result.form === name && !me.statusDone) html = statusHtml(me, result) + html;
        end.before(html, { html: true });
        if (cur === me) cur = null;
      });
    },
  });
  if (result) {
    ctx.onAfter(`form[data-cms-form="${result.form}"] [role="status"]`, {
      element(el) {
        if (!cur || cur.statusDone) return;
        cur.statusDone = true;
        el.setInnerContent(message(cur, result));
        el.setAttribute('data-cms-form-result', result.ok ? 'sent' : 'error');
      },
    });
  }
  if (ts) {
    ctx.onAfter('form[data-cms-form] [type="submit"]', {
      element(el) {
        if (!cur || cur.widgetDone) return;
        cur.widgetDone = true;
        el.before(`<div class="cf-turnstile" data-sitekey="${escapeHtml(c.turnstile)}" data-action="${escapeHtml(cur.name)}" style="margin-top:18px"></div>`, { html: true });
      },
    });
    ctx.onAfter('body', {
      element(el) {
        el.onEndTag((end) => {
          if (seenForm) end.before('<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>', { html: true });
        });
      },
    });
  }
}
const message = (me, result) => (result.ok ? (me.success.trim().slice(0, 300) || MESSAGES.ok) : MESSAGES[result.code]);
const statusHtml = (me, result) => `<p role="status" data-cms-form-result="${result.ok ? 'sent' : 'error'}">${escapeHtml(message(me, result))}</p>`;

async function shareInbox(ctx, c) {
  if (!hasRole(ctx.user, 'editor')) return;
  try {
    const row = await ctx.env.CMS_DB.prepare('SELECT COUNT(*) AS n FROM cms_form_submissions WHERE spam = 0 AND read_at IS NULL').first();
    const data = { unread: row ? row.n : 0 };
    if (emailReady(ctx.env, c.notify)) {
      let saved;
      const r = ctx.rows && ctx.rows.get(SETTINGS_KEY);
      if (r) { try { saved = JSON.parse(r.html).notifyTo; } catch { /* ignore */ } }
      data.email = { to: recipients(c.notify.to, saved), draft: Boolean(r && r.state === 'draft') };
    }
    ctx.share(data);
  } catch {
    // Table missing (migration not applied): no Inbox button.
  }
}

/* ------------------------------------------------------------------ editor API */
function parse(row) {
  let data = [];
  try { data = JSON.parse(row.data); } catch { /* keep empty */ }
  if (!Array.isArray(data)) data = [];
  return { ...row, data: data.filter((p) => Array.isArray(p) && p.length === 2).map(([k, v]) => [String(k), String(v)]) };
}

function filters(sp) {
  const where = [];
  const args = [];
  where.push(sp.get('box') === 'spam' ? 'spam = 1' : 'spam = 0');
  const form = sp.get('form');
  if (form && FORM_RE.test(form)) { where.push('form = ?'); args.push(form); }
  const q = String(sp.get('q') || '').trim().slice(0, 100);
  if (q) {
    // Search what people wrote, not the field names (every contact message has a "phone" field).
    where.push("EXISTS (SELECT 1 FROM json_each(cms_form_submissions.data) AS j WHERE json_extract(j.value, '$[1]') LIKE ? ESCAPE '\\')");
    args.push(`%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
  }
  return { where, args };
}

async function list(ctx) {
  const { env, url, opts } = ctx;
  const c = cfg(opts);
  const sp = url.searchParams;
  const { where, args } = filters(sp);
  const before = Number(sp.get('before'));
  if (Number.isInteger(before) && before > 0) { where.push('id < ?'); args.push(before); }
  const db = env.CMS_DB;
  const [rows, forms, spam] = await Promise.all([
    db.prepare(`SELECT id, form, data, page, created_at, read_at FROM cms_form_submissions WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ?`).bind(...args, PAGE_SIZE + 1).all(),
    db.prepare('SELECT form, COUNT(*) AS total, SUM(read_at IS NULL) AS unread FROM cms_form_submissions WHERE spam = 0 GROUP BY form ORDER BY form').all(),
    db.prepare('SELECT COUNT(*) AS n FROM cms_form_submissions WHERE spam = 1').first(),
  ]);
  const items = rows.results.slice(0, PAGE_SIZE).map((r) => {
    const p = parse(r);
    return { id: r.id, form: r.form, label: formLabel(r.form, c.labels), page: r.page, at: r.created_at, read: Boolean(r.read_at), ...summarize(p.data) };
  });
  const formList = forms.results.map((f) => ({ form: f.form, label: formLabel(f.form, c.labels), total: f.total, unread: f.unread || 0 }));
  return json({
    items,
    hasMore: rows.results.length > PAGE_SIZE,
    forms: formList,
    unread: formList.reduce((n, f) => n + f.unread, 0),
    spam: spam ? spam.n : 0,
  });
}

const idOf = (ctx) => {
  const id = Number(ctx.params[0]);
  if (!Number.isSafeInteger(id) || id < 1) throw Object.assign(new Error('Message not found.'), { status: 404 });
  return id;
};

async function one(ctx) {
  const c = cfg(ctx.opts);
  const row = await ctx.env.CMS_DB.prepare('SELECT id, form, data, page, user_agent, created_at, read_at, spam, spam_reason FROM cms_form_submissions WHERE id = ?').bind(idOf(ctx)).first();
  if (!row) return json({ error: 'This message was deleted.' }, 404);
  const p = parse(row);
  return json({
    id: row.id, form: row.form, label: formLabel(row.form, c.labels), page: row.page, at: row.created_at, read: Boolean(row.read_at),
    spam: Boolean(row.spam), spamReason: row.spam_reason || '', fields: p.data, ...summarize(p.data),
  });
}

async function update(ctx) {
  const id = idOf(ctx);
  const b = ctx.body || {};
  const sets = [];
  const args = [];
  if (typeof b.read === 'boolean') { sets.push('read_at = ?'); args.push(b.read ? Date.now() : null); }
  if (typeof b.spam === 'boolean') { sets.push('spam = ?', 'spam_reason = ?'); args.push(b.spam ? 1 : 0, b.spam ? 'marked by an editor' : null); }
  if (!sets.length) return json({ error: 'Nothing to change.' }, 400);
  const r = await ctx.env.CMS_DB.prepare(`UPDATE cms_form_submissions SET ${sets.join(', ')} WHERE id = ?`).bind(...args, id).run();
  if (!r.meta || !r.meta.changes) return json({ error: 'This message was deleted.' }, 404);
  return json({ ok: true });
}

async function remove(ctx) {
  await ctx.env.CMS_DB.prepare('DELETE FROM cms_form_submissions WHERE id = ?').bind(idOf(ctx)).run();
  return json({ ok: true });
}

async function emptySpam(ctx) {
  const r = await ctx.env.CMS_DB.prepare('DELETE FROM cms_form_submissions WHERE spam = 1').run();
  return json({ deleted: (r.meta && r.meta.changes) || 0 });
}

async function exportCsv(ctx) {
  const c = cfg(ctx.opts);
  const { where, args } = filters(ctx.url.searchParams);
  const { results } = await ctx.env.CMS_DB.prepare(`SELECT form, data, page, created_at, read_at FROM cms_form_submissions WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT 10000`).bind(...args).all();
  const csv = toCsv(results.map(parse), { labels: c.labels, timeZone: c.timeZone });
  const form = ctx.url.searchParams.get('form');
  const day = new Date().toISOString().slice(0, 10);
  const file = `${form && FORM_RE.test(form) ? form : 'form'}-messages-${day}.csv`;
  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${file}"`,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

/** With forms: false the Inbox API answers 404 like any unknown route (and never reads a missing config). */
const whenOn = (handler) => (ctx) => (cfg(ctx.opts) ? handler(ctx) : json({ error: 'Not found' }, 404));

/* ------------------------------------------------------------------ settings key: who gets emails */
function settingsKey(value, { user, opts }) {
  if (!cfg(opts || {})) throw new Error('Forms are turned off for this site.');
  if (!hasRole(user, 'admin')) throw new Error('Only admins can change who gets form emails.');
  const raw = value && Array.isArray(value.notifyTo) ? value.notifyTo : [];
  const to = [...new Set(raw.map((s) => String(s).trim().toLowerCase()).filter(Boolean))];
  if (to.length > 10) throw new Error('Add up to 10 email addresses.');
  const bad = to.find((s) => !EMAIL_RE.test(s));
  if (bad) throw new Error(`“${bad.slice(0, 80)}” isn’t a valid email address.`);
  return JSON.stringify({ notifyTo: to });
}

export default {
  name: 'forms',
  keys: { [SETTINGS_KEY]: settingsKey },
  routes: [{ method: 'POST', path: /^\/_cms\/form\/([^/]+)$/, handler: submit }],
  api: [
    { method: 'GET', route: 'forms', role: 'editor', handler: whenOn(list) },
    { method: 'GET', route: 'forms/export.csv', role: 'editor', handler: whenOn(exportCsv) },
    { method: 'DELETE', route: 'forms/spam', role: 'editor', handler: whenOn(emptySpam) },
    { method: 'GET', route: /^forms\/(\d+)$/, role: 'editor', handler: whenOn(one) },
    { method: 'POST', route: /^forms\/(\d+)$/, role: 'editor', handler: whenOn(update) },
    { method: 'DELETE', route: /^forms\/(\d+)$/, role: 'editor', handler: whenOn(remove) },
  ],
  render,
  // The hidden spam-check fields and the "sent" message have to reach every page with a form, also
  // pages nobody edited. Pages without a form[data-cms-form] come out byte-for-byte unchanged.
  alwaysRender: (opts) => opts.forms !== false,
  async scheduled({ env, opts }) {
    const c = cfg(opts);
    if (c) await sweep(env, c);
  },
};

/* ------------------------------------------------------------------ clean-up */
let lastSweep = 0;
async function sweep(env, c) {
  const day = 86400000;
  await env.CMS_DB.prepare('DELETE FROM cms_form_submissions WHERE spam = 1 AND created_at < ?').bind(Date.now() - SPAM_KEEP_DAYS * day).run();
  if (c.keepDays) await env.CMS_DB.prepare('DELETE FROM cms_form_submissions WHERE created_at < ?').bind(Date.now() - c.keepDays * day).run();
}
