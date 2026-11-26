// Optional hand-offs after a submission is stored: an email (Resend) and a Salesforce Web-to-Lead post.
// Both run in waitUntil, never throw, and never change what the visitor sees.

import { EMAIL_RE, fieldLabel, formLabel, summarize } from './fields.js';

export const RESEND_URL = 'https://api.resend.com/emails';
export const SALESFORCE_URL = 'https://webto.salesforce.com/servlet/servlet.WebToLead?encoding=UTF-8';
const OID_RE = /^[A-Za-z0-9]{15,18}$/;
const SF_FIELD_RE = /^[A-Za-z][A-Za-z0-9_]{0,79}$/;

const oneLine = (s, n = 150) => String(s || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, n);

/** The addresses that get an email: the editors' list (published "@forms" setting) if there is one, else opts. */
export function recipients(cfgTo, savedTo) {
  const list = Array.isArray(savedTo) ? savedTo : Array.isArray(cfgTo) ? cfgTo : cfgTo ? String(cfgTo).split(',') : [];
  return [...new Set(list.map((s) => String(s).trim()).filter((s) => EMAIL_RE.test(s)))].slice(0, 10);
}

/** Email is possible when the Worker has a Resend key and the site set a sender (opts.forms.notify.from). */
export function emailReady(env, notify) {
  return Boolean(env && env.RESEND_API_KEY && notify && typeof notify.from === 'string' && notify.from.includes('@'));
}

export async function sendEmail({ env, notify, to, form, pairs, page, origin, siteName, labels, fetchImpl = fetch }) {
  try {
    if (!emailReady(env, notify) || !to.length) return { skipped: true };
    if (Array.isArray(notify.forms) && !notify.forms.includes(form)) return { skipped: true };
    const { name, email } = summarize(pairs);
    const label = formLabel(form, labels);
    const text = [
      `New message from the ${label} form on ${siteName || origin}.`,
      '',
      ...pairs.map(([k, v]) => `${fieldLabel(k)}:\n${v}\n`),
      `Sent from: ${origin}${page || '/'}`,
      `Read and manage messages in the Inbox: ${origin}/?edit`,
    ].join('\n');
    const body = {
      from: oneLine(notify.from, 200),
      to,
      subject: oneLine(`${label} form: ${name || email || 'new message'}`),
      text,
    };
    if (email) body.reply_to = email;
    const res = await fetchImpl(RESEND_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) console.error('vibecms forms: email failed', res.status);
    return { sent: res.ok };
  } catch (err) {
    console.error('vibecms forms: email failed', err && err.message);
    return { error: true };
  }
}

/** opts.forms.salesforce = { oid, forms: ['contact'], fields: { email: 'email', company: 'company' }, leadSource } */
export function salesforceBody(sf, form, pairs) {
  if (!sf || !OID_RE.test(String(sf.oid || ''))) return null;
  if (Array.isArray(sf.forms) && !sf.forms.includes(form)) return null;
  const body = new URLSearchParams();
  body.set('oid', sf.oid);
  body.set('encoding', 'UTF-8');
  if (sf.leadSource) body.set('lead_source', oneLine(sf.leadSource, 40));
  let mapped = 0;
  for (const [siteField, sfField] of Object.entries(sf.fields || {})) {
    if (!SF_FIELD_RE.test(String(sfField))) continue;
    const value = pairs.filter(([k]) => k === siteField).map(([, v]) => v).join('; ');
    if (!value) continue;
    body.set(sfField, value.slice(0, 32000));
    mapped++;
  }
  return mapped ? body : null;
}

export async function sendToSalesforce({ sf, form, pairs, fetchImpl = fetch }) {
  try {
    const body = salesforceBody(sf, form, pairs);
    if (!body) return { skipped: true };
    const res = await fetchImpl(SALESFORCE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      redirect: 'manual',
    });
    if (res.status >= 400) console.error('vibecms forms: Salesforce failed', res.status);
    return { sent: res.status < 400 };
  } catch (err) {
    console.error('vibecms forms: Salesforce failed', err && err.message);
    return { error: true };
  }
}

/** Cloudflare Turnstile check. Returns true, false, or null when the check service can't be reached. */
export async function verifyTurnstile({ secret, token, ip, fetchImpl = fetch }) {
  if (!token) return false;
  try {
    const body = new URLSearchParams({ secret, response: String(token).slice(0, 2048) });
    if (ip) body.set('remoteip', ip);
    const res = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.success === true;
  } catch {
    return null;
  }
}
