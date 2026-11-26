// Helpers for the forms feature that don't touch the network or the database (unit-testable in Node).

export const FORM_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
// Field names come from the site's own form markup. Anything printable up to 64 characters is kept
// ("Téléphone", "Questions?"), so no answer is silently dropped; names are escaped wherever shown.
export const FIELD_RE = /^(?!\s)[^\u0000-\u001f\u007f-\u009f]{1,64}$/;
// The local part leaves out ? & # % / so an address can't add headers or a body to a mailto: link.
// The editor's "Email alerts" box uses this same pattern (client/features/forms.js): keep them equal,
// or an address the browser accepts would make every autosave fail on the server.
export const EMAIL_RE = /^[A-Za-z0-9._+'-]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/;

/** "training-video" -> "Training video", unless the site gives a label (opts.forms.labels). */
export function formLabel(name, labels = {}) {
  const l = labels && typeof labels[name] === 'string' ? labels[name].trim() : '';
  if (l) return l.slice(0, 60);
  const s = String(name || '').replace(/-/g, ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : 'Form';
}

/** "first name" / "first_name" -> "First name". */
export function fieldLabel(name) {
  const s = String(name || '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : '';
}

const pick = (pairs, re) => (pairs.find(([k, v]) => re.test(k) && String(v).trim()) || [])[1] || '';
const NAME_KEYS = /^(name|full[ _-]?name|your[ _-]?name|contact[ _-]?name)$/i;
const FIRST_KEYS = /^(first[ _-]?name|fname|given[ _-]?name)$/i;
const LAST_KEYS = /^(last[ _-]?name|lname|surname|family[ _-]?name)$/i;
const EMAIL_KEYS = /^(e-?mail|e-?mail[ _-]?address|your[ _-]?e-?mail)$/i;
const MESSAGE_KEYS = /^(message|comments?|details|question|questions|enquiry|inquiry|notes?|body|request|description)$/i;

/** Who sent it and the first line of what they wrote, for the Inbox list. */
export function summarize(pairs) {
  const first = pick(pairs, FIRST_KEYS);
  const last = pick(pairs, LAST_KEYS);
  const name = (pick(pairs, NAME_KEYS) || [first, last].filter(Boolean).join(' ')).trim();
  const rawEmail = pick(pairs, EMAIL_KEYS).trim();
  const email = EMAIL_RE.test(rawEmail) ? rawEmail : '';
  let text = pick(pairs, MESSAGE_KEYS);
  if (!text) {
    // Otherwise the longest answer that isn't the name or email.
    const skip = new Set([name, first, last, rawEmail]);
    text = pairs.map(([, v]) => String(v)).filter((v) => !skip.has(v)).sort((a, b) => b.length - a.length)[0] || '';
  }
  const line = String(text).split('\n').map((s) => s.trim()).find(Boolean) || '';
  return { name: name.slice(0, 120), email, preview: line.length > 140 ? `${line.slice(0, 139)}…` : line };
}

/** Clean one submitted value: text only, no NUL, Windows/Mac line endings to \n, trimmed. */
export function cleanValue(v) {
  return String(v).replace(/\u0000/g, '').replace(/\r\n?/g, '\n').trim();
}

/** A page path from the site that is safe to redirect back to ("/contact/"), or null. */
export function safePage(p) {
  const s = String(p || '');
  return /^\/(?![/\\])[A-Za-z0-9/_.~%-]{0,300}$/.test(s) ? s : null;
}

export const safeAnchor = (a) => (/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(String(a || '')) ? String(a) : '');

/** One CSV cell: always quoted, quotes doubled, and a leading = + - @ tab or CR neutralised so
    spreadsheet apps never run it as a formula. */
export function csvCell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s) || /^\s+[=+\-@]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** rows: [{created_at, form, page, read_at, data: [[k, v]…]}] -> CSV text (with a BOM so Excel reads UTF-8). */
export function toCsv(rows, { labels = {}, timeZone } = {}) {
  const fields = [];
  const seen = new Set();
  for (const r of rows) for (const [k] of r.data) if (!seen.has(k)) { seen.add(k); fields.push(k); }
  const fmt = (ms) => {
    try { return new Date(ms).toLocaleString('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }); } catch { return new Date(ms).toISOString(); }
  };
  const head = ['Received', 'Form', 'Page', 'Read', ...fields.map(fieldLabel)];
  const lines = [head.map(csvCell).join(',')];
  for (const r of rows) {
    const byField = new Map();
    for (const [k, v] of r.data) byField.set(k, byField.has(k) ? `${byField.get(k)}; ${v}` : v);
    lines.push([fmt(r.created_at), formLabel(r.form, labels), r.page || '', r.read_at ? 'Yes' : 'No', ...fields.map((f) => byField.get(f) ?? '')].map(csvCell).join(','));
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}

/** Messages visitors see. Fixed text keyed by a short code, so nothing from the request is reflected. */
export const MESSAGES = {
  ok: 'Thanks. Your message was sent.',
  fast: 'That was very quick. Please check your details and press send again.',
  rate: 'You’ve sent several messages in the last few minutes. Please wait a few minutes and try again.',
  long: 'One of your answers is too long. Please shorten it and send again.',
  big: 'There’s too much in this form to send. Please shorten your message and try again.',
  empty: 'Please fill in the form before sending.',
  check: 'Please complete the “I’m not a robot” check and send again.',
  invalid: 'Something went wrong with the form. Please reload the page and try again.',
  down: 'Sorry, your message couldn’t be sent right now. Please try again later.',
};
