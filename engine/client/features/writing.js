feature('writing', (core) => {
  const { S, d, R, esc, icon } = core;
  const cfg = (S.features && S.features.writing) || {};
  const maxChars = cfg.maxChars || 2000;

  core.addIcons({
    sparkle: '<path d="M12 3.5l1.9 4.6 4.6 1.9-4.6 1.9L12 16.5l-1.9-4.6L5.5 10l4.6-1.9z"/><path d="M18.5 15.5l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>',
  });

  /* ================================================================ writing help (Rewrite) */
  const MODES = [
    ['fix', 'Fix spelling and grammar'],
    ['shorter', 'Make it shorter'],
    ['clearer', 'Make it clearer'],
    ['friendlier', 'Make it friendlier'],
    ['formal', 'Make it more formal'],
  ];
  const modeName = (m) => (MODES.find((x) => x[0] === m) || [m, m])[1];

  const kindOf = (el) => {
    const t = el.tagName;
    if (/^H[1-6]$/.test(t)) return 'heading';
    if (t === 'A' || t === 'BUTTON' || el.closest('a,button')) return 'button';
    if (t === 'LI') return 'list item';
    if (t === 'P' || t === 'BLOCKQUOTE') return 'paragraph';
    return 'text';
  };
  const pageName = () => (d.title || '').split(/\s+[|–—]\s+/)[0].trim().slice(0, 120);
  const plainBlock = (el) => ![...el.childNodes].some((n) => n.nodeType === 1);

  // Character offsets inside el, so the target survives the DOM tidying that ending an edit does.
  function offsetIn(el, node, off) {
    const r = d.createRange();
    r.selectNodeContents(el);
    r.setEnd(node, off);
    return r.toString().length;
  }
  function rangeAt(el, start, end) {
    const walker = d.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let pos = 0;
    let s = null;
    let e = null;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const len = n.nodeValue.length;
      // Start at the beginning of the next node and end at the end of the previous one, so a
      // selection of a bold word stays inside the bold element.
      if (!s && start < pos + len) s = [n, start - pos];
      if (!e && end <= pos + len && end > pos) e = [n, end - pos];
      pos += len;
    }
    if (!s || !e) return null;
    const r = d.createRange();
    r.setStart(s[0], s[1]);
    r.setEnd(e[0], e[1]);
    return r;
  }

  /** What Rewrite would change: the selected words, or the whole block when it is plain text. */
  function targetFor(el) {
    const s = getSelection();
    const r = s.rangeCount ? s.getRangeAt(0) : null;
    if (r && !r.collapsed && el.contains(r.commonAncestorContainer)) {
      if (r.cloneContents().querySelector('*')) return { problem: 'mixed' };
      const raw = r.toString();
      if (/\S/.test(raw)) {
        const all = el.textContent;
        let start = offsetIn(el, r.startContainer, r.startOffset);
        let end = offsetIn(el, r.endContainer, r.endOffset);
        start += raw.length - raw.trimStart().length;
        end -= raw.length - raw.trimEnd().length;
        // A selection that starts or ends inside a word takes the whole word.
        // (Only when the widened words are still plain text, not part of a link or bold word.)
        const word = (ch) => /[\p{L}\p{N}'’-]/u.test(ch || '');
        let s1 = start;
        let e1 = end;
        while (s1 > 0 && word(all[s1 - 1]) && word(all[s1])) s1--;
        while (e1 < all.length && word(all[e1]) && word(all[e1 - 1])) e1++;
        const wide = rangeAt(el, s1, e1);
        if (wide && !wide.cloneContents().querySelector('*') && wide.toString() === all.slice(s1, e1)) { start = s1; end = e1; }
        return { whole: false, start, end, raw: all.slice(start, end) };
      }
    }
    if (!plainBlock(el)) return { problem: 'markup' };
    return { whole: true, raw: el.textContent };
  }

  let ticket = 0;
  let current = null; // { el, target, mode, text, warnings }

  function popShell(inner) {
    return `<form class="wr-pop">${inner}</form>`;
  }
  function focusFirst(sel = 'button') {
    setTimeout(() => R.pop.querySelector(sel)?.focus(), 0);
  }
  R.pop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && R.pop.querySelector('.wr-pop')) { e.preventDefault(); e.stopPropagation(); cancel(); }
  });
  function cancel() {
    ticket++;
    core.closePop();
    if (current && current.el.isConnected && core.editing === current.el) current.el.focus({ preventScroll: true });
    current = null;
  }

  function openRewrite(el) {
    const target = targetFor(el);
    if (target.problem) {
      const msg = target.problem === 'mixed'
        ? 'Your selection includes a link or bold words. Select words inside one stretch of plain text, then press Rewrite.'
        : 'This text has links or bold words, so it can’t be rewritten in one go (they would be lost). Select the words you want to change, then press Rewrite.';
      core.showPop(el, popShell(`<p class="wr-h">${icon('sparkle')}Writing help</p><p class="wr-msg">${esc(msg)}</p>
        <div class="row end"><button class="btn primary" type="button" data-close>OK</button></div>`), () => {});
      focusFirst();
      return;
    }
    const text = target.raw.replace(/\s+/g, ' ').trim();
    if (text.length > maxChars) {
      core.showPop(el, popShell(`<p class="wr-h">${icon('sparkle')}Writing help</p><p class="wr-msg">This text is ${text.length.toLocaleString()} characters long. Writing help works on up to ${maxChars.toLocaleString()} at a time: select a part of it, then press Rewrite.</p>
        <div class="row end"><button class="btn primary" type="button" data-close>OK</button></div>`), () => {});
      focusFirst();
      return;
    }
    current = { el, target, text };
    if (!target.whole) {
      // Show exactly what will be rewritten (a selection inside a word was widened to whole words).
      const r = rangeAt(el, target.start, target.end);
      if (r) { const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
    }
    chooseMode();
  }

  function chooseMode() {
    const { el, target } = current;
    core.showPop(el, popShell(`<p class="wr-h">${icon('sparkle')}Writing help <span class="muted">${target.whole ? 'this text' : 'the selected words'}</span></p>
      <div class="wr-modes" role="group" aria-label="What to do">${MODES.map(([m, t]) => `<button class="wr-mode" type="submit" value="${m}">${esc(t)}</button>`).join('')}</div>
      <p class="muted wr-fine">You’ll see the suggestion before anything changes. Facts, names and numbers are meant to stay as they are, but check before you use it.</p>
      <div class="row end"><button class="btn" type="button" data-close>Cancel</button></div>`), (fd, mode) => { if (mode) ask(mode); });
    R.pop.querySelector('[data-close]')?.addEventListener('click', cancel);
    focusFirst('.wr-mode');
  }

  async function ask(mode, again = false) {
    const my = ++ticket;
    const { el, text } = current;
    current.mode = mode;
    core.showPop(el, popShell(`<p class="wr-h">${icon('sparkle')}${esc(modeName(mode))}</p>
      <div class="wr-load" role="status"><i class="wr-spin" aria-hidden="true"></i>Writing a suggestion…</div>
      <div class="row end"><button class="btn" type="button" data-close>Cancel</button></div>`), () => {});
    R.pop.querySelector('[data-close]')?.addEventListener('click', cancel);
    focusFirst();
    // The editor may have closed the popover meanwhile (clicked other text, pressed Escape): then drop the answer.
    const waiting = () => my === ticket && current && R.pop.classList.contains('show') && R.pop.querySelector('.wr-load');
    let r;
    try {
      r = await core.api('POST', 'writing/rewrite', { text, mode, again, context: { kind: kindOf(el), page: pageName(), part: !current.target.whole } });
    } catch (err) {
      if (!waiting()) return;
      core.showPop(el, popShell(`<p class="wr-h">${icon('sparkle')}${esc(modeName(mode))}</p><p class="wr-msg">${esc(err.message)}</p>
        <div class="row end"><button class="btn" type="button" data-close>Close</button><button class="btn primary" type="submit" value="again">Try again</button></div>`),
      (fd, how) => { if (how === 'again') ask(mode, true); });
      R.pop.querySelector('[data-close]')?.addEventListener('click', cancel);
      focusFirst('[value="again"]');
      return;
    }
    if (!waiting()) return;
    current.suggestion = r.text;
    const warn = [];
    if ((r.warnings || []).includes('numbers')) warn.push('the numbers differ from your text');
    if ((r.warnings || []).includes('addresses')) warn.push('an email or web address differs from your text');
    core.showPop(el, popShell(`<div class="wr-h">${icon('sparkle')}<span>${esc(modeName(mode))}</span><button class="wr-link" type="button" data-other>Other options</button></div>
      <div class="wr-sugg" tabindex="0" aria-label="Suggestion">${esc(r.text)}</div>
      ${r.changed ? '' : '<p class="muted wr-fine">No changes needed: this is the same as your text.</p>'}
      ${warn.length ? `<p class="wr-warn">Check this: ${esc(warn.join(', and '))}.</p>` : ''}
      <div class="row end"><button class="btn" type="button" data-close>Cancel</button><button class="btn" type="submit" value="again">Try again</button><button class="btn primary" type="submit" value="use" ${r.changed ? '' : 'disabled'}>Use it</button></div>`),
    (fd, how) => { if (how === 'again') ask(mode, true); if (how === 'use') use(); });
    R.pop.querySelector('[data-close]')?.addEventListener('click', cancel);
    R.pop.querySelector('[data-other]')?.addEventListener('click', chooseMode);
    focusFirst(r.changed ? '[value="use"]' : '[value="again"]');
  }

  function use() {
    const { el, target, suggestion } = current;
    current = null;
    core.closePop();
    if (!el.isConnected) { core.toast('That text is no longer on the page.', true); return; }
    const region = core.regionOf(el);
    let ok = true;
    core.mutate(region, () => {
      if (target.whole) {
        if (el.textContent !== target.raw) { ok = false; return; }
        el.textContent = suggestion;
        return;
      }
      const r = rangeAt(el, target.start, target.end);
      if (!r || r.toString() !== target.raw) { ok = false; return; }
      r.deleteContents();
      r.insertNode(d.createTextNode(suggestion));
      el.normalize();
    });
    core.select({ type: 'text', el });
    core.startEdit(el, null);
    core.toast(ok ? 'Text replaced. Press Ctrl+Z to undo.' : 'The text changed while the suggestion was being written. Press Rewrite again.', !ok);
  }

  if (cfg.ai) {
    core.addToolAction({
      act: 'w-rewrite', icon: 'sparkle', text: 'Rewrite', cls: 'wr-tb', order: 60,
      title: 'Writing help: fix or rewrite this text (or only the selected words)',
      when: (sel, { editing }) => sel.type === 'text' && editing,
      run: (sel) => openRewrite(sel.el),
    });
  }

  /* ================================================================ find and replace */
  const SKIP = 'script,style,noscript,template,textarea,svg,[data-cms-lock]';
  const fs = { q: '', rep: '', matchCase: false, whole: false, meta: true, phase: 'idle', results: null, progress: [0, 0], done: null, undo: null, busy: false };
  let pb = null;

  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function makeRx({ q, matchCase, whole }) {
    let src = [...q.trim()].map((ch) => {
      if (/\s/.test(ch)) return '\\s+';
      if (/['‘’]/.test(ch)) return '[\'‘’]';
      if (/["“”]/.test(ch)) return '["“”]';
      return reEsc(ch);
    }).join('').replace(/(\\s\+)+/g, '\\s+');
    if (whole) src = `(?<![\\p{L}\\p{N}_])(?:${src})(?![\\p{L}\\p{N}_])`;
    return new RegExp(src, `gu${matchCase ? '' : 'i'}`);
  }
  /** Without "Match case", capitals follow the original: "Bakery" → "Café", "bakery" → "café". */
  function withCase(match, rep, matchCase) {
    if (matchCase || !rep) return rep;
    const letters = match.replace(/[^\p{L}]/gu, '');
    if (letters.length > 1 && letters === letters.toUpperCase() && letters !== letters.toLowerCase() && rep === rep.toLowerCase()) return rep.toUpperCase();
    const m0 = match.match(/\p{L}/u)?.[0];
    const r0 = rep.match(/\p{L}/u)?.[0];
    if (m0 && r0 && m0 !== m0.toLowerCase() && r0 === r0.toLowerCase()) { const i = rep.indexOf(r0); return rep.slice(0, i) + r0.toUpperCase() + rep.slice(i + 1); }
    return rep;
  }
  const squash = (s) => s.replace(/\s+/g, ' ');
  function snippet(text, index, len) {
    const before = squash(text.slice(Math.max(0, index - 48), index)).trimStart();
    const after = squash(text.slice(index + len, index + len + 48)).trimEnd();
    return `${index > 48 ? '…' : ''}${esc(before)}<mark>${esc(squash(text.slice(index, index + len)))}</mark>${esc(after)}${index + len + 48 < text.length ? '…' : ''}`;
  }

  /** Text nodes of a region that belong to it (not to a region nested inside it), with their matches. */
  function regionHits(region, rx) {
    const hits = [];
    const doc = region.ownerDocument;
    const walker = doc.createTreeWalker(region, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const p = n.parentElement;
      if (!p || p.closest('[data-cms]') !== region || p.closest(SKIP)) continue;
      const ms = [...n.nodeValue.matchAll(rx)];
      if (ms.length) hits.push({ node: n, ms });
    }
    return hits;
  }
  /** Page title, description and share title as visitors get them (saved settings win over the page). */
  function metaOf(doc, stored) {
    const tag = (sel) => doc.querySelector(sel)?.getAttribute('content') || '';
    return {
      title: stored.title || (doc.querySelector('title')?.textContent || '').trim(),
      description: stored.description || tag('meta[name="description"]'),
      shareTitle: stored.shareTitle || tag('meta[property="og:title"]'),
    };
  }
  const META_LABEL = { title: 'Page title', description: 'Description', shareTitle: 'Share title' };

  function regionLabel(region) {
    const key = region.getAttribute('data-cms');
    if (key === '@footer') return ['Footer', 'Shown on every page'];
    if (key === '@header') return ['Header', 'Shown on every page'];
    const h = region.querySelector('h1,h2,h3,h4')?.textContent.trim().replace(/\s+/g, ' ');
    return [h ? `Shared section: ${h.slice(0, 60)}` : 'Shared section', 'Shown on every page that uses it'];
  }
  const pageTitle = (doc, path) => (path === '/' ? 'Home' : ((doc.querySelector('title')?.textContent || '').split(/\s+[|–—]\s+/)[0].trim() || path));

  /** Scans one document. Returns { page: {count, snips}, site: Map key → {count, snips, label} }. */
  function scanDoc(doc, rx, storedMeta, withMeta) {
    const page = { count: 0, snips: [] };
    const site = new Map();
    for (const region of doc.querySelectorAll('[data-cms]')) {
      const key = region.getAttribute('data-cms');
      if (key.startsWith('@') && core.S.user.role === 'author') continue;  // authors change page content only
      const hits = regionHits(region, rx);
      if (!hits.length) continue;
      const target = key.startsWith('@') ? (site.get(key) || site.set(key, { count: 0, snips: [], label: regionLabel(region) }).get(key)) : page;
      for (const h of hits) for (const m of h.ms) {
        target.count++;
        if (target.snips.length < 4) target.snips.push(snippet(h.node.nodeValue, m.index, m[0].length));
      }
    }
    if (withMeta) {
      const meta = metaOf(doc, storedMeta);
      for (const k of Object.keys(META_LABEL)) {
        const ms = [...meta[k].matchAll(rx)];
        if (!ms.length) continue;
        page.count += ms.length;
        if (page.snips.length < 4) page.snips.push(`<b class="wr-mk">${META_LABEL[k]}:</b> ${snippet(meta[k], ms[0].index, ms[0][0].length)}`);
      }
    }
    return { page, site };
  }

  async function fetchDoc(path) {
    const url = new URL(path, location.origin);
    url.searchParams.set('edit', '');
    const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
    if (res.redirected && new URL(res.url).pathname.startsWith('/_cms/login')) throw new Error('Your session ended. Sign in again.');
    // A page that now redirects elsewhere is skipped: its text belongs to the page it points to.
    if (res.redirected && new URL(res.url).pathname !== url.pathname) return null;
    if (!res.ok) throw new Error(`The page didn’t load (error ${res.status}).`);
    if (!(res.headers.get('content-type') || '').includes('text/html')) return null;
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    let meta = {};
    try { meta = JSON.parse(doc.getElementById('vibecms-state').textContent).meta || {}; } catch { /* not an editable page */ }
    return { doc, meta };
  }
  async function pool(items, n, fn) {
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) { const k = i++; await fn(items[k], k); }
    }));
  }
  // Only this site's own pages ("/about-us/"), never a "//other-host" path.
  const otherPages = async () => (await core.sitePages()).map((p) => p.path).filter((p) => typeof p === 'string' && /^\/(?!\/)/.test(p) && p !== S.path);

  /* ---------------------------------------------------------------- search */
  async function search() {
    const q = fs.q.trim();
    if (!q) { core.toast('Type the words to find.'); return; }
    core.finishEdit();
    const opts = { q, matchCase: fs.matchCase, whole: fs.whole, meta: fs.meta };
    const rx = makeRx(opts);
    fs.phase = 'searching';
    fs.results = null;
    fs.done = null;
    fs.undo = null;
    const groups = [];
    const site = new Map();
    const addSite = (m, path) => {
      for (const [key, v] of m) if (!site.has(key)) site.set(key, { id: `s:${key}`, key, label: v.label[0], sub: v.label[1], count: v.count, snips: v.snips, path });
    };
    const here = scanDoc(d, rx, S.meta || {}, opts.meta);
    groups.push({ id: `p:${S.path}`, path: S.path, label: pageTitle(d, S.path), sub: S.path, current: true, count: here.page.count, snips: here.page.snips });
    addSite(here.site, S.path);
    const paths = await otherPages();
    fs.progress = [0, paths.length];
    view();
    const errors = [];
    const found = new Map();
    await pool(paths, 4, async (path) => {
      try {
        const got = await fetchDoc(path);
        if (got) {
          const r = scanDoc(got.doc, rx, got.meta, opts.meta);
          found.set(path, { id: `p:${path}`, path, label: pageTitle(got.doc, path), sub: path, count: r.page.count, snips: r.page.snips });
          addSite(r.site, path);
        }
      } catch (err) { errors.push({ path, message: err.message }); }
      fs.progress[0]++;
      progress();
    });
    for (const p of paths) if (found.has(p)) groups.push(found.get(p));
    const all = [groups[0], ...[...site.values()].map((s) => ({ ...s, site: true })), ...groups.slice(1)].filter((g) => g.count);
    fs.results = { opts, groups: all, errors, picked: new Set(all.map((g) => g.id)) };
    fs.phase = 'results';
    view(true);
  }

  /* ---------------------------------------------------------------- replace */
  async function replaceAll(onlyIds) {
    const res = fs.results;
    if (!res || fs.busy) return;
    const { opts } = res;
    const rep = fs.rep;
    const ids = onlyIds || res.picked;
    const picked = res.groups.filter((g) => ids.has(g.id));
    if (!picked.length) { core.toast('Tick at least one page.'); return; }
    if (!rep && !confirm(`“Replace with” is empty, so every match of “${opts.q}” will be deleted. Continue?`)) return;
    core.finishEdit();
    const rx = makeRx(opts);
    const siteGroups = picked.filter((g) => g.site);
    const siteKeys = new Set(siteGroups.map((g) => g.key));
    const pagePaths = new Set(picked.filter((g) => !g.site).map((g) => g.path));
    const sitePaths = new Set(siteGroups.map((g) => g.path));
    const sel = (k) => `[data-cms="${CSS.escape(k)}"]`;
    // Site-wide parts are changed once: on this page if it shows them, otherwise on the first page that does.
    const claimed = new Set();
    const claim = (doc) => {
      const keys = new Set();
      for (const k of siteKeys) if (!claimed.has(k) && doc.querySelector(sel(k))) { claimed.add(k); keys.add(k); }
      return keys;
    };
    const here = pagePaths.has(S.path) || [...siteKeys].some((k) => d.querySelector(sel(k)));
    const others = (await otherPages()).filter((p) => pagePaths.has(p) || sitePaths.has(p));
    fs.busy = true;
    fs.phase = 'replacing';
    fs.progress = [0, others.length + (here ? 1 : 0)];
    const undo = onlyIds && fs.undo ? fs.undo : [];
    const rows = onlyIds && fs.done ? fs.done.rows.filter((r) => !r.error) : [];
    const order = new Map(res.groups.map((g, i) => [g.id, i]));
    const pageLabel = (path) => res.groups.find((g) => g.path === path && !g.site)?.label || (path === '/' ? 'Home' : path);
    /** One result row for the page's own text, one for each site-wide part saved with it. */
    const record = (path, counts, current) => {
      if (counts.page) rows.push({ path, label: pageLabel(path), count: counts.page, current, order: order.get(`p:${path}`) ?? 999 });
      for (const [key, n] of Object.entries(counts.site)) {
        const g = siteGroups.find((x) => x.key === key);
        rows.push({ path, label: g ? g.label : key, count: n, site: true, order: order.get(`s:${key}`) ?? 998 });
      }
    };
    const tally = (changed) => {
      const counts = { page: 0, site: {} };
      for (const [key, { hits }] of Object.entries(changed)) {
        const n = hits.reduce((s, h) => s + h.ms.length, 0);
        if (key.startsWith('@')) counts.site[key] = n; else counts.page += n;
      }
      return counts;
    };
    view();

    // This page: change the live page through the editor, so Ctrl+Z works and autosave keeps it.
    if (here) {
      const keys = claim(d);
      const changed = changesIn(d, rx, { siteKeys: keys, page: pagePaths.has(S.path) });
      const counts = tally(changed);
      const entry = { path: S.path, current: true, regions: {}, meta: null };
      for (const [key, { region, hits }] of Object.entries(changed)) {
        const before = core.regionHtml(region);
        core.mutate(region, () => applyHits(hits, rx, rep, opts.matchCase));
        entry.regions[key] = { before, after: core.regionHtml(region) };
      }
      if (opts.meta && pagePaths.has(S.path)) {
        const was = storedMeta(S.meta || {});
        const m = replaceMeta(metaOf(d, was), was, rx, rep, opts.matchCase);
        if (m.count) {
          counts.page += m.count;
          entry.meta = { before: was, after: storedMeta(m.out), docTitle: d.title };
          setPageMeta(m.out);
        }
      }
      if (Object.keys(entry.regions).length || entry.meta) undo.push(entry);
      record(S.path, counts, true);
      fs.progress[0]++;
      progress();
    }

    const failed = new Map();
    await pool(others, 3, async (path) => {
      let keys = new Set();
      try {
        const got = await fetchDoc(path);
        if (!got) return;
        const { doc } = got;
        keys = claim(doc);
        const changed = changesIn(doc, rx, { siteKeys: keys, page: pagePaths.has(path) });
        const counts = tally(changed);
        const regions = {};
        const entry = { path, regions: {}, meta: null };
        for (const [key, { region, hits }] of Object.entries(changed)) {
          const before = region.innerHTML;
          applyHits(hits, rx, rep, opts.matchCase);
          const base = region.getAttribute('data-cms-v') || null;
          regions[key] = { html: region.innerHTML, base };
          entry.regions[key] = { before, after: region.innerHTML, base };
        }
        if (opts.meta && pagePaths.has(path)) {
          const was = storedMeta(got.meta);
          const m = replaceMeta(metaOf(doc, was), was, rx, rep, opts.matchCase);
          if (m.count) {
            counts.page += m.count;
            regions['#meta'] = { meta: storedMeta(m.out) };
            entry.meta = { before: was, after: storedMeta(m.out) };
          }
        }
        if (!Object.keys(regions).length) return;
        await core.api('PUT', 'draft', { path, regions });
        undo.push(entry);
        record(path, counts, false);
      } catch (err) {
        for (const k of keys) claimed.delete(k);
        failed.set(path, err.message);
      } finally {
        fs.progress[0]++;
        progress();
      }
    });
    // Anything picked that couldn't be saved gets a row with "Try again".
    for (const [path, message] of failed) {
      if (pagePaths.has(path)) rows.push({ path, label: pageLabel(path), error: message, ids: [`p:${path}`], order: order.get(`p:${path}`) ?? 999 });
    }
    for (const g of siteGroups) {
      if (claimed.has(g.key)) continue;
      rows.push({ path: g.path, label: g.label, site: true, error: failed.get(g.path) || 'It isn’t on the page it was found on any more. Search again.', ids: [g.id], order: order.get(g.id) ?? 998 });
    }
    rows.sort((a, b) => (a.current ? -1 : b.current ? 1 : a.order - b.order));
    core.clearPagesCache();
    fs.undo = undo;
    fs.done = { rows };
    fs.busy = false;
    fs.phase = 'done';
    view(true);
  }
  function changesIn(doc, rx, { siteKeys, page }) {
    const changed = {};
    for (const region of doc.querySelectorAll('[data-cms]')) {
      const key = region.getAttribute('data-cms');
      if (key.startsWith('@') ? !siteKeys.has(key) : !page) continue;
      const hits = regionHits(region, rx);
      if (hits.length) changed[key] = { region, hits };
    }
    return changed;
  }
  const applyHits = (hits, rx, rep, matchCase) => {
    for (const h of hits) h.node.nodeValue = h.node.nodeValue.replace(rx, (m) => withCase(m, rep, matchCase));
  };
  /** New saved page settings: only the fields that had matches change, the rest stay as saved. */
  function replaceMeta(eff, stored, rx, rep, matchCase) {
    let count = 0;
    const out = storedMeta(stored);
    for (const k of Object.keys(META_LABEL)) {
      const n = [...eff[k].matchAll(rx)].length;
      if (!n) continue;
      count += n;
      out[k] = eff[k].replace(rx, (m) => withCase(m, rep, matchCase)).slice(0, k === 'description' ? 500 : 200);
    }
    return { out, count };
  }
  /** A region's own HTML, with the regions nested in it (shared sections) emptied: edits to those don't count. */
  function ownHtml(html) {
    const tpl = d.createElement('template');
    tpl.innerHTML = html;
    tpl.content.querySelectorAll('[data-cms]').forEach((n) => n.replaceChildren());
    return tpl.innerHTML;
  }
  /** Puts saved HTML back into a region, keeping the regions nested in it (shared sections) as they are now. */
  function putBack(region, html) {
    const tpl = d.createElement('template');
    tpl.innerHTML = html;
    for (const n of [...tpl.content.querySelectorAll('[data-cms]')]) {
      if (!tpl.content.contains(n)) continue;  // already replaced along with a region around it
      const now = region.querySelector(`[data-cms="${CSS.escape(n.getAttribute('data-cms'))}"]`);
      if (now) n.replaceWith(now);
    }
    region.replaceChildren(tpl.content);
  }
  const storedMeta = (m) => ({ title: m.title || '', description: m.description || '', shareTitle: m.shareTitle || '' });
  const sameMeta = (a, b) => JSON.stringify(storedMeta(a || {})) === JSON.stringify(storedMeta(b || {}));
  function setPageMeta(meta, docTitle) {
    S.meta = storedMeta(meta);
    d.title = meta.title || docTitle || d.title;
    // Page settings are saved like the settings panel saves them: as a draft with the next autosave.
    core.setExtra('#meta', { meta: S.meta });
  }

  /** Puts back what Replace changed, wherever nobody has edited it since. */
  async function undoReplace() {
    const log = fs.undo;
    if (!log || fs.busy) return;
    fs.busy = true;
    fs.phase = 'undoing';
    fs.progress = [0, log.length];
    view();
    let kept = 0;
    let failed = 0;
    await pool(log, 3, async (entry) => {
      try {
        if (entry.current) {
          for (const [key, v] of Object.entries(entry.regions)) {
            const region = core.regionByKey(key);
            if (!region || ownHtml(core.regionHtml(region)) !== ownHtml(v.after)) { kept++; continue; }
            core.mutate(region, () => putBack(region, v.before));
            core.openDetails();
          }
          if (entry.meta) {
            if (sameMeta(S.meta, entry.meta.after)) setPageMeta(entry.meta.before, entry.meta.docTitle);
            else kept++;
          }
          return;
        }
        const got = await fetchDoc(entry.path);
        if (!got) return;
        const regions = {};
        for (const [key, v] of Object.entries(entry.regions)) {
          const region = got.doc.querySelector(`[data-cms="${CSS.escape(key)}"]`);
          if (!region || ownHtml(region.innerHTML) !== ownHtml(v.after)) { kept++; continue; }
          putBack(region, v.before);
          regions[key] = { html: region.innerHTML, base: v.base };
        }
        if (entry.meta) {
          if (sameMeta(got.meta, entry.meta.after)) regions['#meta'] = { meta: entry.meta.before };
          else kept++;
        }
        if (Object.keys(regions).length) await core.api('PUT', 'draft', { path: entry.path, regions });
      } catch { failed++; } finally { fs.progress[0]++; progress(); }
    });
    fs.busy = false;
    fs.undo = null;
    fs.done = null;
    fs.results = null;
    fs.phase = 'idle';
    core.clearPagesCache();
    view();
    core.toast(failed ? `Undo didn’t finish on ${failed} page${failed === 1 ? '' : 's'}. Check your connection, then look at those pages.`
      : kept ? `Replace undone, except ${kept} place${kept === 1 ? '' : 's'} edited since.` : 'Replace undone. The pages are back as they were (saved as drafts).', Boolean(failed));
  }

  /* ---------------------------------------------------------------- panel */
  function open() {
    pb = core.openPanel('Find and replace', `
      <form class="wr-find" data-f="form" autocomplete="off">
        <div class="field"><label for="wf-q">Find</label><input id="wf-q" name="q" type="text" enterkeyhint="search" spellcheck="false" value="${esc(fs.q)}" placeholder="Words to find on every page"></div>
        <div class="field"><label for="wf-r">Replace with</label><input id="wf-r" name="rep" type="text" spellcheck="true" value="${esc(fs.rep)}" placeholder="New words"></div>
        <div class="wr-opts">
          <label class="wr-check"><input type="checkbox" name="matchCase" ${fs.matchCase ? 'checked' : ''}>Match capital letters exactly</label>
          <label class="wr-check"><input type="checkbox" name="whole" ${fs.whole ? 'checked' : ''}>Whole words only</label>
          <label class="wr-check"><input type="checkbox" name="meta" ${fs.meta ? 'checked' : ''}>Include page titles and descriptions</label>
        </div>
        <div class="row end"><button class="btn primary" type="submit" data-f="find">${icon('search')}Find on all pages</button></div>
      </form>
      <div class="wr-out" data-f="out" aria-live="polite"></div>`);
    const form = pb.querySelector('[data-f="form"]');
    form.addEventListener('input', (e) => {
      const t = e.target;
      if (t.name === 'rep') { fs.rep = t.value; if (fs.phase === 'results') drawFoot(); return; }
      if (t.name === 'q') fs.q = t.value;
      if (t.type === 'checkbox') fs[t.name] = t.checked;
      if (fs.phase === 'results') { fs.phase = 'idle'; fs.results = null; view(); }
    });
    form.addEventListener('submit', (e) => { e.preventDefault(); if (!fs.busy) search(); });
    pb.addEventListener('change', (e) => {
      const t = e.target;
      const res = fs.results;
      if (!res) return;
      if (t.matches('[data-all]')) res.picked = new Set(t.checked ? res.groups.map((g) => g.id) : []);
      else if (t.dataset.g) { if (t.checked) res.picked.add(t.dataset.g); else res.picked.delete(t.dataset.g); }
      else return;
      // Update in place so keyboard focus stays on the box that was just ticked.
      pb.querySelectorAll('[data-g]').forEach((c) => { c.checked = res.picked.has(c.dataset.g); c.closest('.wr-g').classList.toggle('off', !c.checked); });
      const all = pb.querySelector('[data-all]');
      if (all) all.checked = res.picked.size === res.groups.length;
      drawFoot();
    });
    pb.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-f]');
      if (!b) return;
      const f = b.dataset.f;
      if (f === 'replace') replaceAll();
      if (f === 'retry') replaceAll(new Set(fs.done.rows.filter((r) => r.error).flatMap((r) => r.ids || [])));
      if (f === 'undo') undoReplace();
      if (f === 'again') { fs.phase = 'idle'; fs.results = null; fs.done = null; view(); pb.querySelector('#wf-q').focus(); }
      if (f === 'publish') {
        if (!confirm('Publish the unpublished changes on every page? Visitors will see them right away.')) return;
        core.closePanel();
        await core.publishNow({ all: true });
        fs.undo = null;
      }
      if (f === 'go') {
        e.preventDefault();
        core.finishEdit();
        await core.save();
        location.href = `${b.dataset.path}?edit`;
      }
    });
    view();
    setTimeout(() => pb.querySelector(fs.q ? '#wf-r' : '#wf-q')?.focus(), 0);
  }

  const plural = (n, one, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
  function progressHtml(text) {
    const [a, b] = fs.progress;
    return `<div class="wr-progress" role="status"><p><i class="wr-spin" aria-hidden="true"></i>${esc(text)} <span data-c>${b ? `${a} of ${b} pages` : ''}</span></p>
      <div class="wr-bar"><i style="width:${b ? Math.round((a / b) * 100) : 0}%"></i></div></div>`;
  }
  function progress() {
    if (!pb || !pb.isConnected) return;
    const el = pb.querySelector('.wr-progress');
    if (!el) { view(); return; }
    const [a, b] = fs.progress;
    el.querySelector('i[style]').style.width = `${b ? Math.round((a / b) * 100) : 0}%`;
    el.querySelector('[data-c]').textContent = `${a} of ${b} pages`;
  }
  function view(reveal = false) {
    if (!pb || !pb.isConnected) return;
    const out = pb.querySelector('[data-f="out"]');
    // After a search or a replace, scroll the panel so the results start at the top (phones show little).
    if (reveal) requestAnimationFrame(() => { pb.scrollTop += out.getBoundingClientRect().top - pb.getBoundingClientRect().top - 12; });
    const findBtn = pb.querySelector('[data-f="find"]');
    findBtn.disabled = fs.busy || fs.phase === 'searching';
    if (fs.phase === 'searching') { out.innerHTML = progressHtml('Searching…'); return; }
    if (fs.phase === 'replacing') { out.innerHTML = progressHtml('Replacing…'); return; }
    if (fs.phase === 'undoing') { out.innerHTML = progressHtml('Putting it back…'); return; }
    if (fs.phase === 'done' && fs.done) { out.innerHTML = doneHtml(); return; }
    if (fs.phase !== 'results' || !fs.results) {
      out.innerHTML = '<p class="muted wr-hint">Searches the text of every page, the footer and shared sections. Changes are saved as drafts: visitors see nothing until you publish.</p>';
      return;
    }
    const res = fs.results;
    const total = res.groups.reduce((n, g) => n + g.count, 0);
    const errs = res.errors.length ? `<p class="wr-warn">${plural(res.errors.length, 'page')} couldn’t be searched: ${res.errors.map((x) => esc(x.path)).join(', ')}.</p>` : '';
    if (!total) {
      out.innerHTML = `<div class="note">No matches for “${esc(res.opts.q)}”.${res.opts.whole || res.opts.matchCase ? ' Try without “Whole words only” or “Match capital letters”.' : ''}</div>${errs}`;
      return;
    }
    const pages = res.groups.filter((g) => !g.site).length;
    const where = [pages ? `on ${plural(pages, 'page')}` : '', res.groups.some((g) => g.site) ? 'in site-wide parts' : ''].filter(Boolean).join(' and ');
    out.innerHTML = `<p class="wr-sum"><b>${plural(total, 'match', 'matches')}</b> for “${esc(res.opts.q)}”, ${where}.</p>${errs}
      ${res.groups.length > 1 ? `<label class="wr-check wr-all"><input type="checkbox" data-all ${res.picked.size === res.groups.length ? 'checked' : ''}>Replace everywhere</label>` : ''}
      <ul class="wr-groups">${res.groups.map((g) => `<li class="wr-g${res.picked.has(g.id) ? '' : ' off'}">
        <label class="wr-gh"><input type="checkbox" data-g="${esc(g.id)}" ${res.picked.has(g.id) ? 'checked' : ''}>
          <span class="grow"><b>${esc(g.label)}</b><span>${esc(g.sub)}${g.current ? ' · this page' : ''}</span></span>
          <span class="wr-n" aria-label="${plural(g.count, 'match', 'matches')}">${g.count}</span></label>
        <ul class="wr-snips">${g.snips.map((s) => `<li>${s}</li>`).join('')}${g.count > g.snips.length ? `<li class="wr-more">and ${plural(g.count - g.snips.length, 'more match', 'more matches')}</li>` : ''}</ul></li>`).join('')}</ul>
      <div class="wr-foot" data-f-foot></div>`;
    drawFoot();
  }
  function drawFoot() {
    const foot = pb && pb.querySelector('[data-f-foot]');
    const res = fs.results;
    if (!foot || !res) return;
    const picked = res.groups.filter((g) => res.picked.has(g.id));
    const n = picked.reduce((s, g) => s + g.count, 0);
    const same = fs.rep === res.opts.q && res.opts.matchCase;
    foot.innerHTML = `<span class="muted wr-case">${res.opts.matchCase || !fs.rep ? '' : 'Capital letters follow each match, so a word that starts a sentence stays capitalised.'}</span>
      <button class="btn primary" data-f="replace" ${n && !same ? '' : 'disabled'}>${fs.rep ? `Replace ${plural(n, 'match', 'matches')}` : `Delete ${plural(n, 'match', 'matches')}`}</button>`;
  }
  function doneHtml() {
    const rows = fs.done.rows;
    const ok = rows.filter((r) => !r.error);
    const bad = rows.filter((r) => r.error);
    const n = ok.reduce((s, r) => s + r.count, 0);
    const pages = new Set(ok.filter((r) => !r.site).map((r) => r.path)).size;
    const parts = ok.filter((r) => r.site).map((r) => (/^(Footer|Header)$/.test(r.label) ? `the ${r.label.toLowerCase()}` : 'a shared section'));
    const where = [pages ? `on ${plural(pages, 'page')}` : '', ...[...new Set(parts)].map((p) => `in ${p}`)].filter(Boolean);
    const whereText = where.length > 1 ? `${where.slice(0, -1).join(', ')} and ${where[where.length - 1]}` : where[0];
    const canPublish = S.user.role !== 'author';
    return `<div class="note wr-done"><b>${ok.length ? `Replaced ${plural(n, 'match', 'matches')} ${whereText}.` : 'Nothing was replaced.'}</b>
        ${ok.length ? (n === 1 ? ` It’s saved as a draft, so visitors don’t see it yet.${canPublish ? ' Publish to make it live.' : ' An editor can publish it.'}`
    : ` They’re saved as drafts, so visitors don’t see them yet.${canPublish ? ' Publish to make them live.' : ' An editor can publish them.'}`) : ''}</div>
      ${bad.length ? `<p class="wr-warn">${plural(bad.length, 'page')} couldn’t be changed. Nothing was saved on ${bad.length === 1 ? 'it' : 'them'}.</p>` : ''}
      <ul class="list wr-rows">${rows.map((r) => `<li class="${r.error ? 'wr-err' : ''}"><span class="grow"><b>${esc(r.label)}</b><span>${r.error ? esc(r.error) : `${plural(r.count, 'change')}${r.current ? ' · this page' : r.site ? (/^(Header|Footer)$/.test(r.label) ? ' · on every page' : ' · on every page that uses it') : ''}`}</span></span>
        ${r.current || r.site || r.error ? '' : `<a class="btn" href="${esc(r.path)}?edit" data-f="go" data-path="${esc(r.path)}">Open</a>`}</li>`).join('')}</ul>
      <div class="wr-foot">
        ${bad.length ? '<button class="btn" data-f="retry">Try those pages again</button>' : ''}
        ${fs.undo && fs.undo.length ? '<button class="btn" data-f="undo">Undo replace</button>' : ''}
        <button class="btn" data-f="again">New search</button>
        ${ok.length && canPublish ? '<button class="btn primary" data-f="publish">Publish all pages</button>' : ''}
      </div>`;
  }

  core.addPanel('find', open);
  core.addBarButton({ id: 'find', icon: 'search', title: 'Find and replace on all pages', panel: 'find', order: 20 });
});
