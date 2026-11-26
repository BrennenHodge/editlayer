// Server-side clean-up of HTML saved from the editor or an AI connection.
//
// Two levels:
// - Editors and admins are trusted staff, so their HTML keeps the page's own markup (forms, tables, embeds,
//   stylesheets) and loses only what can run code or break the editor.
// - Authors and AI connections ("strict") are held to more: an AI can be steered by text it read somewhere
//   else (prompt injection), and an author's draft goes live as soon as an editor approves it. On top of the
//   editor rules, they cannot add an iframe from a site that isn't a known video/map host, a form that sends
//   to another site, a <style> or a <link>. Anything of that kind that was already in the region before the
//   change (the developer's own Formspree form, an embedded calendar) is kept, so editing text around it
//   never breaks it.
//
// sanitize(html, { strict, previous, embedHosts, removed }) — `removed` (an array) collects a short note for
// everything taken out, so the caller can tell the person (or the AI) what happened.

import { JUNK_TAG, JUNK_ATTR, JUNK_STYLE, JUNK_MARKER } from './junk.js';
import { DOCUMENT_MEMBERS } from './clobber.js';

const HTML_NS = 'http://www.w3.org/1999/xhtml';
const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'poster', 'xlink:href', 'background', 'lowsrc', 'dynsrc',
  'data', 'cite', 'longdesc', 'codebase', 'manifest', 'icon', 'archive', 'profile', 'usemap']);
const junkTag = new RegExp(JUNK_TAG);
const junkAttr = new RegExp(JUNK_ATTR);
const junkStyle = new RegExp(JUNK_STYLE, 'gi');
const SVG_ANIMATION = /^(animate|animatemotion|animatetransform|animatecolor|set|discard)$/;
// Elements no page region needs that can load or run something.
const DROP = /^(script|base|meta|object|embed|applet|frame|frameset|portal|math|param)$/;
// Elements the browser exposes on `document` by name (and id), which could shadow document.querySelector & co.
const NAMED_ON_DOCUMENT = /^(img|form|iframe|embed|object)$/;
// Ids and names the editor itself relies on ("editlayer-state", window.__editlayer …).
const RESERVED_ID = /^(editlayer-|__editlayer)/i;

/** iframes an author or AI may add: video and map players. Sites add more with createCms({ embeds: ['calendly.com'] }). */
export const EMBED_HOSTS = ['www.youtube.com', 'youtube.com', 'www.youtube-nocookie.com', 'youtube-nocookie.com', 'player.vimeo.com',
  'www.google.com/maps/embed', 'maps.google.com'];

// Named character references that can spell a URL scheme ("java&Tab;script&colon;").
const NAMED = { tab: String.fromCharCode(9), newline: String.fromCharCode(10), colon: ':', amp: '&', quot: '"', apos: "'",
  lt: '<', gt: '>', nbsp: ' ', sol: '/', period: '.', lpar: '(', rpar: ')', semi: ';', comma: ',', bsol: '\\' };
const codePoint = (n) => String.fromCodePoint(n > 0 && n <= 0x10ffff ? n : 0xfffd);
/** Attribute text as the browser reads it: numeric and common named character references decoded. */
function decodeRefs(value) {
  return String(value || '')
    .replace(/&#x([0-9a-f]+);?/gi, (_, h) => codePoint(parseInt(h, 16)))
    .replace(/&#([0-9]+);?/g, (_, n) => codePoint(parseInt(n, 10)))
    .replace(/&([a-z]+);?/gi, (m, name) => NAMED[name.toLowerCase()] ?? m);
}

export function badUrl(value) {
  const decoded = decodeRefs(decodeRefs(value));
  // An unknown character reference before the first colon could still hide a scheme: refuse it.
  if (decoded.includes(':') && /&[a-z0-9#]+;?/i.test(decoded.split(':')[0])) return true;
  const v = String(decoded).replace(/[\u0000- ]/g, '').toLowerCase();
  return v.startsWith('javascript:') || v.startsWith('vbscript:') || (v.startsWith('data:') && !v.startsWith('data:image/')) || v.startsWith('data:image/svg');
}

/** Every URL in a srcset ("a.jpg 1x, b.jpg 2x") must be harmless. */
const badSrcset = (value) => decodeRefs(value).split(',').some((part) => {
  const url = part.trim().split(/\s+/)[0] || '';
  return url && badUrl(url);
});

/** Inline styles that can still run code in old browsers or bind behaviour. */
const badStyle = (value) => /expression\s*\(|javascript:|vbscript:|-moz-binding|behavior\s*:/i.test(decodeRefs(value).replace(/\\/g, ''));

/** A same-site address: "/contact/", "#form", "?x=1" or empty — never "//other.site" or "/\other". */
const sameSite = (value) => {
  const v = decodeRefs(value).trim();
  return v === '' || (/^[/?#]/.test(v) && !/^[/\\]{2}|^\/\\/.test(v));
};
const norm = (s) => decodeRefs(s).replace(/\s+/g, ' ').trim();

/** Is this iframe address one of the allowed players? */
function embedAllowed(src, hosts) {
  let u;
  try { u = new URL(decodeRefs(src).trim()); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  return hosts.some((h) => {
    const [hh, ...p] = String(h).toLowerCase().split('/');
    const path = p.length ? `/${p.join('/')}` : '';
    return (host === hh || (!path && host.endsWith(`.${hh}`) && hh.includes('.'))) && (!path || u.pathname.startsWith(path));
  });
}

/** Addresses and styles already in the region before this change: strict saves may keep these. */
async function existing(previous) {
  const out = { urls: new Set(), styles: new Set(), links: new Set() };
  if (!previous) return out;
  let style = null;
  await new HTMLRewriter()
    .on('iframe[src]', { element: (el) => out.urls.add(norm(el.getAttribute('src'))) })
    .on('[action]', { element: (el) => out.urls.add(norm(el.getAttribute('action'))) })
    .on('[formaction]', { element: (el) => out.urls.add(norm(el.getAttribute('formaction'))) })
    .on('link[href]', { element: (el) => out.links.add(norm(el.getAttribute('href'))) })
    .on('style', {
      element() { style = ''; },
      text(t) { if (style === null) return; style += t.text; if (t.lastInTextNode) { out.styles.add(norm(style)); style = null; } },
    })
    .transform(new Response(previous, { headers: { 'content-type': 'text/html' } })).text();
  return out;
}

export async function sanitize(html, options = {}) {
  const strict = Boolean(options.strict);
  const hosts = [...EMBED_HOSTS, ...(Array.isArray(options.embedHosts) ? options.embedHosts.filter((h) => typeof h === 'string' && /^[a-z0-9.-]+(\/[\w./-]*)?$/i.test(h)) : [])];
  const had = strict ? await existing(options.previous) : null;
  const notes = new Set();
  const note = (s) => notes.add(s);
  const hostOf = (src) => { try { return new URL(decodeRefs(src).trim()).hostname; } catch { return 'an unknown address'; } };
  let styleText = null;   // text of the <style> being read (strict)

  const rw = new HTMLRewriter()
    .on('iframe', {
      element(el) {
        const src = el.getAttribute('src') || '';
        if (!/^https:\/\//i.test(decodeRefs(src).trim())) { el.remove(); note('an iframe without a secure (https) address'); return; }
        if (strict && !embedAllowed(src, hosts) && !had.urls.has(norm(src))) { el.remove(); note(`an embedded page from ${hostOf(src)}`); }
      },
    })
    .on('link', {
      element(el) {
        const href = el.getAttribute('href') || '';
        const rel = (el.getAttribute('rel') || '').toLowerCase().split(/\s+/);
        const ok = rel.includes('stylesheet') && !badUrl(href) && (strict ? sameSite(href) && href.trim() !== '' || had.links.has(norm(href)) : sameSite(href) || /^https:\/\//i.test(decodeRefs(href).trim()));
        if (!ok) { el.remove(); note('a <link> element'); }
      },
    })
    .on('style', {
      element(el) {
        // <style> inside SVG or MathML is parsed differently by browsers and by this sanitizer: never keep it.
        if (el.namespaceURI && el.namespaceURI !== HTML_NS) { el.remove(); note('a <style> inside SVG'); return; }
        if (strict) styleText = '';
      },
      text(t) {
        if (styleText === null) return;
        styleText += t.text;
        t.remove();
        if (t.lastInTextNode) {
          if (had.styles.has(norm(styleText))) t.after(styleText, { html: true });
          else note('a <style> block');
          styleText = null;
        }
      },
    })
    .on('*', {
      element(el) {
        const tag = el.tagName.toLowerCase();
        if (DROP.test(tag)) { el.remove(); note(`a <${tag}> element`); return; }
        // Browser-extension overlays (Grammarly, password managers...) typed into the page by accident.
        if (junkTag.test(tag) || el.hasAttribute(JUNK_MARKER)) { el.remove(); return; }
        // SVG animation can rewrite another attribute (an href) after the fact: editors never need it.
        if (SVG_ANIMATION.test(tag)) { el.remove(); note('SVG animation'); return; }
        for (const [name, value] of [...el.attributes]) {
          const n = name.toLowerCase();
          const drop = (why) => { el.removeAttribute(name); if (why) note(why); };
          if (n === 'id' || n === 'name') {
            const v = value.trim();
            if (RESERVED_ID.test(v)) drop(`a reserved ${n} ("${v.slice(0, 40)}")`);
            else if (NAMED_ON_DOCUMENT.test(tag) && DOCUMENT_MEMBERS.has(v)) drop(`a ${n} that clashes with the browser ("${v.slice(0, 40)}")`);
            continue;
          }
          if (n.startsWith('on')) drop(`an ${n} script`);
          else if (n === 'contenteditable' || n === 'spellcheck' || n.startsWith('data-editlayer') || junkAttr.test(n)) drop();
          else if (n === 'srcdoc' || n === 'ping') drop(`a ${n} attribute`);
          else if (n === 'style') {
            if (badStyle(value)) { drop('a style with script in it'); continue; }
            if (value.toLowerCase().includes('--darkreader-')) {
              const rest = value.replace(junkStyle, '').trim();
              if (rest) el.setAttribute(name, rest); else el.removeAttribute(name);
            }
          } else if (URL_ATTRS.has(n) && badUrl(value)) drop(`a ${n === 'href' ? 'link' : n} with a script address`);
          else if ((n === 'srcset' || n === 'imagesrcset') && badSrcset(value)) drop('an image with a script address');
          else if (strict && (n === 'action' || n === 'formaction') && !sameSite(value) && !had.urls.has(norm(value))) {
            drop(`a form that sends to ${hostOf(value)}`);
          }
        }
      },
    });
  const out = await rw.transform(new Response(html, { headers: { 'content-type': 'text/html' } })).text();
  if (Array.isArray(options.removed)) for (const n of notes) if (!options.removed.includes(n)) options.removed.push(n);
  return out;
}

/** Removes sections an editor hid (kept in drafts so they can be shown again). */
export async function stripHidden(html) {
  if (!html.includes('data-cms-hidden')) return html;
  return new HTMLRewriter()
    .on('[data-cms-hidden]', { element: (el) => el.remove() })
    .transform(new Response(html, { headers: { 'content-type': 'text/html' } }))
    .text();
}
