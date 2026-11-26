// Text normalization shared by the finder, the editor and the tests.
// "Normalized" text is what a reader sees: HTML entities decoded, every run of whitespace one space, trimmed.

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”',
  mdash: '—', ndash: '–', hellip: '…', copy: '©', reg: '®', trade: '™', middot: '·', bull: '•', deg: '°',
  times: '×', rarr: '→', larr: '←', laquo: '«', raquo: '»', shy: '',
};

const WS = /[\s\u00a0\u200b]/;

/** Decodes one entity at s[i] ('&'). Returns [decoded, length] or null. */
function entityAt(s, i) {
  const m = /^&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/i.exec(s.slice(i, i + 12));
  if (!m) return null;
  const e = m[1];
  let ch;
  if (e[0] === '#') {
    const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    if (!Number.isFinite(code) || code > 0x10ffff) return null;
    ch = String.fromCodePoint(code);
  } else {
    ch = ENTITIES[e.toLowerCase()];
    if (ch === undefined) return null;
  }
  return [ch, m[0].length];
}

/** Short JSX string expressions that render as text: {" "}, {"'"}, {'—'}. Returns [text, length] or null. */
function jsxStringAt(s, i) {
  const m = /^\{\s*(["'])([^"'\\{}\n]{0,3})\1\s*\}/.exec(s.slice(i, i + 16));
  return m ? [m[2], m[0].length] : null;
}

/** A JavaScript string escape at s[i] ('\'):  , \u{2014}, \x41, \n, \', \" and so on. Returns [text, length] or null. */
function jsEscapeAt(s, i) {
  const n = s[i + 1];
  if (n === 'u') {
    const m = /^\\u(?:\{([0-9a-f]{1,6})\}|([0-9a-f]{4}))/i.exec(s.slice(i, i + 10));
    if (!m) return null;
    return [String.fromCodePoint(parseInt(m[1] || m[2], 16)), m[0].length];
  }
  if (n === 'x') {
    const m = /^\\x([0-9a-f]{2})/i.exec(s.slice(i, i + 4));
    return m ? [String.fromCharCode(parseInt(m[1], 16)), 4] : null;
  }
  const simple = { n: ' ', t: ' ', r: '', "'": "'", '"': '"', '`': '`', '\\': '\\', '/': '/' };
  return n in simple ? [simple[n], 2] : null;
}

/**
 * Normalizes raw source text and keeps, for every normalized character, the raw range it came from.
 * opts.jsx: also read {" "}-style expressions as text. opts.js: read string escapes ( , \') as what they mean.
 * Returns { text, start: Int32Array, end: Int32Array } where text[k] came from raw[start[k], end[k]).
 */
export function normalizeWithMap(raw, opts = {}) {
  const out = [];
  const start = [];
  const end = [];
  const push = (ch, a, b) => {
    if (ch === ' ') {
      if (!out.length || out[out.length - 1] === ' ') {
        if (out.length) end[end.length - 1] = b; // extend the existing space
        return;
      }
    }
    out.push(ch);
    start.push(a);
    end.push(b);
  };
  let i = 0;
  while (i < raw.length) {
    const c = raw[i];
    if (c === '&') {
      const e = entityAt(raw, i);
      if (e) {
        for (const ch of e[0]) push(WS.test(ch) ? ' ' : ch, i, i + e[1]);
        i += e[1];
        continue;
      }
    }
    if (opts.js && c === '\\') {
      const j = jsEscapeAt(raw, i);
      if (j) {
        for (const ch of j[0]) push(WS.test(ch) ? ' ' : ch, i, i + j[1]);
        i += j[1];
        continue;
      }
    }
    if (opts.jsx && c === '{') {
      const j = jsxStringAt(raw, i);
      if (j) {
        for (const ch of j[0]) push(WS.test(ch) ? ' ' : ch, i, i + j[1]);
        i += j[1];
        continue;
      }
    }
    push(WS.test(c) ? ' ' : c, i, i + 1);
    i++;
  }
  // trim a trailing space
  if (out[out.length - 1] === ' ') { out.pop(); start.pop(); end.pop(); }
  return { text: out.join(''), start: Int32Array.from(start), end: Int32Array.from(end) };
}

/** What a reader sees, as a plain string. */
export function norm(s) {
  return normalizeWithMap(String(s ?? '')).text;
}

const WORD = /[\p{L}\p{N}]/u;
export const isWordChar = (ch) => !!ch && WORD.test(ch);

/** All indexes of needle in hay where the match doesn't cut a word in half. */
export function occurrences(hay, needle) {
  const found = [];
  if (!needle) return found;
  let i = hay.indexOf(needle);
  while (i !== -1) {
    const before = hay[i - 1];
    const after = hay[i + needle.length];
    const okStart = !isWordChar(needle[0]) || !isWordChar(before);
    const okEnd = !isWordChar(needle[needle.length - 1]) || !isWordChar(after);
    if (okStart && okEnd) found.push(i);
    i = hay.indexOf(needle, i + 1);
  }
  return found;
}

/** 1-based line and column of a raw offset. */
export function lineCol(raw, offset) {
  let line = 1;
  let last = -1;
  for (let i = 0; i < offset; i++) if (raw.charCodeAt(i) === 10) { line++; last = i; }
  return { line, col: offset - last };
}
