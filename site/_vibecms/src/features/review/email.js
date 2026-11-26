// Optional email through Resend (https://resend.com). Used only when the site sets
// createCms({ email: { from: 'Site <cms@example.com>' } }) and the Worker has the secret RESEND_API_KEY.
import { escapeHtml } from '../../util.js';

export function emailEnabled(env, opts) {
  const e = opts && opts.email;
  return Boolean(env && env.RESEND_API_KEY && e && typeof e.from === 'string' && /@/.test(e.from));
}

/** Notifications about reviews (on unless opts.email.notify === false). */
export function notifyEnabled(env, opts) {
  return emailEnabled(env, opts) && opts.email.notify !== false;
}

/** The site's public address for links in emails: opts.email.siteUrl, or the address the request came to. */
export function siteOrigin(opts, url) {
  const s = opts && opts.email && opts.email.siteUrl;
  if (typeof s === 'string' && /^https?:\/\/[^/\s]+/i.test(s)) {
    try { return new URL(s).origin; } catch { /* fall through */ }
  }
  return url.origin;
}

const oneLine = (s) => String(s ?? '').replace(/[\r\n]+/g, ' ').slice(0, 200);

/**
 * Sends one email. `lines` are plain-text paragraphs; `action` is an optional { text, href } button.
 * Throws when the email service refuses it.
 */
export async function sendEmail(env, opts, { to, subject, lines = [], action = null }) {
  const site = escapeHtml(opts.siteName || 'Website');
  const text = [...lines, ...(action ? [`${action.text}: ${action.href}`] : [])].join('\n\n');
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f5f7;font:15px/1.55 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#111418">
<div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #dfe3e8;border-radius:12px;padding:28px">
<p style="margin:0 0 6px;font-size:13px;color:#5b6470">${site}</p>
${lines.map((l) => `<p style="margin:0 0 14px">${escapeHtml(l)}</p>`).join('')}
${action ? `<p style="margin:22px 0 6px"><a href="${escapeHtml(action.href)}" style="display:inline-block;background:#111418;color:#fff;text-decoration:none;font-weight:600;padding:11px 18px;border-radius:9px">${escapeHtml(action.text)}</a></p>
<p style="margin:10px 0 0;font-size:12px;color:#5b6470;word-break:break-all">${escapeHtml(action.href)}</p>` : ''}
</div></body></html>`;
  const body = { from: opts.email.from, to: [String(to)], subject: oneLine(subject), text, html };
  if (typeof opts.email.replyTo === 'string' && /@/.test(opts.email.replyTo)) body.reply_to = opts.email.replyTo;
  // CMS_EMAIL_ENDPOINT (an env var, e.g. in .dev.vars) points local testing at a fake mail server.
  const override = env.CMS_EMAIL_ENDPOINT || opts.email.endpoint;
  const endpoint = typeof override === 'string' && /^https?:\/\//.test(override) ? override : 'https://api.resend.com/emails';
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`email service answered ${res.status}`);
}

/** Sends to several people, one email each; failures are logged, never thrown. */
export async function sendEach(env, opts, recipients, build) {
  const results = await Promise.allSettled(recipients.slice(0, 20).map((r) => sendEmail(env, opts, build(r))));
  for (const r of results) if (r.status === 'rejected') console.error('vibecms review: email failed', r.reason && r.reason.message);
}
