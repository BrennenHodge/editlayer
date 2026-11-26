// Quality: checks before publishing (missing picture descriptions, broken links, heading order,
// hard-to-read text, page title and description, leftover placeholder text) and "Edit as form" for
// repeated items (cards, team members, list items, table rows).
feature('quality', (core) => {
  const { d, R, esc, icon } = core;
  const uiRoot = R.bar.parentElement;
  const mobile = () => innerWidth <= 760;

  core.addIcons({
    form: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    alert: '<path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
    left: '<path d="m15 18-6-6 6-6"/>',
    right: '<path d="m9 18 6-6-6-6"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  });

  /* ================================================================ helpers */
  const clip = (s, n = 60) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
  const quote = (s, n = 50) => `“${clip(s, n).replace(/(\S)\.$/, '$1')}”`;
  const before = (a, b) => (a === b ? 0 : a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
  const badHref = (v) => /^(javascript|data|vbscript):/i.test(String(v || '').replace(/[\u0000-\u0020]/g, ''));  // like the server: browsers skip tabs and spaces in the scheme
  const normPath = (p) => {
    if (p.endsWith('/index.html')) p = p.slice(0, -'index.html'.length);
    if (!p.endsWith('/') && !/\.[a-z0-9]+$/i.test(p)) p += '/';
    return p;
  };
  /** Page regions, without regions nested in other regions (shared sections). */
  const topRegions = () => [...d.querySelectorAll('[data-cms]')].filter((r) => !r.parentElement || !r.parentElement.closest('[data-cms]'));
  /** Visitors see it: not in a hidden section, not locked (the site's script fills it), rendered. */
  const rendered = (el) => (el.checkVisibility ? el.checkVisibility({ visibilityProperty: true }) : el.getClientRects().length > 0);
  const live = (el) => !el.closest('[data-cms-hidden]') && !core.locked(el) && rendered(el);
  function textNodes(root, all = false) {
    const w = d.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => ((all || /\S/.test(n.data)) && !n.parentElement.closest('script,style,noscript,template,svg') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    const out = [];
    while (w.nextNode()) out.push(w.currentNode);
    return out;
  }
  function nameOf(el) {
    const by = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).map((id) => d.getElementById(id)?.textContent || '').join(' ').trim();
    return by || (el.getAttribute('aria-label') || '').trim() || (el.textContent || '').replace(/\s+/g, ' ').trim()
      || [...el.querySelectorAll('img[alt]')].map((i) => i.alt.trim()).join(' ').trim()
      || (el.getAttribute('title') || '').trim() || (el.querySelector('svg title')?.textContent || '').trim()
      || (el.tagName === 'INPUT' ? (el.value || '').trim() : '');
  }

  /* ================================================================ colour and contrast */
  const cv = d.createElement('canvas');
  cv.width = 1; cv.height = 1;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const colours = new Map();
  /** Any CSS colour → [r, g, b, a] (0–255, alpha 0–1). Unusual formats are read back through a canvas. */
  function rgba(str) {
    if (colours.has(str)) return colours.get(str);
    let out;
    const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+)(%?))?\s*\)$/.exec(str);
    if (m) out = [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : m[5] ? +m[4] / 100 : +m[4]];
    else if (!str || str === 'transparent') out = [0, 0, 0, 0];
    else {
      cx.clearRect(0, 0, 1, 1);
      cx.fillStyle = '#000';
      cx.fillStyle = str;
      cx.fillRect(0, 0, 1, 1);
      const p = cx.getImageData(0, 0, 1, 1).data;
      out = [p[0], p[1], p[2], p[3] / 255];
    }
    colours.set(str, out);
    return out;
  }
  const mix = (top, bottom) => [0, 1, 2].map((i) => top[i] * top[3] + bottom[i] * (1 - top[3]));
  const lum = (c) => {
    const [r, g, b] = c.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const hex = (c) => `#${c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
  /** The colour behind an element: its own background or the nearest one behind it. null when a picture is behind it. */
  function backdropOf(el, memo) {
    if (!el || el.nodeType !== 1) return { color: [255, 255, 255], host: d.documentElement };
    if (memo.has(el)) return memo.get(el);
    const cs = getComputedStyle(el);
    const bc = rgba(cs.backgroundColor);
    const bi = cs.backgroundImage;
    let res;
    if (bi && bi !== 'none' && (/url\(|image-set\(|cross-fade\(|element\(/i.test(bi) || bc[3] < 0.999)) res = null;
    else if (bc[3] >= 0.999) res = { color: bc.slice(0, 3), host: el };
    else {
      const up = backdropOf(el.parentElement, memo);
      res = !up ? null : bc[3] > 0 ? { color: mix(bc, up.color), host: up.host } : up;
    }
    memo.set(el, res);
    return res;
  }
  function overImage(rect, host, el, memo) {
    if (!memo.has(host)) memo.set(host, [...host.querySelectorAll('img,video,canvas,iframe')].map((m) => [m, m.getBoundingClientRect()]));
    const area = rect.width * rect.height || 1;
    return memo.get(host).some(([m, r]) => {
      if (el.contains(m)) return false;
      const w = Math.min(rect.right, r.right) - Math.max(rect.left, r.left);
      const h = Math.min(rect.bottom, r.bottom) - Math.max(rect.top, r.top);
      return w > 0 && h > 0 && (w * h) / area > 0.25;
    });
  }

  /* ================================================================ the checks */
  const CATS = [
    ['meta', 'Page settings'],
    ['images', 'Pictures'],
    ['links', 'Links and buttons'],
    ['headings', 'Headings'],
    ['contrast', 'Hard-to-read text'],
    ['placeholder', 'Unfinished text'],
  ];
  const PLACEHOLDER = [
    [/lorem ipsum|dolor sit amet/i, 'Sample “Lorem ipsum” text'],
    [/\[[^\]\d\s][^\]]{1,80}\]/, 'Text in [square brackets]'],
    [/\{\{[^}]{1,60}\}\}/, 'Text in {{curly brackets}}'],
    [/\b(TODO|TBD|TKTK|FIXME)\b/, 'A “to do” note'],
    [/\b(placeholder text|your text here|(?:text|title|heading|name|label|caption|button) goes here|insert (?:text|name|title|description) here)\b/i, 'Placeholder words'],
  ];
  /** Logos and wordmarks: WCAG doesn't ask text that is part of a logo to meet a contrast ratio. */
  const LOGO = /^(brand|logo|wordmark|site-?(name|title)|navbar-brand)(?![a-z])/i;
  const isLogo = (el) => {
    for (let n = el; n && n !== d.body; n = n.parentElement) {
      if (typeof n.className === 'string' && n.className.split(/\s+/).some((c) => LOGO.test(c))) return true;
      if (n.tagName === 'A' && n.getAttribute('href') === '/' && n.hasAttribute('aria-label')) return true;  // the home link with the site's name
    }
    return false;
  };

  /** Words of the site's ready-made sections ("Heading for the cards", "Link text"…): left on a page, they are unfinished. */
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  let sampleText = null;
  function readySamples() {
    if (!sampleText) {
      const url = core.S.features && core.S.features.sections && core.S.features.sections.blocks;
      sampleText = !url ? Promise.resolve(new Set()) : fetch(url, { credentials: 'same-origin' })
        .then((r) => (r.ok ? r.text() : ''))
        .then((html) => {
          const doc = new DOMParser().parseFromString(html, 'text/html');
          const set = new Set();
          for (const el of doc.querySelectorAll('[data-block] *')) {
            if (![...el.childNodes].some((n) => n.nodeType === 3 && /\S/.test(n.data))) continue;
            const t = norm(el.textContent);
            if (t.length >= 4 && /\p{L}/u.test(t)) set.add(t);
          }
          return set;
        })
        .catch(() => new Set());
    }
    return sampleText;
  }
  const PROMPT = /^(add|write|enter|describe|insert|replace|type)\b(?: (?:a|an|the|your|some))? [^.!?]{2,90}\.$/i;
  const CLICK_HERE = /^(click here|click|here|this|this link|link|go|more here)$/i;

  const shared = (core.S.features && core.S.features.quality) || {};
  const ignored = new Set(Array.isArray(shared.ignored) ? shared.ignored.filter((s) => typeof s === 'string') : []);
  let ignoresChanged = false;
  function setIgnored(id, on) {
    if (on) ignored.add(id); else ignored.delete(id);
    ignoresChanged = true;
    core.setExtra('#checks', { ignored: [...ignored] });
  }

  async function pool(tasks, n = 6) {
    const out = [];
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, async () => { while (i < tasks.length) { const k = i++; out[k] = await tasks[k](); } }));
    return out;
  }
  function probe(url, cache) {
    if (!cache.has(url)) {
      cache.set(url, (async () => {
        const ac = new AbortController();
        const t = setTimeout(() => ac.abort(), 6000);
        try {
          let r = await fetch(url, { method: 'HEAD', credentials: 'same-origin', signal: ac.signal });
          if (r.status === 405 || r.status === 501) r = await fetch(url, { credentials: 'same-origin', signal: ac.signal });
          return r.status;
        } catch { return 0; } finally { clearTimeout(t); }
      })());
    }
    return cache.get(url);
  }
  function pageIds(path, cache) {
    if (!cache.has(path)) {
      cache.set(path, fetch(path, { credentials: 'same-origin' }).then((r) => (r.ok ? r.text() : null)).then((html) => {
        if (html === null) return null;
        const doc = new DOMParser().parseFromString(html, 'text/html');
        return new Set([...doc.querySelectorAll('[id],a[name]')].map((e) => e.id || e.getAttribute('name')));
      }).catch(() => null));
    }
    return cache.get(path);
  }

  /** Looks at the page and returns everything that needs attention, ignored ones included (flagged). */
  async function runChecks(typed = null) {
    const issues = [];
    const add = (cat, key, title, detail, el, extra = {}) => {
      const id = `${cat}:${key}`.slice(0, 190);
      const ex = issues.find((i) => i.id === id);
      if (ex) { if (el && !ex.els.includes(el)) ex.els.push(el); return ex; }
      const it = { id, cat, title, detail, els: el ? [el] : [], ...extra };
      issues.push(it);
      return it;
    };
    const regions = topRegions();
    const inRegions = (selector) => regions.flatMap((r) => [...r.querySelectorAll(selector)]).filter(live);
    const inRegion = (el) => regions.some((r) => r.contains(el));

    // Page settings: title and description.
    const meta = typed || core.S.meta || {};  // "Check this page" in Page settings checks what is typed there, saved or not
    const title = String(meta.title || d.title || '').trim();
    const desc = String(meta.description || d.querySelector('meta[name="description"]')?.content || '').trim();
    if (!title) add('meta', 'title-empty', 'The page has no title', 'Google and browser tabs show the title. Add one in Page settings.', null, { fix: 'settings' });
    else if (title.length > 60) add('meta', 'title-long', 'The page title is long', `It has ${title.length} characters. Google shows about 60, so the end gets cut off.`, null, { fix: 'settings' });
    if (!desc) add('meta', 'desc-empty', 'The page has no description', 'Google shows the description under the title in search results. Add one in Page settings.', null, { fix: 'settings' });
    else if (desc.length > 160) add('meta', 'desc-long', 'The page description is long', `It has ${desc.length} characters. Google shows about 160, so the end gets cut off.`, null, { fix: 'settings' });

    // Pictures.
    for (const img of inRegions('img')) {
      if (img.closest('[aria-hidden="true"]') || /^(presentation|none)$/i.test(img.getAttribute('role') || '')) continue;
      const alt = img.getAttribute('alt');
      const src = (img.getAttribute('src') || '').split('?')[0].slice(-120);
      const r = img.getBoundingClientRect();
      if (alt === null || !alt.trim()) {
        const tiny = r.width <= 40 && r.height <= 40;
        const wrap = img.closest('a,button');
        const labelled = wrap && nameOf(wrap).replace(/\s+/g, '').length > 0 && (wrap.textContent || '').trim();
        if (alt !== null && (tiny || labelled)) continue;  // clearly decorative: an icon, or a picture beside the words of its link
        add('images', `alt:${src}`, 'A picture has no description', 'Describe what it shows in a few words. Screen readers read it out, and Google uses it.', img);
      } else if (/\.(jpe?g|png|webp|gif|avif|svg|heic)$/i.test(alt.trim()) || /^(img|image|dsc|photo|pic|screenshot)[-_ ]?\d+$/i.test(alt.trim()) || /^(image|picture|photo|graphic|untitled)$/i.test(alt.trim())) {
        add('images', `altname:${src}`, 'A picture description looks like a file name', `It says ${quote(alt)}. Describe what the picture shows instead.`, img);
      }
      if (/placehold|placeholder|dummyimage|via\.placeholder|picsum\.photos/i.test(img.getAttribute('src') || '')) {
        add('placeholder', `img:${src}`, 'A sample picture is still on the page', 'Replace it with a real picture.', img);
      }
    }

    // Links and buttons.
    let pages = [];
    try { pages = await core.sitePages(); } catch { pages = []; }
    const known = new Set(pages.map((p) => p.path));
    const probes = new Map();
    const idCache = new Map();
    const pending = [];
    for (const a of inRegions('a')) {
      const href = a.getAttribute('href');
      const words = nameOf(a);
      const text = clip(words || a.textContent, 40);
      const key = `${href || ''}|${text}`;
      if (href === null) {
        if (words) add('links', `nohref:${key}`, 'A link doesn’t go anywhere', `${quote(text)} looks like a link but has no address. Add where it goes, or remove the link.`, a);
        continue;
      }
      const h = href.trim();
      if (!words) add('links', `noname:${key}`, 'A link has no words', 'Screen readers can’t tell where it goes. Add some words, or a description to its picture.', a);
      if (!h || h === '#' || /^javascript:/i.test(h)) { add('links', `nowhere:${key}`, 'A link doesn’t go anywhere', `${quote(text)} has no address. Add the page or website it should open.`, a); continue; }
      if (words && (CLICK_HERE.test(words) || /\bclick here\b/i.test(words))) add('links', `vague:${key}`, `A link says ${quote(text, 30)}`, 'Say where it goes instead, for example “See the test catalog”. People scanning the page and screen readers rely on it.', a);
      if (/^mailto:/i.test(h)) { if (!/^mailto:[^@\s]+@[^@\s]+\.[^@\s]+/i.test(h)) add('links', `mail:${key}`, 'An email link looks wrong', `${quote(h.slice(7), 40)} isn’t a complete email address.`, a); continue; }
      if (/^tel:/i.test(h)) { if (h.replace(/\D/g, '').length < 7) add('links', `tel:${key}`, 'A phone link looks wrong', `${quote(h.slice(4), 30)} doesn’t look like a full phone number.`, a); continue; }
      if (/^(www\.|[a-z0-9-]+\.(com|org|net|edu|gov|us|io|co|info|biz)(\/|$))/i.test(h)) { add('links', `proto:${key}`, 'A web address is missing “https://”', `${quote(h, 40)} will be treated as a page on this site. Put https:// in front of it.`, a); continue; }
      let url;
      try { url = new URL(h, location.href); } catch { add('links', `bad:${key}`, 'A link address looks wrong', `${quote(h, 40)} isn’t a valid address.`, a); continue; }
      if (url.origin !== location.origin || !/^https?:$/.test(url.protocol)) continue;
      const path = normPath(url.pathname);
      const frag = decodeURIComponent(url.hash.slice(1));
      if (url.pathname === location.pathname || path === core.S.path) {
        if (frag && frag !== 'top' && !d.getElementById(frag) && !d.querySelector(`a[name="${CSS.escape(frag)}"]`)) add('links', `frag:${key}`, 'A link points to a spot that isn’t on this page', `${quote(text)} jumps to “#${clip(frag, 30)}”, which doesn’t exist here.`, a);
        continue;
      }
      pending.push(async () => {
        if (!known.has(path) || !pages.length) {
          const status = await probe(url.origin + url.pathname, probes);
          if (status === 404 || status === 410) { add('links', `broken:${key}`, 'A link goes to a page that doesn’t exist', `${quote(text)} opens ${clip(url.pathname, 50)}, which isn’t on the site.`, a); return; }
          if (status !== 200 && status !== 0) return;
        }
        if (frag && known.has(path)) {
          const ids = await pageIds(url.pathname, idCache);
          if (ids && !ids.has(frag)) add('links', `pfrag:${key}`, 'A link points to a spot that isn’t on that page', `${quote(text)} jumps to “#${clip(frag, 30)}” on ${clip(path, 40)}, which isn’t there.`, a);
        }
      });
    }
    await pool(pending);
    for (const b of inRegions('button,[role="button"],input[type="submit"],input[type="button"]')) {
      if (!nameOf(b)) add('links', `nobutton:${b.className}`, 'A button has no words', 'Add a word or two so people know what it does.', b);
    }

    // Headings: one main heading, no skipped levels, none empty.
    const heads = [...d.body.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter((h) => !h.closest('[data-cms-hidden],[aria-hidden="true"]') && rendered(h) && !core.host.contains(h));
    const h1s = heads.filter((h) => h.tagName === 'H1');
    if (!h1s.length && regions.length) add('headings', 'no-h1', 'The page has no main heading', 'Each page should have one main heading (the large title at the top). Screen readers and Google use it.', null);
    h1s.slice(1).forEach((h) => { if (inRegion(h)) add('headings', `h1:${clip(h.textContent, 40)}`, 'There’s more than one main heading', `${quote(h.textContent)} is a main heading too. Keep one per page and make the others smaller headings.`, h); });
    let prev = 1;
    for (const h of heads) {
      const lvl = +h.tagName[1];
      if (!nameOf(h) && inRegion(h)) add('headings', `empty:${h.className}`, 'A heading is empty', 'Type a heading or delete it. Screen readers announce empty headings.', h);
      else if (lvl > prev + 1 && inRegion(h)) add('headings', `skip:${clip(h.textContent, 40)}`, 'A heading skips a level', `${quote(h.textContent)} jumps from heading level ${prev} to level ${lvl}. Screen readers use the levels like a table of contents.`, h);
      prev = lvl;
    }

    // Text that's hard to read (WCAG AA). Text over pictures is skipped: its background can't be measured.
    const bgMemo = new Map();
    const imgMemo = new Map();
    const done = new Set();
    for (const region of regions) {
      for (const el of region.querySelectorAll('*')) {
        if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|svg|SVG|INPUT|TEXTAREA|SELECT|OPTION)$/.test(el.tagName) || el.namespaceURI !== 'http://www.w3.org/1999/xhtml') continue;
        if (![...el.childNodes].some((n) => n.nodeType === 3 && /\S/.test(n.data))) continue;
        if (!live(el) || isLogo(el)) continue;
        const block = core.textBlockFor(el) || el;
        const cs = getComputedStyle(el);
        if (cs.visibility !== 'visible') continue;
        const rect = el.getBoundingClientRect();
        if (rect.width < 3 || rect.height < 3) continue;
        const fg = rgba(cs.webkitTextFillColor && cs.webkitTextFillColor !== cs.color ? cs.webkitTextFillColor : cs.color);
        if (fg[3] < 0.05) continue;
        const bg = backdropOf(el, bgMemo);
        if (!bg || overImage(rect, bg.host, el, imgMemo)) continue;
        const ink = mix(fg, bg.color);
        const size = parseFloat(cs.fontSize) || 16;
        const large = size >= 24 || (size >= 18.66 && (parseInt(cs.fontWeight, 10) || 400) >= 700);
        const need = large ? 3 : 4.5;
        const r = ratio(ink, bg.color);
        if (r >= need || done.has(block)) continue;
        done.add(block);
        const it = add('contrast', `${hex(ink)}|${hex(bg.color)}|${need}`, 'Text is hard to read against its background',
          `The colours are too close: ${r.toFixed(1)} to 1, and it should be at least ${need} to 1${large ? ' for large text' : ''}.`, block, { swatch: [hex(ink), hex(bg.color)] });
        it.sample = it.sample || clip(block.textContent, 40);
      }
    }

    // Leftover placeholder text.
    const samples = await readySamples();
    const sampleHits = [];
    for (const region of regions) {
      const seen = new Set();
      for (const t of textNodes(region)) {
        const el = t.parentElement;
        if (!live(el)) continue;
        const block = core.textBlockFor(t) || el;
        if (seen.has(block)) continue;
        const txt = block.textContent.replace(/\s+/g, ' ').trim();
        const hit = PLACEHOLDER.find(([re]) => re.test(txt));
        if (hit) { seen.add(block); add('placeholder', `${hit[1]}:${clip(txt, 40)}`, `${hit[1]} is still on the page`, `${quote(txt)}. Replace it with the real text, or delete it.`, block); continue; }
        if (txt.length < 100 && PROMPT.test(txt)) { seen.add(block); add('placeholder', `prompt:${clip(txt, 40)}`, 'A writing prompt hasn’t been replaced', `${quote(txt)} is a prompt. Type the real text over it.`, block); continue; }
        const own = norm(el.textContent);
        if (samples.has(txt) || samples.has(own)) {
          seen.add(block);
          const words = samples.has(txt) ? txt : own;
          sampleHits.push({ words, el: samples.has(txt) ? block : el, sec: core.sectionFor(block) || region });
        }
      }
    }
    // Short labels a site uses for real ("Read bio", "Questions") are only flagged in a section that still
    // has other ready-made words too; three words or more ("Heading for the cards") are flagged anyway.
    const perSection = new Map();
    for (const h of sampleHits) (perSection.get(h.sec) || perSection.set(h.sec, new Set()).get(h.sec)).add(h.words);
    for (const h of sampleHits) {
      if (perSection.get(h.sec).size < 2 && h.words.split(' ').length < 3) continue;
      add('placeholder', `sample:${clip(h.words, 40)}`, 'Sample text from a ready-made section is still on the page', `${quote(h.words)}. Replace it with your own words, or delete it.`, h.el);
    }

    const order = Object.fromEntries(CATS.map(([k], i) => [k, i]));
    issues.forEach((i) => { i.els.sort(before); i.ignored = ignored.has(i.id); });
    issues.sort((a, b) => (order[a.cat] - order[b.cat]) || (a.els[0] && b.els[0] ? before(a.els[0], b.els[0]) : a.els[0] ? 1 : -1));
    return issues;
  }

  /* ================================================================ the report */
  function issueHtml(it, i) {
    const many = it.els.length > 1 ? ` <em>${it.els.length} places</em>` : '';
    const mark = it.swatch
      ? `<span class="qi qsw" style="color:${esc(it.swatch[0])};background:${esc(it.swatch[1])}" aria-hidden="true">Aa</span>`
      : `<span class="qi" aria-hidden="true">${icon('alert')}</span>`;
    const canShow = it.els.length || it.fix;
    return `<li class="${it.ignored ? 'off' : ''}" data-i="${i}">${mark}<div class="qt"><b>${esc(it.title)}${many}</b><span>${esc(it.detail)}</span></div>
      <div class="qa">${canShow ? `<button class="btn" type="button" data-q="show" data-i="${i}">${icon('target')}Show me</button>` : ''}
      <button class="btn qign" type="button" data-q="ignore" data-i="${i}" title="${it.ignored ? 'Warn me about this again' : 'Don’t warn me about this on this page again'}">${it.ignored ? 'Warn again' : 'Ignore'}</button></div></li>`;
  }
  function reportBody(issues) {
    const open = issues.filter((i) => !i.ignored);
    const off = issues.filter((i) => i.ignored);
    const groups = CATS.map(([cat, name]) => [name, open.filter((i) => i.cat === cat)]).filter(([, l]) => l.length);
    return `<p class="qsum">${open.length
      ? `${open.length === 1 ? 'One thing' : `${open.length} things`} on this page could be better. Press <b>Show me</b> to go to each one.`
      : 'Nothing left to look at on this page.'}</p>
      ${groups.map(([name, list]) => `<p class="h3">${esc(name)}</p><ul class="qlist">${list.map((it) => issueHtml(it, issues.indexOf(it))).join('')}</ul>`).join('')}
      ${off.length ? `<details class="qoff"><summary>${off.length} ignored</summary><ul class="qlist">${off.map((it) => issueHtml(it, issues.indexOf(it))).join('')}</ul></details>` : ''}`;
  }

  let nav = null;     // { issues, mode, all, at } after "Show me"
  let bypass = false; // "Publish anyway" from the issue bar skips one round of checks
  const navEl = d.createElement('div');
  navEl.className = 'qnav';
  navEl.setAttribute('role', 'region');
  navEl.setAttribute('aria-label', 'Page check');
  uiRoot.append(navEl);

  /** Shows the report. Resolves true for "Publish anyway", false otherwise. */
  function openReport(issues, mode, all = false) {
    hideNav();
    return new Promise((resolve) => {
      let result = false;
      const foot = mode === 'publish'
        ? `<button class="btn" type="button" data-q="back">Go back</button><button class="btn primary" type="button" data-q="publish">${icon('send')}<span class="qpt">Publish anyway</span></button>`
        : `<button class="btn primary" type="button" data-q="back">Close</button>`;
      const m = core.modal({ title: mode === 'publish' ? 'Before you publish' : 'Page check', body: reportBody(issues), foot, onClose: () => resolve(result) });
      m.el.classList.add('qmodal');
      const mb = m.el.querySelector('.mb');
      const redraw = () => {
        const top = mb.scrollTop;
        mb.innerHTML = reportBody(issues);
        mb.scrollTop = top;
        const t = m.el.querySelector(".qpt");
        if (t) t.textContent = issues.some((i) => !i.ignored) ? 'Publish anyway' : 'Publish';
      };
      m.el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-q]');
        if (!b) return;
        const q = b.dataset.q;
        const it = issues[+b.dataset.i];
        if (q === 'back') m.close();
        if (q === 'publish') { result = true; m.close(); }
        if (q === 'ignore' && it) { it.ignored = !it.ignored; setIgnored(it.id, it.ignored); redraw(); }
        if (q === 'show' && it) { m.close(); startNav(issues, it, mode, all); }
      });
      m.el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); m.close(); } });
      setTimeout(() => (m.el.querySelector('[data-q="show"]') || m.el.querySelector('[data-q="back"]'))?.focus(), 0);
    });
  }

  function targetFor(el) {
    if (el.tagName === 'IMG') return { type: 'image', el };
    if (el.tagName === 'A' && nameOf(el) && !el.querySelector('img')) return { type: 'text', el, label: 'Link' };
    return core.classify(el) || { type: 'item', el, label: 'Here' };
  }
  function startNav(issues, it, mode, all) {
    const steps = issues.filter((i) => !i.ignored || i === it).flatMap((i) => (i.els.length ? i.els.map((el) => ({ it: i, el })) : [{ it: i, el: null }]));
    nav = { issues, steps, mode, all, at: Math.max(0, steps.findIndex((s) => s.it === it)) };
    goStep(nav.at);
    if (it.fix !== 'settings') setTimeout(() => (navEl.querySelector('[data-act="q-next"]:not(:disabled)') || navEl.querySelector('[data-act="q-close"]'))?.focus({ preventScroll: true }), 0);
  }
  function goStep(n) {
    if (!nav) return;
    nav.at = Math.max(0, Math.min(nav.steps.length - 1, n));
    const { it, el } = nav.steps[nav.at];
    if (it.fix === 'settings') {
      // Page settings already open (the check was started there): keep it, with what was typed in it.
      if (!(R.panel.classList.contains('show') && R.panel.querySelector('#ti'))) {
        core.closePanel();
        core.togglePanel('settings');
      }
      setTimeout(() => R.panel.querySelector(it.id.includes('title') ? '#ti' : '#de')?.focus(), 0);
    } else if (el && el.isConnected) {
      core.closePanel();
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      core.select(targetFor(el));
    } else if (!el) {
      core.toast(it.detail);
    }
    drawNav();
  }
  function drawNav() {
    if (!nav) { hideNav(); return; }
    const { it } = nav.steps[nav.at];
    const had = navEl.contains(core.root.activeElement) ? core.root.activeElement.dataset.act : '';  // keep keyboard focus on the same button
    navEl.innerHTML = `<span class="qn">${nav.at + 1} of ${nav.steps.length}</span><span class="qm"><b>${esc(it.title)}</b><span>${esc(it.detail)}</span></span>
      ${core.btn('left', 'Previous', 'q-prev')}${core.btn('right', 'Next', 'q-next')}${core.btn('list', 'See the whole list', 'q-list')}${core.btn('x', 'Close', 'q-close')}`;
    navEl.querySelector('[data-act="q-prev"]').disabled = nav.at === 0;
    navEl.querySelector('[data-act="q-next"]').disabled = nav.at >= nav.steps.length - 1;
    navEl.classList.add('show');
    if (had) (navEl.querySelector(`[data-act="${had}"]:not(:disabled)`) || navEl.querySelector('[data-act="q-close"]'))?.focus({ preventScroll: true });
  }
  function hideNav() { navEl.classList.remove('show'); }
  navEl.addEventListener('mousedown', (e) => { if (core.editing) e.preventDefault(); });
  navEl.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-act]')?.dataset.act;
    if (!a || !nav) return;
    if (a === 'q-prev') goStep(nav.at - 1);
    if (a === 'q-next') goStep(nav.at + 1);
    if (a === 'q-close') { nav = null; hideNav(); }
    if (a === 'q-list') {
      const { mode, all } = nav;
      nav = null;
      hideNav();
      core.finishEdit();
      const issues = await runChecks();
      if (!issues.some((i) => !i.ignored) && mode !== 'publish') { core.toast('Nothing left to look at on this page.'); return; }
      const ok = await openReport(issues, mode, all);
      if (ok) { bypass = true; try { await core.publishNow({ all }); } finally { bypass = false; } }
    }
  });
  core.on('published', () => { nav = null; hideNav(); });

  core.beforePublish(async ({ all }) => {
    if (bypass) { bypass = false; return true; }
    let issues;
    core.toast('Checking the page before publishing…');
    try { issues = await runChecks(); } catch (err) { console.error('editlayer: page checks failed', err); return true; }
    R.toast.className = 'toast';  // the "Checking…" note has done its job
    if (!issues.some((i) => !i.ignored)) { ignoresChanged = false; return true; }
    ignoresChanged = false;
    const ok = await openReport(issues, 'publish', all);
    if (ok && ignoresChanged) await core.save();
    ignoresChanged = false;
    return ok;
  });

  core.on('panel:settings', (pb) => {
    const box = d.createElement('div');
    box.className = 'qbox';
    box.innerHTML = `<p class="h3">Page check</p><p>Looks for pictures without a description, broken links, headings out of order, hard-to-read text and leftover placeholder text.</p>
      <div class="row"><button class="btn" type="button" data-q="check">${icon('search')}Check this page</button></div><div data-q="res" role="status"></div>`;
    pb.append(box);
    const res = box.querySelector('[data-q="res"]');
    box.querySelector('[data-q="check"]').addEventListener('click', async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      res.innerHTML = '<p class="muted" style="margin-top:10px">Checking…</p>';
      try {
        const f = pb.querySelector('form');
        const typed = f && f.elements.title && f.elements.description ? { title: f.elements.title.value, description: f.elements.description.value } : null;
        const issues = await runChecks(typed);
        const open = issues.filter((i) => !i.ignored).length;
        const off = issues.length - open;
        if (!open) res.innerHTML = `<div class="note" style="margin-top:12px">${icon('check')} No problems found on this page.${off ? ` (${off} ignored)` : ''}</div>`;
        else { res.innerHTML = ''; await openReport(issues, 'check'); }
      } catch (err) {
        res.innerHTML = `<div class="note" style="margin-top:12px">The check didn’t finish: ${esc(err.message)}</div>`;
      } finally { b.disabled = false; }
    });
  });

  /* ================================================================ edit as form */
  const sigOf = (e) => `${e.tagName}|${[...e.classList].filter((c) => !/^(is-|has-|active|open)/.test(c)).sort().join('.')}`;
  const childSigs = (e) => new Set([...e.children].map(sigOf));
  /** Siblings that look like the same kind of thing (same tag and classes, mostly the same parts). */
  function likePeers(x) {
    const p = x.parentElement;
    if (!p) return false;
    const s = sigOf(x);
    const mine = childSigs(x);
    for (const c of p.children) {
      if (c === x || sigOf(c) !== s) continue;
      const theirs = childSigs(c);
      const both = [...mine].filter((k) => theirs.has(k)).length;
      const any = new Set([...mine, ...theirs]).size;
      if (!any || both / any >= 0.5) return true;
    }
    return false;
  }
  /** The repeated item worth a form: a list item, a row, or a card among cards (not half of a card). */
  function formItemFor(item) {
    let cur = item;
    for (let n = 0; cur && n < 8; n++) {
      if (/^(TD|TH)$/.test(cur.tagName) && cur.parentElement?.tagName === 'TR') return cur.parentElement;  // a cell: edit its row
      if (/^(LI|TR)$/.test(cur.tagName) || likePeers(cur)) return cur;
      const up = cur.parentElement ? core.itemFor(cur.parentElement) : null;
      if (!up || up === cur) break;
      cur = up;
    }
    return item;
  }
  const worthForm = (item) => /^(LI|TR)$/.test(item.tagName) || item.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,img,dd,td,th,figcaption,blockquote,summary').length >= 2;

  function peersOf(item) {
    const region = core.regionOf(item);
    if (!region || !item.parentElement) return [item];
    const s = sigOf(item);
    const ps = sigOf(item.parentElement);
    const list = [...region.querySelectorAll(item.tagName)].filter((e) => sigOf(e) === s && e.parentElement && sigOf(e.parentElement) === ps && !core.locked(e) && core.regionOf(e) === region);
    return list.includes(item) ? list : [item];
  }
  const tokens = (el) => (typeof el.className === 'string' ? el.className : '').toLowerCase().split(/[\s_-]+/).filter(Boolean);
  const WORDS = {
    name: 'Name', title: 'Title', role: 'Role', job: 'Job title', position: 'Job title', bio: 'Bio', desc: 'Description', description: 'Description',
    detail: 'Details', details: 'Details', notes: 'Notes', note: 'Note', summary: 'Summary', lede: 'Intro', intro: 'Intro', excerpt: 'Summary',
    eyebrow: 'Small label', kicker: 'Small label', label: 'Label', price: 'Price', cost: 'Cost', date: 'Date', time: 'Time', duration: 'Duration',
    location: 'Location', caption: 'Caption', quote: 'Quote', author: 'Author', cite: 'Source', source: 'Source', idx: 'Number', num: 'Number',
    number: 'Number', step: 'Step', tag: 'Tag', flag: 'Tag', badge: 'Tag', email: 'Email', phone: 'Phone', subtitle: 'Subtitle', company: 'Company',
    org: 'Organization', btn: 'Button', button: 'Button', cta: 'Button', stat: 'Number', value: 'Value', term: 'Term',
  };
  const isPerson = (item) => tokens(item).some((t) => /^(member|person|people|team|staff|profile|bio|speaker|author)$/.test(t));
  function nounOf(item) {
    if (isPerson(item)) return 'person';
    if (item.tagName === 'TR') return 'row';
    if (item.tagName === 'LI' && !item.querySelector('h1,h2,h3,h4,h5,h6,img')) return 'list item';
    if (item.querySelector('h1,h2,h3,h4,h5,h6,img')) return 'card';
    return 'item';
  }
  function baseLabel(el, item) {
    const tag = el.tagName;
    if (tag === 'DD') { const dt = el.previousElementSibling; if (dt && dt.tagName === 'DT' && dt.textContent.trim()) return clip(dt.textContent, 30); }
    if (tag === 'TD' || tag === 'TH') {
      const table = el.closest('table');
      const th = table?.querySelector('thead tr')?.children[el.cellIndex];
      if (th && th !== el && th.textContent.trim()) return clip(th.textContent, 30);
    }
    for (const n of [el, el.parentElement !== item ? el.parentElement : null]) {
      if (!n) continue;
      const t = tokens(n).reverse().find((k) => WORDS[k]);
      if (t) return WORDS[t];
    }
    if (el.closest('details') && tag !== 'SUMMARY' && item.contains(el.closest('details'))) return isPerson(item) ? 'Bio' : 'Text shown when opened';
    if (/^H[1-6]$/.test(tag)) return 'Heading';
    if (tag === 'SUMMARY') return 'Show more label';
    if (tag === 'LI') return 'List item';
    if (tag === 'BLOCKQUOTE') return 'Quote';
    if (tag === 'FIGCAPTION') return 'Caption';
    if (tag === 'TIME') return 'Date';
    if (tag === 'CITE') return 'Source';
    if (tag === 'A') return /btn|button|cta/i.test(el.className) ? 'Button' : 'Link';
    if (tag === 'BUTTON') return 'Button';
    if (tag === 'TD' || tag === 'TH') return `Column ${el.cellIndex + 1}`;
    if (/^(SPAN|SMALL|STRONG|B|EM|LABEL)$/.test(tag)) return 'Label';
    return 'Text';
  }
  /** One field per text block, link and picture in the item, in page order. */
  function collectFields(item) {
    const blocks = [];
    for (const t of textNodes(item)) {
      if (core.locked(t.parentElement)) continue;
      const b = core.textBlockFor(t);
      if (b && (b === item || item.contains(b)) && !blocks.includes(b)) blocks.push(b);
    }
    const imgs = [...(item.tagName === 'IMG' ? [item] : item.querySelectorAll('img'))].filter((i) => !core.locked(i));
    const links = [...item.querySelectorAll('a'), ...(item.tagName === 'A' ? [item] : [])].filter((a) => !core.locked(a));
    const things = [...blocks, ...imgs];
    const covered = new Set();
    for (const b of blocks) {
      const a = b.tagName === 'A' ? b : core.linkOf(b);
      if (a && (a === b || b.contains(a)) && a.textContent.trim() === b.textContent.trim()) covered.add(a);
      b.querySelectorAll('a').forEach((x) => covered.add(x));
    }
    for (const a of links) if (!covered.has(a) && !things.includes(a)) things.push(a);
    things.sort(before);
    const fields = [];
    for (const el of things) {
      if (el.tagName === 'IMG') { fields.push({ kind: 'image', el }); continue; }
      if (!blocks.includes(el)) { fields.push({ kind: 'href', el, a: el, label: el === item || el.contains(item) ? `Where the ${nounOf(item)} goes` : `Link “${clip(nameOf(el), 30)}” goes to` }); continue; }
      if (el.tagName === 'DT' && el.nextElementSibling?.tagName === 'DD') continue;  // shown as the label of its value
      const a = el.tagName === 'A' ? el : core.linkOf(el);
      if (a && (a === el || el.contains(a)) && a.textContent.trim() === el.textContent.trim()) { fields.push({ kind: 'link', el, a }); continue; }
      const plain = [...el.childNodes].every((n) => n.nodeType !== 1 || n.tagName === 'BR');
      const multi = /^(P|BLOCKQUOTE|FIGCAPTION)$/.test(el.tagName) || (/^(LI|DD|TD|DIV|ARTICLE|SECTION)$/.test(el.tagName) && (el.textContent.trim().length > 60 || Boolean(el.querySelector('br'))));
      const field = { kind: plain ? 'text' : 'rich', el, multi };
      fields.push(field);
      if (!plain) el.querySelectorAll('a').forEach((x, k) => { if (!core.locked(x)) fields.push({ kind: 'href', el: x, a: x, rich: field, k, label: `Link “${clip(nameOf(x), 30)}” goes to` }); });
    }
    // Labels: from the class, the tag or the position; numbered when they repeat.
    const counts = {};
    let firstHeading = 0;
    for (const f of fields) {
      if (f.label) continue;
      if (f.kind === 'image') f.label = 'Picture';
      else {
        let l = baseLabel(f.kind === 'link' && f.el !== f.a ? f.el : f.a || f.el, item);
        if (l === 'Text' || l === 'Label' || l === 'List item') l = baseLabel(f.el, item);
        if (l === 'Heading' && /^H[1-6]$/.test(f.el.tagName)) { const lvl = +f.el.tagName[1]; if (!firstHeading) firstHeading = lvl; else if (lvl > firstHeading) l = 'Subheading'; }
        if (f.kind === 'link' && /^(Text|Label|List item)$/.test(l)) l = f.el.tagName === 'LI' ? 'List item' : 'Link';
        f.label = l;
      }
    }
    // Short named details (a role, a date, a price) get one line even when they're paragraphs.
    const SHORT = /^(Name|Role|Job title|Title|Date|Time|Price|Cost|Location|Number|Tag|Email|Phone|Duration|Small label|Label|Subtitle|Company|Organization|Value|Term)$/;
    for (const f of fields) if (f.kind === 'text' && f.multi && SHORT.test(f.label) && f.el.textContent.trim().length < 80 && !f.el.querySelector('br')) f.multi = false;
    for (const f of fields) counts[f.label] = (counts[f.label] || 0) + 1;
    const seen = {};
    for (const f of fields) if (counts[f.label] > 1 && f.kind !== 'href') { seen[f.label] = (seen[f.label] || 0) + 1; f.label = `${f.label} ${seen[f.label]}`; }
    return fields;
  }

  function readPlain(el) {
    let s = '';
    const walk = (node) => {
      for (const n of node.childNodes) {
        if (n.nodeType === 3) s += n.data.replace(/[ \t\r\n\f]+/g, ' ');
        else if (n.nodeType === 1 && n.tagName === 'BR') s += '\n';
        else if (n.nodeType === 1 && !/^(svg|SVG|SCRIPT|STYLE)$/.test(n.tagName)) walk(n);
      }
    };
    walk(el);
    return s.split('\n').map((l) => l.replace(/^ +| +$/g, '')).join('\n').trim();
  }
  function writePlain(el, value) {
    const simple = [...el.childNodes].every((n) => n.nodeType === 3 || n.nodeType === 8 || (n.nodeType === 1 && n.tagName === 'BR'));
    if (simple) {
      const parts = [];
      value.split('\n').forEach((line, i) => { if (i) parts.push(d.createElement('br')); parts.push(d.createTextNode(line)); });
      el.replaceChildren(...parts);
      return;
    }
    // Keep icons and other small parts: the words go in the first piece of text.
    const texts = textNodes(el);
    if (!texts.length) { el.prepend(d.createTextNode(value.replace(/\n/g, ' '))); return; }
    const m = /^(\s*)[\s\S]*?(\s*)$/.exec(texts[0].data);
    texts[0].data = m[1] + value.replace(/\n/g, ' ') + m[2];
    texts.slice(1).forEach((t) => { t.data = ''; });
  }
  /** Copies page markup into the form (or back), removing anything that could run code. */
  function scrubbed(source) {
    const tpl = d.createElement('template');
    tpl.innerHTML = source;
    tpl.content.querySelectorAll('script,style,iframe,object,embed,link,meta,base,form,input,textarea,select').forEach((n) => n.remove());
    tpl.content.querySelectorAll('*').forEach((n) => {
      for (const a of [...n.attributes]) {
        const k = a.name.toLowerCase();
        if (k.startsWith('on') || k === 'contenteditable' || k === 'spellcheck' || k === 'srcdoc' || k.startsWith('data-editlayer') || ((k === 'href' || k === 'src' || k === 'xlink:href') && badHref(a.value))) n.removeAttribute(a.name);
      }
    });
    return tpl;
  }

  let form = null;  // { item, fields, pb, dirty, pending: Map(index → chosen image) }

  function fieldHtml(f, i) {
    const id = `qf${i}`;
    if (f.kind === 'image') {
      const src = f.el.currentSrc || f.el.src || '';
      return `<div class="field qimgf"><span class="qlab" id="${id}l">${esc(f.label)}</span><div class="qimg"><img alt="" src="${esc(src)}" data-thumb="${i}">
        <button class="btn" type="button" data-q="img" data-i="${i}">${icon('image')}Replace</button></div>
        <label class="qsub" for="${id}">Description, for screen readers and Google</label><input id="${id}" type="text" maxlength="250" value="${esc(f.el.getAttribute('alt') || '')}" placeholder="What the picture shows"></div>`;
    }
    if (f.kind === 'link') {
      return `<div class="field qgrp"><span class="qlab">${esc(f.label)}</span>
        <label class="qsub" for="${id}">Words</label><input id="${id}" type="text" value="${esc(readPlain(f.a))}">
        <label class="qsub" for="${id}h">Goes to</label><input id="${id}h" type="text" list="qpages" autocomplete="off" value="${esc(f.a.getAttribute('href') || '')}" placeholder="/contact/ or https://…"></div>`;
    }
    if (f.kind === 'href') {
      return `<div class="field qgrp qhref"><label class="qsub" for="${id}h">${esc(f.label)}</label><input id="${id}h" type="text" list="qpages" autocomplete="off" value="${esc(f.a.getAttribute('href') || '')}" placeholder="/contact/ or https://…"></div>`;
    }
    if (f.kind === 'rich') {
      return `<div class="field"><span class="qlab" id="${id}l">${esc(f.label)}</span><div class="qrich${f.multi ? '' : ' one'}" id="${id}" contenteditable="true" role="textbox" aria-multiline="${f.multi}" aria-labelledby="${id}l" spellcheck="true"></div></div>`;
    }
    const v = readPlain(f.el);
    return `<div class="field"><label for="${id}">${esc(f.label)}</label>${f.multi || v.includes('\n')
      ? `<textarea id="${id}" rows="${Math.min(10, Math.max(2, Math.ceil(v.length / 42)))}" spellcheck="true">${esc(v)}</textarea>`
      : `<input id="${id}" type="text" value="${esc(v)}" spellcheck="true">`}</div>`;
  }

  /** Opens the form for an item (saving what was typed in the form that was open before). */
  let queued = null;
  function openForm(item, opts = {}) {
    if (form && form.dirty) applyForm(form);
    if (form && form.pb.isConnected && R.panel.classList.contains('show')) return renderForm(item, opts);
    queued = [item, opts];
    core.closePanel();
    core.togglePanel('qform');
    return R.panel.querySelector('.pb');
  }
  core.addPanel('qform', () => { if (queued) renderForm(...queued); queued = null; });
  function renderForm(item, { fresh = false } = {}) {
    const fields = collectFields(item);
    const peers = peersOf(item);
    const at = peers.indexOf(item);
    const noun = nounOf(item);
    const heading = item.querySelector('h1,h2,h3,h4,h5,h6');
    const name = clip(heading ? heading.textContent : (fields.find((f) => f.kind === 'text' || f.kind === 'link' || f.kind === 'rich')?.el.textContent || ''), 70);
    const pb = core.openPanel(`Edit ${noun}`, `<div class="qform">
      <div class="qtop"><span class="grow"><b>${esc(name || `This ${noun}`)}</b><span>${peers.length > 1 ? `${at + 1} of ${peers.length}` : ''}</span></span>
        <button class="ib" type="button" data-q="prev" title="Previous ${noun}" aria-label="Previous ${noun}" ${at <= 0 ? 'disabled' : ''}>${icon('left')}</button>
        <button class="ib" type="button" data-q="next" title="Next ${noun}" aria-label="Next ${noun}" ${at < 0 || at >= peers.length - 1 ? 'disabled' : ''}>${icon('right')}</button></div>
      ${fresh ? `<div class="note">This new ${noun} is a copy of the one before it. Type over the copied details.</div>` : `<p>Change the details, then press Save. Undo with Ctrl+Z.</p>`}
      <form novalidate>${fields.length ? fields.map(fieldHtml).join('') : '<p class="note">There’s nothing to fill in here.</p>'}
      <datalist id="qpages"></datalist>
      <p class="qerr" role="alert" hidden></p>
      <div class="qfoot"><button class="btn primary" type="submit" disabled>Save</button>
        <button class="btn" type="button" data-q="dup" title="Add a copy below and fill it in">${icon('plus')}<span>Add another like this</span></button>
        <span class="grow"></span><button class="ib danger" type="button" data-q="del" title="Delete this ${noun}" aria-label="Delete this ${noun}">${icon('trash')}</button></div></form></div>`);
    form = { item, fields, pb, dirty: false, pending: new Map(), peers, at, noun, loc: placeOf(item) };
    const st = form;
    fields.forEach((f, i) => {
      f.input = pb.querySelector(`#qf${i}`);
      f.hrefInput = pb.querySelector(`#qf${i}h`);
      if (f.kind === 'rich') {
        f.input.append(scrubbed(f.el.innerHTML).content);
        f.start = f.input.innerHTML;
      } else if (f.input) f.start = f.input.value;
      if (f.hrefInput) f.hrefStart = f.hrefInput.value;
    });
    core.sitePages().then((pages) => { const dl = pb.querySelector('#qpages'); if (dl) dl.innerHTML = pages.map((p) => `<option value="${esc(p.path)}">`).join(''); }).catch(() => {});
    const save = pb.querySelector('button[type="submit"]');
    const touch = () => { st.dirty = true; save.disabled = false; };
    pb.addEventListener('input', touch);
    pb.addEventListener('submit', (e) => { e.preventDefault(); if (applyForm(st)) { core.toast('Saved. Press Ctrl+Z to undo.'); reopen(st.item); } });
    pb.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key.toLowerCase() === 's' || e.key === 'Enter')) { e.preventDefault(); pb.querySelector('form').requestSubmit(); return; }
      const rich = e.target.closest?.('.qrich');
      if (rich && e.key === 'Enter') { e.preventDefault(); if (rich.classList.contains('one')) return; d.execCommand('insertLineBreak'); }
    });
    pb.addEventListener('paste', (e) => {
      if (!e.target.closest?.('.qrich')) return;
      e.preventDefault();
      d.execCommand('insertText', false, (e.clipboardData?.getData('text/plain') || '').replace(/\s*\r?\n\s*/g, ' '));
    });
    pb.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-q]');
      if (!b) { const lab = e.target.closest('.qlab'); if (lab) pb.querySelector(`[aria-labelledby="${lab.id}"]`)?.focus(); return; }
      const q = b.dataset.q;
      if (!alive(st)) return;
      if (q === 'prev' || q === 'next') {
        if (st.dirty && !applyForm(st)) return;
        const list = peersOf(st.item);
        const next = list[list.indexOf(st.item) + (q === 'next' ? 1 : -1)];
        if (next) showItem(next);
      }
      if (q === 'img') {
        const f = st.fields[+b.dataset.i];
        const shown = f.el.getBoundingClientRect().width || 800;
        const chosen = await core.pickImage({ current: f.el.currentSrc || f.el.src, alt: f.input.value, maxW: Math.min(2400, Math.max(1000, Math.round(shown * 2))), title: 'Replace picture', withAlt: false });
        if (!chosen || !st.pb.isConnected) return;
        st.pending.set(+b.dataset.i, chosen);
        const th = pb.querySelector(`[data-thumb="${b.dataset.i}"]`);
        if (th) th.src = chosen.url;
        touch();
      }
      if (q === 'dup') duplicate(st);
      if (q === 'del') remove(st);
    });
    showItem(item, true);
    if (fresh) {
      setTimeout(() => {
        const first = pb.querySelector('.qform .field:not(.qimgf) input[type="text"], .qform .field:not(.qimgf) textarea, .qform .qrich');
        if (!first) return;
        first.focus();
        if (first.select) first.select();
        else { const r = d.createRange(); r.selectNodeContents(first); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
      }, 30);
    }
    return pb;
  }
  function reopen(item) {
    const top = R.panel.querySelector('.pb')?.scrollTop || 0;
    openForm(item);
    const pb = R.panel.querySelector('.pb');
    if (pb) pb.scrollTop = top;
  }
  function showItem(item, selectOnly = false) {
    if (!selectOnly) { openForm(item); return; }
    core.select({ type: 'item', el: item });
    const r = item.getBoundingClientRect();
    const roomTop = mobile() ? innerHeight * 0.28 : innerHeight;
    const roomRight = mobile() ? innerWidth : innerWidth - 420;
    if (r.top < 70 || r.bottom > roomTop || r.left > roomRight) item.scrollIntoView({ block: mobile() ? 'start' : 'center', behavior: 'smooth' });
  }
  function showError(st, msg, input) {
    const p = st.pb.querySelector('.qerr');
    if (p) { p.textContent = msg; p.hidden = false; }
    input?.focus();
  }

  /** Where the item sits in its region, so it can be found again after Undo or Redo rebuilds the page. */
  function placeOf(item) {
    const region = core.regionOf(item);
    const path = [];
    for (let n = item; n && n !== region && n.parentElement; n = n.parentElement) path.unshift([...n.parentElement.children].indexOf(n));
    return { key: region ? core.keyOf(region) : '', path, sig: sigOf(item) };
  }
  function findPlace(loc) {
    let n = loc.key ? core.regionByKey(loc.key) : null;
    for (const i of loc.path) { n = n ? n.children[i] : null; if (!n) return null; }
    return n && sigOf(n) === loc.sig ? n : null;
  }
  /** True when the form still points at the page. After Undo/Redo it re-attaches to the rebuilt item. */
  function alive(st) {
    if (st.item.isConnected) return true;
    const el = findPlace(st.loc);
    const fresh = el ? collectFields(el) : null;
    if (fresh && fresh.length === st.fields.length && fresh.every((f, i) => f.kind === st.fields[i].kind)) {
      st.item = el;
      fresh.forEach((f, i) => { st.fields[i].el = f.el; st.fields[i].a = f.a; });
      return true;
    }
    if (el && !st.dirty) { reopen(el); return false; }
    core.toast('This part of the page changed, so the form couldn’t save. Open it again.', true);
    st.dirty = false;
    return false;
  }

  /** Writes the form into the page as one undo step. Returns false (and says why) if it can't. */
  function applyForm(st) {
    if (!st.item.isConnected && !alive(st)) return false;
    for (const f of st.fields) {
      if (!f.hrefInput) continue;
      const v = f.hrefInput.value.trim();
      if (!v && f.hrefStart) { showError(st, 'Add where the link goes, or delete the link on the page.', f.hrefInput); return false; }
      if (badHref(v)) { showError(st, 'That kind of link isn’t allowed. Use a page like /contact/ or a web address starting with https://.', f.hrefInput); return false; }
    }
    const region = core.regionOf(st.item);
    core.mutate(region, () => {
      st.fields.forEach((f, i) => {
        if (f.kind === 'image') {
          const chosen = st.pending.get(i);
          const img = f.el;
          if (chosen) {
            img.src = chosen.url;
            img.removeAttribute('srcset');
            img.removeAttribute('sizes');
            img.closest('picture')?.querySelectorAll('source').forEach((s) => s.remove());
            if (chosen.w && chosen.h) {
              if (img.hasAttribute('width')) img.setAttribute('width', chosen.w);
              if (img.hasAttribute('height')) img.setAttribute('height', chosen.h);
            }
          }
          if (f.input.value !== f.start || chosen) img.setAttribute('alt', f.input.value.trim());
          return;
        }
        const hrefChanged = (x) => x.hrefInput && x.hrefInput.value.trim() !== x.hrefStart.trim();
        if (f.kind === 'href' && f.rich && f.rich.written) return;  // already set inside the rewritten text
        if (hrefChanged(f)) f.a.setAttribute('href', f.hrefInput.value.trim());
        if (f.kind === 'href' || !f.input) return;
        if (f.kind === 'rich') {
          f.written = false;
          if (f.input.innerHTML === f.start) return;
          const tpl = scrubbed(f.input.innerHTML);
          // The links in this text are rewritten too: give them their new addresses from the form.
          const links = tpl.content.querySelectorAll('a');
          st.fields.forEach((x) => { if (x.rich === f && hrefChanged(x) && links[x.k]) links[x.k].setAttribute('href', x.hrefInput.value.trim()); });
          f.el.replaceChildren(tpl.content);
          f.el.normalize();
          f.written = true;
          return;
        }
        if (f.input.value === f.start) return;
        writePlain(f.kind === 'link' ? f.a : f.el, f.input.value.replace(/\r/g, '').trim());
      });
    });
    st.dirty = false;
    st.pending.clear();
    return true;
  }

  function uniqueIds(clone) {
    const nodes = [clone, ...clone.querySelectorAll('[id]')].filter((n) => n.id);
    const map = {};
    for (const n of nodes) {
      let k = 2;
      while (d.getElementById(`${n.id}-${k}`) || Object.values(map).includes(`${n.id}-${k}`)) k++;
      map[n.id] = `${n.id}-${k}`;
      n.id = map[n.id];
    }
    if (!Object.keys(map).length) return;
    for (const n of [clone, ...clone.querySelectorAll('*')]) {
      for (const attr of ['for', 'aria-labelledby', 'aria-describedby', 'aria-controls']) {
        const v = n.getAttribute(attr);
        if (v) n.setAttribute(attr, v.split(/\s+/).map((x) => map[x] || x).join(' '));
      }
      const h = n.getAttribute('href');
      if (h && h.startsWith('#') && map[h.slice(1)]) n.setAttribute('href', `#${map[h.slice(1)]}`);
    }
  }
  function duplicate(st) {
    if (st.dirty && !applyForm(st)) return;
    if (!st.item.isConnected) return;
    const region = core.regionOf(st.item);
    const clone = st.item.cloneNode(true);
    uniqueIds(clone);
    core.mutate(region, () => st.item.after(clone));
    core.openDetails();
    openForm(clone, { fresh: true });
    core.toast('Copy added. Type over its details, then press Save.');
  }
  function remove(st) {
    if (!st.item.isConnected) return;
    if (!confirm(`Delete this ${st.noun}? You can undo with Ctrl+Z.`)) return;
    const list = peersOf(st.item);
    const i = list.indexOf(st.item);
    const next = list[i + 1] || list[i - 1];
    st.dirty = false;
    core.mutate(core.regionOf(st.item), () => st.item.remove());
    core.toast('Deleted. Press Ctrl+Z to undo.');
    if (next && next.isConnected) openForm(next);
    else { form = null; core.closePanel(); core.select(null); }
  }

  // Changes typed into the form are never lost: closing it (or opening another panel) saves them.
  new MutationObserver(() => {
    if (!form) return;
    const st = form;
    if (st.pb.isConnected && R.panel.classList.contains('show')) return;
    form = null;
    if (st.dirty && applyForm(st)) core.toast('Your changes from the form were saved. Press Ctrl+Z to undo.');
  }).observe(R.panel, { attributes: true, attributeFilter: ['class'], childList: true });
  // Undo and Redo replace the page's content: keep the open form in step with it.
  function refreshForm() {
    if (!form || form.item.isConnected) return;
    const st = form;
    if (!findPlace(st.loc)) { if (!st.dirty) { form = null; core.closePanel(); } return; }
    if (alive(st) && !st.dirty && st.pb.isConnected) reopen(st.item);  // show what the page says now
  }
  core.on('saved', refreshForm);
  R.bar.addEventListener('click', (e) => { if (/^(undo|redo)$/.test(e.target.closest('[data-act]')?.dataset.act || '')) setTimeout(refreshForm, 0); });
  d.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && /^[zy]$/i.test(e.key)) setTimeout(refreshForm, 0); });

  core.addToolAction({
    act: 'q-form',
    icon: 'form',
    text: 'Edit as form',
    title: 'Edit as form: every text, link and picture in this item, in one place',
    order: 40,
    when: (sel, { item }) => Boolean(item) && worthForm(formItemFor(item)),
    run: (sel, { item }) => { core.finishEdit(); openForm(formItemFor(item)); },
  });
});
