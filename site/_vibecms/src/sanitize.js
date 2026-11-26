// Server-side clean-up of HTML saved from the editor. Editors are trusted staff, so this keeps the
// page's own markup (forms, tables, embeds) and removes only what can run code.

import { JUNK_TAG, JUNK_ATTR, JUNK_STYLE, JUNK_MARKER } from './junk.js';

const URL_ATTRS = ['href', 'src', 'action', 'formaction', 'poster', 'xlink:href'];
const junkTag = new RegExp(JUNK_TAG);
const junkAttr = new RegExp(JUNK_ATTR);
const junkStyle = new RegExp(JUNK_STYLE, 'gi');
const SVG_ANIMATION = /^(animate|animatemotion|animatetransform|animatecolor|set|discard)$/;

// Named character references that can spell a URL scheme ("java&Tab;script&colon;").
const NAMED = { tab: String.fromCharCode(9), newline: String.fromCharCode(10), colon: ':', amp: '&', quot: '"', apos: "'",
  lt: '<', gt: '>', nbsp: ' ', sol: '/', period: '.', lpar: '(', rpar: ')', semi: ';', comma: ',' };
const codePoint = (n) => String.fromCodePoint(n > 0 && n <= 0x10ffff ? n : 0xfffd);
/** Attribute text as the browser reads it: numeric and common named character references decoded. */
function decodeRefs(value) {
  return String(value || '')
    .replace(/&#x([0-9a-f]+);?/gi, (_, h) => codePoint(parseInt(h, 16)))
    .replace(/&#([0-9]+);?/g, (_, n) => codePoint(parseInt(n, 10)))
    .replace(/&([a-z]+);?/gi, (m, name) => NAMED[name.toLowerCase()] ?? m);
}

function badUrl(value) {
  const decoded = decodeRefs(decodeRefs(value));
  // An unknown character reference before the first colon could still hide a scheme: refuse it.
  if (decoded.includes(':') && /&[a-z0-9#]+;?/i.test(decoded.split(':')[0])) return true;
  const v = String(decoded).replace(/[\u0000- ]/g, '').toLowerCase();
  return v.startsWith('javascript:') || v.startsWith('vbscript:') || (v.startsWith('data:') && !v.startsWith('data:image/') ) || v.startsWith('data:image/svg');
}

export async function sanitize(html) {
  const rw = new HTMLRewriter()
    .on('script', { element: (el) => el.remove() })
    .on('base', { element: (el) => el.remove() })
    .on('meta', { element: (el) => el.remove() })
    .on('object', { element: (el) => el.remove() })
    .on('embed', { element: (el) => el.remove() })
    .on('iframe', {
      element(el) {
        if (!/^https:\/\//i.test(el.getAttribute('src') || '')) el.remove();
        else el.removeAttribute('srcdoc');
      },
    })
    .on('*', {
      element(el) {
        // Browser-extension overlays (Grammarly, password managers...) typed into the page by accident.
        if (junkTag.test(el.tagName.toLowerCase()) || el.hasAttribute(JUNK_MARKER)) { el.remove(); return; }
        // SVG animation can rewrite another attribute (an href) after the fact: editors never need it.
        if (SVG_ANIMATION.test(el.tagName.toLowerCase())) { el.remove(); return; }
        for (const [name, value] of [...el.attributes]) {
          const n = name.toLowerCase();
          // ids/names the editor relies on ("vibecms-state" …) can't be planted in content.
          if ((n === 'id' || n === 'name') && /^vibecms-/i.test(value.trim())) { el.removeAttribute(name); continue; }
          if (n.startsWith('on') || n === 'contenteditable' || n === 'spellcheck' || n.startsWith('data-vibecms') || junkAttr.test(n)) el.removeAttribute(name);
          else if (n === 'style' && value.toLowerCase().includes('--darkreader-')) {
            const rest = value.replace(junkStyle, '').trim();
            if (rest) el.setAttribute(name, rest); else el.removeAttribute(name);
          }
          else if (URL_ATTRS.includes(n) && badUrl(value)) el.removeAttribute(name);
          else if (n === 'srcset' && /javascript:/i.test(value)) el.removeAttribute(name);
        }
      },
    });
  return rw.transform(new Response(html, { headers: { 'content-type': 'text/html' } })).text();
}

/** Removes sections an editor hid (kept in drafts so they can be shown again). */
export async function stripHidden(html) {
  if (!html.includes('data-cms-hidden')) return html;
  return new HTMLRewriter()
    .on('[data-cms-hidden]', { element: (el) => el.remove() })
    .transform(new Response(html, { headers: { 'content-type': 'text/html' } }))
    .text();
}
