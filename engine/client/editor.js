// Vibe CMS editor: click any text on the page to type, click an image to replace it, and use the
// toolbars to duplicate, move, hide or delete things. Loaded only for signed-in editors on ?edit pages.
(() => {
  'use strict';
  // The real state is the last JSON script with this id (page content can't plant one: the sanitizer strips it).
  // Called through the prototype and checked as an own property, so an element in the page named
  // "querySelectorAll" or with id "__vibecms" can't stop the editor from loading (DOM clobbering).
  const stateEl = [...Document.prototype.querySelectorAll.call(document, 'script#vibecms-state[type="application/json"]')].pop();
  if (!stateEl || Object.hasOwn(window, '__vibecms')) return;
  window.__vibecms = true;

  const S = JSON.parse(stateEl.textContent);
  const UI_CSS = __UI_CSS__;
  const JUNK = __JUNK__;
  const d = document;

  /* Browser extensions (Grammarly, password managers, dark-mode tools) add their own elements and
     attributes to pages people type on. None of it may be saved. Custom elements the page already
     had when the editor started are the page's own; any other custom element is an extension's. */
  const junkTag = new RegExp(JUNK.tag);
  const junkAttr = new RegExp(JUNK.attr);
  const junkStyle = new RegExp(JUNK.style, 'gi');
  const pageTags = new Set();
  const notePageTags = (node) => node.querySelectorAll('*').forEach((n) => {
    if (n.localName.includes('-') && !junkTag.test(n.localName) && !n.hasAttribute(JUNK.marker)) pageTags.add(n.localName);
  });
  d.querySelectorAll('[data-cms]').forEach(notePageTags);
  function stripJunk(node) {
    node.querySelectorAll('*').forEach((n) => {
      const t = n.localName;
      if ((t.includes('-') && !pageTags.has(t)) || n.hasAttribute(JUNK.marker)) { n.remove(); return; }
      for (const a of [...n.attributes]) {
        const name = a.name.toLowerCase();
        if (junkAttr.test(name)) n.removeAttribute(a.name);
        else if (name === 'style' && a.value.toLowerCase().includes('--darkreader-')) {
          const rest = a.value.replace(junkStyle, '').trim();
          if (rest) n.setAttribute('style', rest); else n.removeAttribute('style');
        }
      }
    });
    return node;
  }
  const SVG_NS = 'http://www.w3.org/2000/svg';
  d.documentElement.classList.add('vibecms-on');

  /* ---------------------------------------------------------------- features and hooks
     Features live in client/features/<name>.js and are built into this file. Each one calls
     feature('<name>', (core) => { ... }) and uses the core API (see the bottom of this file). */
  const features = [];
  function feature(name, setup) { features.push([name, setup]); }
  const hooks = {};
  function on(event, fn) { (hooks[event] ||= []).push(fn); return () => { hooks[event] = hooks[event].filter((f) => f !== fn); }; }
  function emit(event, ...args) {
    return (hooks[event] || []).map((fn) => {
      try { return fn(...args); } catch (err) { console.error(`vibecms: ${event} handler failed`, err); return undefined; }
    });
  }

  /* ---------------------------------------------------------------- icons */
  const P = {
    bold: '<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7z"/><path d="M7 12h7a3.5 3.5 0 0 1 0 7H7z"/>',
    italic: '<path d="M19 4h-9"/><path d="M14 20H5"/><path d="M15 4 9 20"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M4 16V6a2 2 0 0 1 2-2h10"/>',
    up: '<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>',
    down: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
    trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 14H6L5 6"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeoff: '<path d="M2 12s3.5-7 10-7c2 0 3.8.7 5.2 1.6M22 12s-3.5 7-10 7c-2 0-3.8-.7-5.2-1.6"/><path d="m3 3 18 18"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
    alt: '<path d="M4 7V5h16v2"/><path d="M12 5v14"/><path d="M9 19h6"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    parent: '<path d="m14 9-5-5-5 5"/><path d="M20 20h-7a4 4 0 0 1-4-4V4"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
    pages: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
    settings: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
    history: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    upload: '<path d="M12 15V3"/><path d="m7 8 5-5 5 5"/><path d="M5 21h14"/>',
    exit: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
    send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
    more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
  };
  const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${P[name] || ''}</svg>`;

  /* ---------------------------------------------------------------- utils */
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hasText = (el) => /\S/.test(el.textContent || '');
  const keyOf = (region) => region.getAttribute('data-cms');
  const regionOf = (node) => (node && (node.nodeType === 1 ? node : node.parentElement))?.closest('[data-cms]') || null;
  const regionByKey = (key) => d.querySelector(`[data-cms="${CSS.escape(key)}"]`);
  const isGlobal = (region) => keyOf(region).startsWith('@');
  const locked = (el) => Boolean(el.closest('[data-cms-lock]'));

  async function api(method, route, body) {
    const opts = { method, credentials: 'same-origin', headers: { 'x-vibecms': '1' } };
    if (body instanceof FormData) opts.body = body;
    else if (body !== undefined) { opts.headers['content-type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const res = await fetch(`/_cms/api/${route}`, opts);
    let data = {};
    try { data = await res.json(); } catch { /* empty */ }
    if (res.status === 401) { toast('Your session ended. Sign in again to keep editing.', true); }
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  /* ---------------------------------------------------------------- what is editable */
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'IMG', 'PICTURE', 'VIDEO', 'AUDIO', 'IFRAME', 'CANVAS', 'INPUT',
    'SELECT', 'TEXTAREA', 'OPTION', 'FORM', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'UL', 'OL', 'DL', 'HR', 'BR', 'OBJECT', 'EMBED', 'SOURCE', 'MAIN', 'BODY', 'HTML']);
  const RICH_NO = /^(H[1-6]|A|BUTTON|LABEL|SUMMARY|TIME|SMALL|STRONG|EM|B|I|SPAN|DT|TH|CAPTION|LEGEND)$/;
  const SPLIT = /^(P|LI)$/;

  function inlineChild(c) {
    if (c.tagName === 'BR' || c.tagName === 'WBR') return true;
    if (c.namespaceURI === SVG_NS) return true;
    const disp = getComputedStyle(c).display;
    if (disp === 'none') return true;
    if (disp === 'contents') return [...c.children].every(inlineChild);
    return disp.startsWith('inline');
  }
  function eligible(el) {
    if (!el || el.nodeType !== 1 || el.namespaceURI === SVG_NS) return false;
    if (SKIP.has(el.tagName.toUpperCase()) || el.hasAttribute('data-cms') || locked(el)) return false;
    if (!hasText(el)) return false;
    if (el.querySelector('img,video,iframe,input,select,textarea,picture')) return false;
    for (const c of el.children) if (!inlineChild(c)) return false;
    return true;
  }
  /** The block of text the node belongs to (a whole paragraph, heading, button label…). */
  function textBlockFor(node) {
    let el = node && (node.nodeType === 1 ? node : node.parentElement);
    const region = regionOf(el);
    if (!region) return null;
    let best = null;
    while (el && el !== region) {
      if (eligible(el)) best = el;
      else if (best) break;
      el = el.parentElement;
    }
    return best;
  }
  const sig = (e) => `${e.tagName}|${[...e.classList].filter((c) => !/^(is-|has-|active|open)/.test(c)).sort().join('.')}`;
  /** Nearest repeated thing (card, list item, row, paragraph) that can be duplicated, moved or deleted. */
  function itemFor(el) {
    const region = regionOf(el);
    let cur = el;
    while (cur && cur !== region && cur.parentElement && cur.parentElement !== region) {
      if (!locked(cur)) {
        if (/^(LI|TR)$/.test(cur.tagName)) return cur;
        const s = sig(cur);
        let n = 0;
        for (const c of cur.parentElement.children) if (sig(c) === s) n++;
        if (n >= 2) return cur;
      }
      cur = cur.parentElement;
    }
    return null;
  }
  /** Top-level section of a page region (sections can be moved, duplicated, hidden, deleted, added). */
  function sectionFor(node) {
    let el = node && (node.nodeType === 1 ? node : node.parentElement);
    const region = pageRegionOf(el);
    if (!region || el === region) return null;
    while (el && el.parentElement !== region) el = el.parentElement;
    return el || null;
  }
  /** The page region (not header/footer) a node is in. A shared section (data-cms="@s-…") placed
      inside a page region is itself a region, but as a section it belongs to the page region. */
  function pageRegionOf(node) {
    let region = regionOf(node);
    while (region && isGlobal(region)) {
      const up = region.parentElement ? regionOf(region.parentElement) : null;
      if (!up) return null;
      region = up;
    }
    return region;
  }
  const classifiers = [];
  // Authors edit page content only; parts shared by every page are for editors and admins.
  const readOnly = (region) => S.user.role === 'author' && region && isGlobal(region);
  function classify(node) {
    if (!node || node.nodeType !== 1 || !regionOf(node) || locked(node) || readOnly(regionOf(node))) return null;
    for (const c of classifiers) {
      try { const t = c(node); if (t) return t; } catch (err) { console.error('vibecms: classifier failed', err); }
    }
    const img = node.closest('img, picture');
    if (img && regionOf(img)) return { type: 'image', el: img.tagName === 'PICTURE' ? img.querySelector('img') : img };
    const text = textBlockFor(node);
    if (text) return { type: 'text', el: text };
    const item = itemFor(node);
    if (item) return { type: 'item', el: item };
    return null;
  }
  function label(t) {
    if (!t) return '';
    if (t.label) return t.label;
    const el = t.el;
    if (t.type === 'image') return 'Image';
    const tag = el.tagName;
    if (/^H[1-6]$/.test(tag)) return 'Heading';
    if (tag === 'P') return 'Paragraph';
    if (tag === 'LI') return 'List item';
    if (tag === 'TR') return 'Row';
    if (tag === 'TD' || tag === 'TH') return 'Cell';
    if (tag === 'A' || tag === 'BUTTON') return /btn|button|cta/i.test(el.className) || tag === 'BUTTON' ? 'Button' : 'Link';
    if (tag === 'BLOCKQUOTE') return 'Quote';
    if (tag === 'FIGCAPTION') return 'Caption';
    if (t.type === 'item') return el.querySelector('h1,h2,h3,h4,h5,h6,img') ? 'Card' : 'Block';
    return 'Text';
  }
  const linkOf = (el) => (el.tagName === 'A' ? el : el.closest('a') || (el.children.length === 1 && el.firstElementChild.tagName === 'A' && el.textContent.trim() === el.firstElementChild.textContent.trim() ? el.firstElementChild : null));
  const isRich = (el) => !RICH_NO.test(el.tagName) && !el.closest('a,button');

  /* ---------------------------------------------------------------- UI shell */
  const host = d.createElement('vibecms-ui');
  host.style.cssText = 'all:initial;position:fixed;inset:0 auto auto 0;width:0;height:0;z-index:2147483647';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${UI_CSS}</style><div class="root" style="--a:${esc(S.site.accent)};--on-a:${onAccent(S.site.accent)}">
    <div class="box sec" data-r="sec"></div><div class="box hover" data-r="hover"></div><div class="box sel" data-r="sel"></div>
    <div class="tag" data-r="tag"></div>
    <div class="tb" data-r="sbar" role="toolbar" aria-label="Section"></div>
    <div class="tb" data-r="tbar" role="toolbar" aria-label="Selected item"></div>
    <div class="pop" data-r="pop"></div>
    <div class="banner" data-r="banner"></div>
    <div class="bar" data-r="bar"></div>
    <aside class="panel" data-r="panel" aria-live="polite"></aside>
    <div class="scrim" data-r="scrim"></div>
    <div class="toast" data-r="toast" role="status"></div></div>`;
  d.documentElement.append(host);
  const R = Object.fromEntries([...root.querySelectorAll('[data-r]')].map((n) => [n.dataset.r, n]));
  const inUi = (e) => e.composedPath().includes(host);

  function onAccent(hex) {
    let h = String(hex || '').replace('#', '');
    if (h.length === 3) h = [...h].map((c) => c + c).join('');
    if (!/^[0-9a-f]{6}$/i.test(h)) return '#fff';
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.179 ? '#111' : '#fff';
  }

  let toastTimer;
  let hintShowing = false;
  /** The first-visit hint must not sit over a panel or menu the editor just opened. */
  function dismissHint() { if (hintShowing) { hintShowing = false; clearTimeout(toastTimer); R.toast.className = 'toast'; } }
  function toast(msg, err = false) {
    hintShowing = false;
    R.toast.textContent = msg;
    R.toast.className = `toast show${err ? ' err' : ''}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { R.toast.className = 'toast'; }, err ? 6000 : 3200);
  }

  /* ---------------------------------------------------------------- state */
  let hover = null;          // {type, el}
  let sel = null;            // {type, el}
  let hoverSection = null;
  let editing = null;        // element being typed in
  let editRegion = null;
  let editBefore = '';
  let savedRange = null;
  const dirty = new Set();
  let metaDirty = false;
  const extras = new Map();  // special draft keys set by features ("@theme" …) → payload
  const undoStack = [];
  const redoStack = [];
  let status = S.hasDraft ? 'draft' : 'live';
  let saveTimer = null;
  let saving = null;

  /* ---------------------------------------------------------------- serialise, undo, save */
  function regionHtml(region) {
    const c = stripJunk(region.cloneNode(true));
    c.querySelectorAll('[contenteditable],[spellcheck]').forEach((n) => { n.removeAttribute('contenteditable'); n.removeAttribute('spellcheck'); });
    c.querySelectorAll('[data-vibecms-open]').forEach((n) => { n.removeAttribute('open'); n.removeAttribute('data-vibecms-open'); });
    return c.innerHTML;
  }
  /** Collapsed <details> (bios, FAQs) are opened while editing so their text can be reached. Saved closed. */
  function openDetails() {
    d.querySelectorAll('[data-cms] details:not([open])').forEach((x) => { x.open = true; x.setAttribute('data-vibecms-open', ''); });
  }
  openDetails();
  function pushUndo(region, html) {
    undoStack.push({ key: keyOf(region), html });
    if (undoStack.length > 100) undoStack.shift();
    redoStack.length = 0;
    drawBar();
  }
  function markDirty(region) {
    dirty.add(keyOf(region));
    setStatus('unsaved');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 1200);
  }
  function mutate(region, fn) {
    finishEdit();
    const before = regionHtml(region);
    fn();
    if (regionHtml(region) !== before) { pushUndo(region, before); markDirty(region); }
    queueDraw();
  }
  function swapHistory(from, to) {
    finishEdit();
    const step = from.pop();
    if (!step) return;
    const region = regionByKey(step.key);
    if (!region) return;
    to.push({ key: step.key, html: regionHtml(region) });
    region.innerHTML = step.html;
    openDetails();
    select(null);
    markDirty(region);
    drawBar();
  }
  const undo = () => swapHistory(undoStack, redoStack);
  const redo = () => swapHistory(redoStack, undoStack);

  async function save() {
    clearTimeout(saveTimer);
    if (saving) { await saving; if (!dirty.size && !metaDirty && !extras.size) return; }
    if (!dirty.size && !metaDirty && !extras.size) return;
    const regions = {};
    for (const key of dirty) {
      const region = regionByKey(key);
      if (region) regions[key] = { html: regionHtml(region), base: region.getAttribute('data-cms-v') || null };
    }
    if (metaDirty) regions['#meta'] = { meta: S.meta };
    for (const [k, v] of extras) regions[k] = v;
    const keys = [...dirty];
    const hadMeta = metaDirty;
    const hadExtras = new Map(extras);
    dirty.clear();
    metaDirty = false;
    extras.clear();
    setStatus('saving');
    saving = api('PUT', 'draft', { path: S.path, regions })
      .then(() => { S.hasDraft = true; setStatus(dirty.size || extras.size ? 'unsaved' : 'draft'); emit('saved', { keys, extras: [...hadExtras.keys()] }); })
      .catch((e) => {
        keys.forEach((k) => dirty.add(k));
        if (hadMeta) metaDirty = true;
        for (const [k, v] of hadExtras) if (!extras.has(k)) extras.set(k, v);
        setStatus('error');
        toast(`Couldn’t save: ${e.message}`, true);
      })
      .finally(() => { saving = null; });
    return saving;
  }

  function setStatus(s) { status = s; drawBar(); }
  /** Saves a special draft key (for example "@theme") with the next autosave. */
  function setExtra(key, payload) {
    extras.set(key, payload);
    setStatus('unsaved');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 1200);
  }

  /* ---------------------------------------------------------------- text editing */
  const plainOnly = (() => { const t = d.createElement('div'); t.contentEditable = 'plaintext-only'; return t.contentEditable === 'plaintext-only'; })();

  function startEdit(el, evt) {
    if (editing === el) return;
    finishEdit();
    editing = el;
    editRegion = regionOf(el);
    editBefore = regionHtml(editRegion);
    // Ask grammar checkers to stay out (they otherwise inject overlays). Stripped again on save.
    for (const a of ['data-gramm', 'data-gramm_editor', 'data-enable-grammarly', 'data-lt-active']) el.setAttribute(a, 'false');
    el.setAttribute('contenteditable', isRich(el) || !plainOnly ? 'true' : 'plaintext-only');
    el.setAttribute('spellcheck', 'true');
    el.focus({ preventScroll: true });
    placeCaret(el, evt);
    queueDraw();
  }
  function placeCaret(el, evt) {
    const s = getSelection();
    let range = null;
    if (evt && d.caretPositionFromPoint) {
      const pos = d.caretPositionFromPoint(evt.clientX, evt.clientY);
      if (pos && el.contains(pos.offsetNode)) { range = d.createRange(); range.setStart(pos.offsetNode, pos.offset); }
    } else if (evt && d.caretRangeFromPoint) {
      const r = d.caretRangeFromPoint(evt.clientX, evt.clientY);
      if (r && el.contains(r.startContainer)) range = r;
    }
    if (!range) { range = d.createRange(); range.selectNodeContents(el); range.collapse(false); }
    range.collapse(true);
    s.removeAllRanges();
    s.addRange(range);
  }
  function finishEdit() {
    if (!editing) return;
    const el = editing;
    const region = editRegion;
    editing = null;
    editRegion = null;
    el.removeAttribute('contenteditable');
    el.removeAttribute('spellcheck');
    if (!hasText(el) && SPLIT.test(el.tagName) && region.contains(el)) {
      if (sel && sel.el === el) sel = null;
      el.remove();
    } else {
      el.normalize();
    }
    const after = regionHtml(region);
    if (after !== editBefore) { pushUndo(region, editBefore); markDirty(region); }
    closePop();
    queueDraw();
  }
  function splitBlock(el) {
    const s = getSelection();
    if (!s.rangeCount) return;
    const r = s.getRangeAt(0);
    r.deleteContents();
    const tail = d.createRange();
    tail.setStart(r.endContainer, r.endOffset);
    tail.setEnd(el, el.childNodes.length);
    const frag = tail.extractContents();
    const next = el.cloneNode(false);
    next.removeAttribute('contenteditable');
    next.removeAttribute('spellcheck');
    next.append(frag);
    if (!hasText(next)) next.innerHTML = '<br>';
    if (!hasText(el)) el.innerHTML = '<br>';
    el.after(next);
    // Keep one undo step for the whole edit: finish without losing the "before" snapshot.
    const region = editRegion;
    const before = editBefore;
    el.removeAttribute('contenteditable');
    el.removeAttribute('spellcheck');
    editing = null;
    select({ type: 'text', el: next });
    startEdit(next, null);
    editBefore = before;
    editRegion = region;
    const range = d.createRange();
    range.setStart(next, 0);
    range.collapse(true);
    s.removeAllRanges();
    s.addRange(range);
  }

  d.addEventListener('keydown', (e) => {
    if (inUi(e)) {
      // Esc inside the editor's own panels and menus closes the innermost one.
      if (e.key === 'Escape') {
        if (R.pop.classList.contains('show')) closePop();
        else if (R.scrim.classList.contains('show')) R.scrim.querySelector('[data-act="close"]')?.click();
        else if (R.panel.classList.contains('show')) closePanel();
        else return;
        e.preventDefault();
      }
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    if (editing) {
      if (e.key === 'Escape') { e.preventDefault(); finishEdit(); select(null); return; }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey && isRich(editing)) d.execCommand('insertLineBreak');
        else if (SPLIT.test(editing.tagName) && !e.shiftKey) splitBlock(editing);
        else finishEdit();
        return;
      }
      if (mod && /^[biu]$/i.test(e.key)) {
        e.preventDefault();
        if (isRich(editing) && e.key.toLowerCase() !== 'u') d.execCommand(e.key.toLowerCase() === 'b' ? 'bold' : 'italic');
        return;
      }
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); openLink(); return; }
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); finishEdit(); save(); return; }
      return;
    }
    if (e.target && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))) return;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
    else if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
    else if (e.key === 'Escape') { closePanel(); closePop(); select(null); }
  }, true);

  d.addEventListener('paste', (e) => {
    if (!editing || !editing.contains(e.target.nodeType === 1 ? e.target : e.target.parentElement)) return;
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain').replace(/\s*\r?\n\s*/g, ' ');
    d.execCommand('insertText', false, text);
  }, true);
  d.addEventListener('drop', (e) => { if (!inUi(e) && regionOf(e.target)) e.preventDefault(); }, true);
  d.addEventListener('dragstart', (e) => { if (!inUi(e) && regionOf(e.target)) e.preventDefault(); }, true);
  d.addEventListener('input', (e) => { if (editing && editing.contains(e.target)) { markDirty(editRegion); queueDraw(); } }, true);
  d.addEventListener('submit', (e) => { if (!inUi(e)) e.preventDefault(); }, true);

  /* ---------------------------------------------------------------- pointer */
  d.addEventListener('mousemove', (e) => {
    if (inUi(e) || R.scrim.classList.contains('show')) return;
    const t = classify(e.target);
    const sec = sectionFor(e.target);
    if (t?.el !== hover?.el || sec !== hoverSection) { hover = t; hoverSection = sec; queueDraw(); }
  }, { passive: true });
  d.documentElement.addEventListener('mouseleave', () => { hover = null; hoverSection = null; queueDraw(); });

  d.addEventListener('click', (e) => {
    if (inUi(e)) return;
    const t = e.target;
    if (!regionOf(t)) {
      if (t.closest && t.closest('a,button,label,summary')) e.preventDefault();
      finishEdit(); select(null); closePop();
      return;
    }
    if (editing && editing.contains(t)) { if (t.closest('a')) e.preventDefault(); return; }
    e.preventDefault();
    e.stopPropagation();
    closePop();
    const target = classify(t);
    if (!target) { finishEdit(); select(null); return; }
    select(target);
    if (target.type === 'text') startEdit(target.el, e);
    else { finishEdit(); if (target.type === 'image' && e.detail >= 2) openImage(target.el); }
  }, true);
  d.addEventListener('dblclick', (e) => { if (!inUi(e) && regionOf(e.target)) e.preventDefault(); }, true);

  function select(t) {
    sel = t && t.el ? t : null;
    queueDraw();
  }

  /* ---------------------------------------------------------------- drawing */
  let raf = 0;
  function queueDraw() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); }
  addEventListener('scroll', queueDraw, { passive: true, capture: true });
  addEventListener('resize', queueDraw);

  function place(box, el, pad = 3) {
    if (!el || !el.isConnected) { box.style.display = 'none'; return null; }
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) { box.style.display = 'none'; return null; }
    Object.assign(box.style, { display: 'block', left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
    return r;
  }
  function draw() {
    if (sel && !sel.el.isConnected) sel = null;
    const showHover = hover && (!sel || hover.el !== sel.el);
    const hr = place(R.hover, showHover ? hover.el : null);
    if (hr && showHover) {
      R.tag.textContent = `${label(hover)}${hover.type === 'image' ? ' · click to select' : ''}`;
      Object.assign(R.tag.style, { display: 'block', left: `${Math.max(4, hr.left - 3)}px`, top: `${hr.top - 26 < 4 ? hr.bottom + 6 : hr.top - 26}px` });
    } else R.tag.style.display = 'none';
    place(R.sel, sel?.el);
    const section = sel ? sectionFor(sel.el) : hoverSection;
    place(R.sec, section, 0);
    drawSectionBar(section);
    drawToolbar();
  }

  function btn(name, title, act, cls = '') {
    return `<button class="ib ${cls}" data-act="${act}" title="${esc(title)}" aria-label="${esc(title)}">${icon(name)}</button>`;
  }
  function positionBar(bar, rect, prefer = 'above') {
    const bw = bar.offsetWidth;
    const bh = bar.offsetHeight;
    let top = prefer === 'above' ? rect.top - bh - 10 : rect.top + 8;
    if (prefer === 'above' && top < 8) top = Math.min(rect.bottom + 10, innerHeight - bh - 90);
    let left = prefer === 'above' ? rect.left : rect.right - bw - 8;
    left = Math.max(8, Math.min(left, innerWidth - bw - 8));
    top = Math.max(8, Math.min(top, innerHeight - bh - 8));
    Object.assign(bar.style, { left: `${left}px`, top: `${top}px` });
  }

  /* Section bar actions, in order. Features add or replace them with core.addSectionAction(). */
  const sectionActions = [
    { act: 'sec-up', order: 20, icon: 'up', title: 'Move section up' },
    { act: 'sec-down', order: 30, icon: 'down', title: 'Move section down' },
    { act: 'sec-dup', order: 40, icon: 'copy', title: 'Duplicate section' },
    { act: 'sec-hide', order: 50, icon: (s) => (s.hasAttribute('data-cms-hidden') ? 'eye' : 'eyeoff'), title: (s) => (s.hasAttribute('data-cms-hidden') ? 'Show section' : 'Hide section') },
    { act: 'sec-add', order: 60, icon: 'plus', title: 'Add a section below' },
    { act: 'sec-del', order: 90, icon: 'trash', title: 'Delete section', cls: 'danger', sep: true },
  ];
  const val = (v, ...args) => (typeof v === 'function' ? v(...args) : v);
  let sbarFor = null;
  function sectionLabel(section) {
    const custom = emit('section:label', section).find(Boolean);
    return custom || 'Section';
  }
  function drawSectionBar(section) {
    const bar = R.sbar;
    if (!section || !section.isConnected) { bar.classList.remove('show'); sbarFor = null; return; }
    if (sbarFor !== section) {
      sbarFor = section;
      // An author can move, hide or remove a shared section on this page but not change the shared content.
      const sharedRO = section.hasAttribute('data-cms') && readOnly(section);
      const acts = sectionActions.filter((a) => (!a.when || a.when(section)) && (!sharedRO || ['sec-drag', 'sec-up', 'sec-down', 'sec-hide', 'sec-add', 'sec-del'].includes(a.act))).sort((a, b) => a.order - b.order);
      bar.innerHTML = `<span class="lbl">${esc(sectionLabel(section))}</span>` + acts.map((a) => (a.sep ? '<span class="sep"></span>' : '')
        + (a.html ? val(a.html, section) : btn(val(a.icon, section), val(a.title, section), a.act, a.cls || ''))).join('');
      emit('sbar', bar, section);
    }
    bar.classList.add('show');
    const r = section.getBoundingClientRect();
    const top = Math.max(8, Math.min(r.top + 8, r.bottom - bar.offsetHeight - 8));
    const visible = r.bottom > 60 && r.top < innerHeight - 60;
    bar.style.display = visible ? '' : 'none';
    Object.assign(bar.style, { left: `${Math.max(8, Math.min(r.right - bar.offsetWidth - 8, innerWidth - bar.offsetWidth - 8))}px`, top: `${top}px` });
  }

  /* Extra element-toolbar actions from features: { act, icon, text?, title, when(sel, ctx), run(sel, ctx), order }. */
  const toolActions = [];
  let tbarKey = '';
  function drawToolbar() {
    const bar = R.tbar;
    if (!sel || !sel.el.isConnected) { bar.classList.remove('show'); tbarKey = ''; return; }
    const el = sel.el;
    const item = sel.type === 'item' ? el : itemFor(el);
    const parent = item ? itemFor(item.parentElement) : null;
    const extra = toolActions.filter((a) => { try { return a.when(sel, { item, editing: editing === el }); } catch { return false; } }).sort((a, b) => (a.order || 50) - (b.order || 50));
    const key = `${sel.type}|${editing === el}|${item ? 1 : 0}|${parent ? 1 : 0}|${extra.map((a) => a.act).join(',')}`;
    if (key !== tbarKey || bar.__el !== el) {
      tbarKey = key;
      bar.__el = el;
      let h = `<span class="lbl">${esc(label(sel))}</span>`;
      if (sel.type === 'text') {
        if (isRich(el)) h += btn('bold', 'Bold (Ctrl+B)', 'bold') + btn('italic', 'Italic (Ctrl+I)', 'italic');
        if (isRich(el) || linkOf(el)) h += btn('link', 'Link (Ctrl+K)', 'link');
      }
      if (sel.type === 'image') {
        h += `<button class="ib txt" data-act="img-replace" title="Replace image">${icon('image')}Replace</button>${btn('alt', 'Alt text (for screen readers and Google)', 'img-alt')}`;
      }
      if (item) {
        const itemName = label({ type: 'item', el: item });
        h += `<span class="sep"></span><span class="lbl">${esc(item === el ? '' : itemName)}</span>${btn('copy', `Duplicate ${itemName.toLowerCase()}`, 'item-dup')}${btn('up', 'Move up', 'item-up')}${btn('down', 'Move down', 'item-down')}`;
        if (parent) h += btn('parent', 'Select the container', 'item-parent');
        h += btn('trash', `Delete ${itemName.toLowerCase()}`, 'item-del', 'danger');
      } else if (sel.type === 'image') {
        h += btn('trash', 'Delete image', 'img-del', 'danger');
      }
      if (extra.length) {
        h += '<span class="sep"></span>' + extra.map((a) => (a.text
          ? `<button class="ib txt ${a.cls || ''}" data-act="${a.act}" title="${esc(val(a.title, sel))}">${a.icon ? icon(val(a.icon, sel)) : ''}${esc(val(a.text, sel))}</button>`
          : btn(val(a.icon, sel), val(a.title, sel), a.act, a.cls || ''))).join('');
      }
      if (sel.type === 'text') h += `<span class="sep"></span>${btn('check', 'Done (Esc)', 'done')}`;
      bar.innerHTML = h;
    }
    bar.classList.add('show');
    const r = el.getBoundingClientRect();
    positionBar(bar, r, 'above');
    if (R.pop.classList.contains('show') && R.pop.__anchor) positionBar(R.pop, R.pop.__anchor.getBoundingClientRect(), 'above');
  }

  // Toolbars must not steal focus from the text being edited.
  [R.tbar, R.sbar].forEach((bar) => bar.addEventListener('mousedown', (e) => e.preventDefault()));
  R.tbar.addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (b) act(b.dataset.act); });
  R.sbar.addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (b) act(b.dataset.act, sbarFor); });

  function act(a, section) {
    const el = sel?.el;
    // A section is a child of its page region (a shared section is a region of its own, so look above it).
    const region = section ? regionOf(section.parentElement) : regionOf(el);
    const item = el ? (sel.type === 'item' ? el : itemFor(el)) : null;
    if (section) {
      const spec = sectionActions.find((x) => x.act === a && x.run);
      if (spec) { spec.run(section, region); queueDraw(); return; }
    } else {
      const spec = toolActions.find((x) => x.act === a);
      if (spec) { spec.run(sel, { item, region, el }); queueDraw(); return; }
    }
    switch (a) {
      case 'bold': d.execCommand('bold'); break;
      case 'italic': d.execCommand('italic'); break;
      case 'link': openLink(); break;
      case 'done': finishEdit(); select(null); break;
      case 'img-replace': openImage(el); break;
      case 'img-alt': openAlt(el); break;
      case 'img-del': mutate(region, () => { const pic = el.closest('picture') || el; pic.remove(); }); select(null); break;
      case 'item-dup': mutate(region, () => { const c = item.cloneNode(true); item.after(c); select({ type: 'item', el: c }); }); break;
      case 'item-up': mutate(region, () => { const p = item.previousElementSibling; if (p) p.before(item); }); select({ type: 'item', el: item }); break;
      case 'item-down': mutate(region, () => { const n = item.nextElementSibling; if (n) n.after(item); }); select({ type: 'item', el: item }); break;
      case 'item-parent': finishEdit(); select({ type: 'item', el: itemFor(item.parentElement) }); break;
      case 'item-del': mutate(region, () => item.remove()); select(null); toast('Deleted. Press Ctrl+Z to undo.'); break;
      case 'sec-up': mutate(region, () => { const p = section.previousElementSibling; if (p) p.before(section); }); section.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); break;
      case 'sec-down': mutate(region, () => { const n = section.nextElementSibling; if (n) n.after(section); }); section.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); break;
      case 'sec-dup': mutate(region, () => section.after(section.cloneNode(true))); break;
      case 'sec-hide': mutate(region, () => section.toggleAttribute('data-cms-hidden')); sbarFor = null; toast(section.hasAttribute('data-cms-hidden') ? 'Section hidden from visitors. It stays here, faded, so you can show it again.' : 'Section visible again.'); break;
      case 'sec-del':
        if (confirm('Delete this whole section? You can undo with Ctrl+Z.')) { mutate(region, () => section.remove()); hoverSection = null; select(null); }
        break;
      case 'sec-add': openAddSection(section); break;
    }
    queueDraw();
  }

  /* ---------------------------------------------------------------- popovers: link and alt text */
  function closePop() { R.pop.classList.remove('show'); R.pop.__anchor = null; R.pop.__more = false; }
  function showPop(anchor, html, onSubmit) {
    dismissHint();
    R.pop.innerHTML = html;
    R.pop.__anchor = anchor;
    R.pop.classList.add('show');
    positionBar(R.pop, anchor.getBoundingClientRect(), 'above');
    const form = R.pop.querySelector('form');
    form.addEventListener('submit', (e) => { e.preventDefault(); onSubmit(new FormData(form), e.submitter?.value); });
    R.pop.querySelector('[data-close]')?.addEventListener('click', () => closePop());
    setTimeout(() => R.pop.querySelector('input')?.focus(), 0);
  }
  let pagesCache = null;
  async function sitePages() {
    if (!pagesCache) pagesCache = api('GET', 'pages').then((r) => r.pages).catch(() => []);
    return pagesCache;
  }
  async function openLink() {
    const el = sel?.el;
    if (!el) return;
    const s = getSelection();
    savedRange = s.rangeCount ? s.getRangeAt(0).cloneRange() : null;
    let a = linkOf(el);
    if (!a && savedRange) {
      const n = savedRange.startContainer;
      a = (n.nodeType === 1 ? n : n.parentElement).closest('a');
      if (a && !el.contains(a)) a = null;
    }
    if (!a && (!savedRange || savedRange.collapsed)) { toast('Select some words first, then add the link.'); return; }
    const pages = await sitePages();
    showPop(el, `<form><label for="u">Link to</label>
      <input id="u" name="href" type="text" list="pg" value="${esc(a ? a.getAttribute('href') : '')}" placeholder="/contact/ or https://…" autocomplete="off">
      <datalist id="pg">${pages.map((p) => `<option value="${esc(p.path)}">`).join('')}</datalist>
      <div class="row end">${a && isRich(el) ? '<button class="btn danger" type="submit" value="remove">Remove link</button>' : ''}
      <button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="submit" value="ok">Apply</button></div></form>`,
    (fd, how) => {
      const href = String(fd.get('href') || '').trim();
      const region = regionOf(el);
      const apply = () => {
        if (how === 'remove' && a) { a.replaceWith(...a.childNodes); return; }
        if (!href) return;
        // Browsers ignore tabs, newlines and control characters in a URL ("java\tscript:"): strip them before checking.
        if (/^(javascript|data|vbscript):/i.test(href.replace(/[\u0000- ]/g, ''))) { toast('That kind of link isn’t allowed.', true); return; }
        if (a) { a.setAttribute('href', href); return; }
        if (savedRange) {
          const s2 = getSelection();
          s2.removeAllRanges();
          s2.addRange(savedRange);
          d.execCommand('createLink', false, href);
        }
      };
      if (editing === el) {
        el.focus({ preventScroll: true });
        apply();
        markDirty(region);
      } else mutate(region, apply);
      closePop();
    });
    emit('pop:link', R.pop.querySelector('form'), { el, link: a });
  }
  function openAlt(img) {
    showPop(img, `<form><label for="alt">Alt text: describe the image for screen readers and Google</label>
      <input id="alt" name="alt" type="text" value="${esc(img.getAttribute('alt') || '')}" maxlength="250">
      <div class="row end"><button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="submit">Save</button></div></form>`,
    (fd) => { mutate(regionOf(img), () => img.setAttribute('alt', String(fd.get('alt') || '').trim())); closePop(); });
  }

  /* ---------------------------------------------------------------- images */
  async function optimise(file, maxW) {
    if (!/^image\/(jpeg|png|webp|avif)$/.test(file.type)) return { blob: file, type: file.type };
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxW / bmp.width);
    const w = Math.round(bmp.width * scale);
    const h = Math.round(bmp.height * scale);
    const c = d.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(bmp, 0, 0, w, h);
    const blob = await new Promise((res) => c.toBlob(res, 'image/webp', 0.82));
    return blob ? { blob, w, h, type: 'image/webp' } : { blob: file, w: bmp.width, h: bmp.height, type: file.type };
  }
  function naturalSize(url) {
    return new Promise((res) => { const i = new Image(); i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight }); i.onerror = () => res({}); i.src = url; });
  }
  let mediaCache = null;
  function openImage(img) {
    finishEdit();
    const region = regionOf(img);
    const shown = img.getBoundingClientRect().width || 800;
    pickImage({ current: img.currentSrc || img.src, alt: img.getAttribute('alt') || '', maxW: Math.min(2400, Math.max(1000, Math.round(shown * 2))) }).then((chosen) => {
      if (!chosen) return;
      mutate(region, () => {
        img.src = chosen.url;
        img.removeAttribute('srcset');
        img.removeAttribute('sizes');
        img.closest('picture')?.querySelectorAll('source').forEach((s) => s.remove());
        if (chosen.w && chosen.h) {
          if (img.hasAttribute('width')) img.setAttribute('width', chosen.w);
          if (img.hasAttribute('height')) img.setAttribute('height', chosen.h);
        }
        img.setAttribute('alt', chosen.alt);
      });
      toast('Image replaced.');
    });
  }
  /** Opens the upload / library picker. Resolves to { url, w, h, alt } or null if cancelled. */
  function pickImage({ current = '', alt = '', maxW = 2000, title = 'Replace image', withAlt = true } = {}) {
    finishEdit();
    let chosen = null;
    let done;
    const result = new Promise((res) => { done = res; });
    dismissHint();
    R.scrim.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="ph"><h2>${esc(title)}</h2>${btn('x', 'Close', 'close')}</div>
      <div class="mb"><div class="mpane">
        <div class="tabs"><button class="on" data-tab="up">Upload</button><button data-tab="lib">Library</button></div>
        <div data-pane="up"><label class="drop" tabindex="0">${icon('upload')}<b>Drop an image here or click to choose</b>
          <span class="muted">JPG, PNG, WebP or AVIF. It’s resized and converted to WebP for you.</span>
          <input type="file" accept="image/jpeg,image/png,image/webp,image/avif,image/gif" hidden></label></div>
        <div data-pane="lib" hidden><p class="muted">Loading…</p></div>
      </div><div class="mside">
        <div class="preview"><img alt="" src="${esc(current)}"></div>
        ${withAlt ? `<div><label class="muted" for="alt2">Alt text</label><input id="alt2" type="text" maxlength="250" value="${esc(alt)}" placeholder="Describe the image"></div>` : ''}
        <p class="muted" data-r="mstatus">Pick an image to use.</p>
      </div></div>
      <div class="mf"><button class="btn" data-act="close">Cancel</button><button class="btn primary" data-act="use" disabled>Use this image</button></div></div>`;
    R.scrim.classList.add('show');
    const m = R.scrim;
    const preview = m.querySelector('.preview img');
    const useBtn = m.querySelector('[data-act="use"]');
    const mstatus = m.querySelector('[data-r="mstatus"]');
    const ac = new AbortController();
    const close = (value = null) => { ac.abort(); R.scrim.classList.remove('show'); R.scrim.innerHTML = ''; done(value); };
    const choose = (c) => { chosen = c; preview.src = c.url; useBtn.disabled = false; mstatus.textContent = c.w ? `${c.w} × ${c.h}px` : 'Ready.'; };
    m.addEventListener('click', (e) => {
      if (e.target === m) close();
      const a = e.target.closest('[data-act]')?.dataset.act;
      if (a === 'close') close();
      if (a === 'use' && chosen) close({ ...chosen, alt: m.querySelector('#alt2')?.value.trim() ?? alt });
      const tab = e.target.closest('[data-tab]')?.dataset.tab;
      if (tab) {
        m.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
        m.querySelectorAll('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== tab; });
        if (tab === 'lib') loadLibrary(m.querySelector('[data-pane="lib"]'), choose);
      }
    }, { signal: ac.signal });
    const input = m.querySelector('input[type=file]');
    const drop = m.querySelector('.drop');
    const handle = async (file) => {
      if (!file) return;
      try {
        mstatus.textContent = 'Optimising…';
        useBtn.disabled = true;
        const o = await optimise(file, maxW);
        preview.src = URL.createObjectURL(o.blob);
        mstatus.textContent = 'Uploading…';
        const fd = new FormData();
        const base = file.name.replace(/\.[^.]+$/, '');
        fd.append('file', new File([o.blob], `${base}.${o.type.split('/')[1]}`, { type: o.type }));
        fd.append('name', base);
        if (o.w) { fd.append('width', o.w); fd.append('height', o.h); }
        const r = await api('POST', 'media', fd);
        mediaCache = null;
        choose({ url: r.url, w: r.width, h: r.height });
      } catch (err) {
        mstatus.textContent = err.message;
        toast(`Upload failed: ${err.message}`, true);
      }
    };
    input.addEventListener('change', () => handle(input.files[0]));
    drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); handle(e.dataTransfer.files[0]); });
    return result;
  }
  /** A centred dialog. Returns { el, close }. Clicks on [data-act="close"] or the backdrop close it. */
  function modal({ title, body = '', foot = '', label: aria, onClose } = {}) {
    finishEdit();
    const ac = new AbortController();
    dismissHint();
    R.scrim.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${esc(aria || title)}">
      <div class="ph"><h2>${esc(title)}</h2>${btn('x', 'Close', 'close')}</div><div class="mb">${body}</div>${foot ? `<div class="mf">${foot}</div>` : ''}</div>`;
    R.scrim.classList.add('show');
    const close = () => { ac.abort(); R.scrim.classList.remove('show'); R.scrim.innerHTML = ''; onClose?.(); };
    R.scrim.addEventListener('click', (e) => {
      if (e.target === R.scrim || e.target.closest('[data-act="close"]')) close();
    }, { signal: ac.signal });
    return { el: R.scrim.querySelector('.modal'), close };
  }
  async function loadLibrary(pane, choose) {
    if (pane.__loaded) return;
    pane.__loaded = true;
    try {
      mediaCache = mediaCache || (await api('GET', 'media'));
      const all = [...mediaCache.uploads.map((u) => ({ ...u, up: true })), ...(mediaCache.site || [])];
      if (!all.length) { pane.innerHTML = '<p class="muted">No images yet. Upload one.</p>'; return; }
      const grid = (list) => `<div class="grid">${list.map((u) => `<button title="${esc(u.name || u.url)}" data-url="${esc(u.url)}" data-w="${u.width || ''}" data-h="${u.height || ''}"><img loading="lazy" alt="" src="${esc(u.url)}"></button>`).join('')}</div>`;
      pane.innerHTML = (mediaCache.uploads.length ? `<p class="h3" style="margin-top:0">Uploaded</p>${grid(mediaCache.uploads)}` : '')
        + (mediaCache.site?.length ? `<p class="h3">On the site</p>${grid(mediaCache.site)}` : '');
      pane.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-url]');
        if (!b) return;
        pane.querySelectorAll('.on').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        let w = +b.dataset.w;
        let h = +b.dataset.h;
        if (!w) ({ w, h } = await naturalSize(b.dataset.url));
        choose({ url: b.dataset.url, w, h });
      });
    } catch (e) {
      pane.innerHTML = `<p class="muted">${esc(e.message)}</p>`;
    }
  }

  /* ---------------------------------------------------------------- bottom bar */
  function drawBar() {
    const st = {
      live: ['', 'Published', 'Visitors see this version'],
      draft: ['draft', 'Unpublished changes', 'Only editors can see them'],
      unsaved: ['busy', 'Saving…', ''],
      saving: ['busy', 'Saving…', ''],
      publishing: ['busy', 'Publishing…', ''],
      error: ['err', 'Not saved', 'Check your connection'],
    }[status] || ['', status, ''];
    const admin = S.user.role === 'admin';
    const extraButtons = barButtons.filter((b) => (!b.adminOnly || admin) && (!b.when || b.when())).sort((a, b) => (a.order || 50) - (b.order || 50));
    const pub = publishButton || { text: 'Publish', title: 'Make your changes live', icon: 'send' };
    R.bar.innerHTML = `<div class="status" title="${esc(st[2])}"><i class="dot ${st[0]}"></i><b>${esc(st[1])}</b><span>${esc(S.path)}</span></div>
      <span class="sep"></span>${btn('undo', 'Undo (Ctrl+Z)', 'undo')}${btn('redo', 'Redo (Ctrl+Shift+Z)', 'redo')}<span class="sep"></span>
      ${btn('pages', 'Pages', 'p-pages')}${btn('settings', 'Page settings (title, description)', 'p-settings')}${btn('history', 'History', 'p-history')}
      ${extraButtons.map((b) => btn(b.icon, val(b.title), b.panel ? `p-${b.panel}` : `b-${b.id}`, `xb ${b.cls || ''}`)).join('')}
      ${extraButtons.length ? btn('more', 'More', 'more', 'more-btn') : ''}
      ${admin ? btn('users', 'Editors', 'p-users') : ''}<span class="sep"></span>
      <button class="btn primary" data-act="publish" ${['draft', 'unsaved', 'saving', 'error'].includes(status) ? '' : 'disabled'} title="${esc(pub.title)}">${icon(pub.icon || 'send')}<span class="wide">${esc(pub.text)}</span></button>
      ${btn('exit', 'Stop editing', 'exit')}`;
    emit('bar', R.bar);
    R.bar.querySelector('[data-act="undo"]').disabled = !undoStack.length;
    R.bar.querySelector('[data-act="redo"]').disabled = !redoStack.length;
  }
  R.bar.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-act]')?.dataset.act;
    if (!a) return;
    if (a === 'undo') undo();
    if (a === 'redo') redo();
    if (a === 'more') { openMore(e.target.closest('[data-act]')); return; }
    if (a === 'publish') (publishButton?.run || publishNow)();
    if (a.startsWith('b-')) barButtons.find((b) => `b-${b.id}` === a)?.run?.();
    if (a === 'exit') { finishEdit(); await save(); location.href = S.path; }
    if (a.startsWith('p-')) togglePanel(a.slice(2));
  });
  R.bar.addEventListener('mousedown', (e) => { if (editing) e.preventDefault(); });

  /* On narrow screens the feature buttons fold into a "More" menu so the bar fits a phone. */
  function openMore(anchor) {
    dismissHint();
    if (R.pop.classList.contains('show') && R.pop.__more) { closePop(); return; }
    const admin = S.user.role === 'admin';
    const list = barButtons.filter((b) => (!b.adminOnly || admin) && (!b.when || b.when())).sort((a, b) => (a.order || 50) - (b.order || 50));
    R.pop.innerHTML = `<div class="menu">${list.map((b) => `<button type="button" data-more="${b.panel ? `p-${b.panel}` : `b-${b.id}`}">${icon(b.icon)}<span>${esc(val(b.title))}</span></button>`).join('')}</div>`;
    R.pop.__anchor = anchor;
    R.pop.__more = true;
    R.pop.classList.add('show');
    positionBar(R.pop, anchor.getBoundingClientRect(), 'above');
    R.pop.querySelector('.menu').addEventListener('click', (e) => {
      const a = e.target.closest('[data-more]')?.dataset.more;
      if (!a) return;
      closePop();
      if (a.startsWith('p-')) togglePanel(a.slice(2));
      else barButtons.find((b) => `b-${b.id}` === a)?.run?.();
    });
  }
  /* Bottom-bar buttons from features: { id, icon, title, panel? | run?, adminOnly, when, order }. */
  const barButtons = [];
  let publishButton = null;  // a feature may replace Publish (e.g. "Submit for review" for authors)
  async function publishNow({ all = false, skipChecks = false } = {}) {
    finishEdit();
    await save();
    if (dirty.size || metaDirty || extras.size) return;
    if (!skipChecks) {
      // Features can stop a publish (pre-publish checks) by resolving false.
      for (const fn of hooks['publish:before'] || []) {
        let ok = true;
        try { ok = await fn({ all }); } catch (err) { console.error('vibecms: publish check failed', err); }
        if (ok === false) return;
      }
    }
    setStatus('publishing');
    try {
      const r = await api('POST', 'publish', { path: S.path, all });
      emit('published', { all, count: r.published });
      S.hasDraft = false;
      setStatus('live');
      toast(r.published ? 'Published. Visitors see your changes now.' : 'Nothing new to publish.');
    } catch (err) {
      setStatus('draft');
      toast(`Couldn’t publish: ${err.message}`, true);
    }
  }

  addEventListener('beforeunload', (e) => {
    if (editing) finishEdit();
    if (dirty.size || metaDirty || extras.size || saving) {
      const regions = {};
      for (const key of dirty) { const r = regionByKey(key); if (r) regions[key] = { html: regionHtml(r), base: r.getAttribute('data-cms-v') || null }; }
      if (metaDirty) regions['#meta'] = { meta: S.meta };
      for (const [k, v] of extras) regions[k] = v;
      fetch('/_cms/api/draft', { method: 'PUT', keepalive: true, credentials: 'same-origin', headers: { 'x-vibecms': '1', 'content-type': 'application/json' }, body: JSON.stringify({ path: S.path, regions }) }).catch(() => {});
      e.preventDefault();
    }
  });

  /* ---------------------------------------------------------------- panels */
  let panelName = '';
  function closePanel() { R.panel.classList.remove('show'); panelName = ''; }
  function openPanel(title, body) {
    dismissHint();
    R.panel.innerHTML = `<div class="ph"><h2>${esc(title)}</h2>${btn('x', 'Close', 'close')}</div><div class="pb">${body}</div>`;
    R.panel.classList.add('show');
    R.panel.querySelector('[data-act="close"]').addEventListener('click', closePanel);
    return R.panel.querySelector('.pb');
  }
  function togglePanel(name) {
    if (panelName === name) { closePanel(); return; }
    finishEdit();
    panelName = name;
    panels[name]?.();
  }
  const panels = {};
  const when = (ms) => new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  async function pagesPanel() {
    const pb = openPanel('Pages', '<p>Loading…</p>');
    pagesCache = null;
    const pages = await sitePages();
    pagesCache = null;
    const otherDrafts = pages.filter((p) => p.draft && p.path !== S.path).length;
    pb.innerHTML = `<p>Pick a page to edit. <span class="pill">Draft</span> marks pages with unpublished changes.</p>
      ${otherDrafts ? `<div class="note">${otherDrafts} other page${otherDrafts === 1 ? ' has' : 's have'} unpublished changes. <button class="btn" data-pub-all>Publish all pages</button></div>` : ''}
      <ul class="list">${pages.map((p) => `<li><a href="${esc(p.path)}?edit" data-go="${esc(p.path)}"><span class="grow"><b>${esc(p.path === '/' ? 'Home' : p.path)}</b></span>
      ${p.path === S.path ? '<span class="pill cur">Open</span>' : ''}${p.draft ? '<span class="pill">Draft</span>' : ''}</a></li>`).join('')}</ul>
      <form method="post" action="/_cms/logout" style="margin-top:18px"><button class="btn" type="submit">${icon('exit')}Sign out (${esc(S.user.email)})</button></form>`;
    emit('panel:pages', pb, pages);
    pb.addEventListener('click', async (e) => {
      if (e.target.closest('[data-pub-all]')) {
        if (confirm('Publish the unpublished changes on every page?')) { closePanel(); await publishNow({ all: true }); }
        return;
      }
      const a = e.target.closest('[data-go]');
      if (!a) return;
      e.preventDefault();
      finishEdit();
      await save();
      location.href = `${a.dataset.go}?edit`;
    });
  }

  function settingsPanel() {
    const m = { title: S.meta.title || d.title, description: S.meta.description || d.querySelector('meta[name="description"]')?.content || '', shareTitle: S.meta.shareTitle || d.querySelector('meta[property="og:title"]')?.content || '' };
    const pb = openPanel('Page settings', `
      <p>How this page appears in Google and when it’s shared.</p>
      <div class="serp"><div class="u">${esc(location.host + S.path)}</div><div class="t" data-p="t"></div><div class="d" data-p="d"></div></div>
      <form>
      <div class="field"><label for="ti">Title <small data-c="title"></small></label><input id="ti" name="title" type="text" maxlength="200" value="${esc(m.title)}"></div>
      <div class="field"><label for="de">Description <small data-c="description"></small></label><textarea id="de" name="description" maxlength="500">${esc(m.description)}</textarea></div>
      <div class="field"><label for="sh">Share title <small>LinkedIn, Facebook, X</small></label><input id="sh" name="shareTitle" type="text" maxlength="200" value="${esc(m.shareTitle)}"></div>
      <div class="row end"><button class="btn primary" type="submit">Save settings</button></div></form>`);
    const form = pb.querySelector('form');
    const counts = { title: [50, 60], description: [140, 160] };
    const sync = () => {
      const fd = new FormData(form);
      pb.querySelector('[data-p="t"]').textContent = fd.get('title');
      pb.querySelector('[data-p="d"]').textContent = fd.get('description');
      for (const [k, [lo, hi]] of Object.entries(counts)) {
        const n = String(fd.get(k)).length;
        const c = pb.querySelector(`[data-c="${k}"]`);
        c.textContent = `${n} characters (aim for ${lo}–${hi})`;
        c.className = n > hi || n < lo ? 'over' : '';
      }
    };
    form.addEventListener('input', sync);
    sync();
    emit('panel:settings', pb);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      S.meta = { title: String(fd.get('title')).trim(), description: String(fd.get('description')).trim(), shareTitle: String(fd.get('shareTitle')).trim() };
      if (S.meta.title) d.title = S.meta.title;
      metaDirty = true;
      setStatus('unsaved');
      save();
      toast('Page settings saved as a draft. Publish to make them live.');
    });
  }

  async function historyPanel() {
    const pb = openPanel('History', '<p>Loading…</p>');
    try {
      const { versions } = await api('GET', `history?path=${encodeURIComponent(S.path)}`);
      pb.innerHTML = `<p>Every publish is kept. Restoring loads that version as a draft so you can check it, then publish.</p>
        ${versions.length ? `<ul class="list">${versions.map((v) => `<li><span class="grow"><b>${esc(when(v.at))}</b><span>${esc(v.by || '')} · ${esc(v.parts.join(', '))}</span></span>
          <button class="btn" data-restore="${esc(v.batch)}">Restore</button></li>`).join('')}</ul>` : '<p class="note">Nothing published from here yet.</p>'}
        <p class="h3">Start over</p>
        <div class="row" style="flex-wrap:wrap"><button class="btn" data-x="discard" ${S.hasDraft || dirty.size ? '' : 'disabled'}>Discard unpublished changes</button>
        <button class="btn danger" data-x="reset">Reset page to the original</button></div>`;
      pb.addEventListener('click', async (e) => {
        const r = e.target.closest('[data-restore]');
        const x = e.target.closest('[data-x]')?.dataset.x;
        try {
          if (r) { await save(); await api('POST', 'restore', { path: S.path, batch: r.dataset.restore }); location.reload(); }
          if (x === 'discard' && confirm('Throw away all unpublished changes on this page, and on the parts shared by every page (header, footer, shared sections and site styles)?')) {
            dirty.clear(); metaDirty = false; extras.clear(); clearTimeout(saveTimer);
            await api('POST', 'discard', { path: S.path, includeSiteWide: true });
            location.reload();
          }
          if (x === 'reset' && confirm('Remove every edit made to this page in the editor and go back to the original version? Published edits disappear for visitors too. The site-wide header and footer are not affected.')) {
            dirty.clear(); metaDirty = false; extras.clear(); clearTimeout(saveTimer);
            await api('POST', 'reset', { path: S.path });
            location.reload();
          }
        } catch (err) { toast(err.message, true); }
      });
      emit('panel:history', pb, versions);
    } catch (err) {
      pb.innerHTML = `<p class="note">${esc(err.message)}</p>`;
    }
  }

  async function usersPanel() {
    const pb = openPanel('Editors', '<p>Loading…</p>');
    const render = async (link) => {
      const { users } = await api('GET', 'users');
      pb.innerHTML = `${link ? `<div class="note"><b>Invite link ready.</b> Send it to them yourself. It works once, for 7 days.<div class="copy"><input type="text" readonly value="${esc(link)}"><button class="btn" data-copy>Copy</button></div></div>` : ''}
        <ul class="list">${users.map((u) => `<li><span class="grow"><b>${esc(u.name || u.email)}</b><span>${esc(u.email)} · ${u.role}${u.active ? '' : ' · invited'}</span></span>
          ${u.email === S.user.email ? '<span class="pill cur">You</span>' : `<button class="btn" data-reinvite="${esc(u.email)}" data-name="${esc(u.name || '')}" data-role="${u.role}" title="New invite link (also resets their password)">Link</button><button class="ib danger" data-remove="${u.id}" title="Remove">${icon('trash')}</button>`}</li>`).join('')}</ul>
        <p class="h3">Invite an editor</p>
        <form><div class="field"><label for="ie">Email</label><input id="ie" name="email" type="email" required></div>
        <div class="field"><label for="in">Name</label><input id="in" name="name" type="text"></div>
        <div class="field"><label for="ir">Role</label><select id="ir" name="role"><option value="editor">Editor: edits and publishes pages</option><option value="admin">Admin: also manages editors</option></select></div>
        <div class="row end"><button class="btn primary" type="submit">Create invite link</button></div></form>`;
      emit('panel:users', pb, { users, link });
    };
    try { await render(); } catch (err) { pb.innerHTML = `<p class="note">${esc(err.message)}</p>`; return; }
    pb.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try { const r = await api('POST', 'users', Object.fromEntries(fd)); await render(r.link); } catch (err) { toast(err.message, true); }
    });
    pb.addEventListener('click', async (e) => {
      const t = e.target.closest('button');
      if (!t) return;
      try {
        if (t.dataset.copy !== undefined) { const i = pb.querySelector('.copy input'); i.select(); await navigator.clipboard.writeText(i.value).catch(() => d.execCommand('copy')); toast('Link copied.'); }
        if (t.dataset.reinvite) { const r = await api('POST', 'users', { email: t.dataset.reinvite, name: t.dataset.name, role: t.dataset.role }); await render(r.link); }
        if (t.dataset.remove && confirm('Remove this editor? They’ll be signed out.')) { await api('DELETE', 'users', { id: +t.dataset.remove }); await render(); }
      } catch (err) { toast(err.message, true); }
    });
  }

  async function openAddSection(after) {
    panelName = 'add';
    const region = regionOf(after);
    const pb = openPanel('Add a section', '<p>Loading…</p>');
    const pages = await sitePages();
    pb.innerHTML = `<p>Copy a section from any page. It’s added below the one you picked, then you edit the words and pictures.</p>
      <div class="field"><label for="from">From page</label><select id="from">${pages.map((p) => `<option value="${esc(p.path)}" ${p.path === S.path ? 'selected' : ''}>${esc(p.path === '/' ? 'Home' : p.path)}</option>`).join('')}</select></div>
      <ul class="list" data-r="secs"></ul>`;
    const list = pb.querySelector('[data-r="secs"]');
    let sections = [];
    const load = async (path) => {
      list.innerHTML = '<li><span class="grow"><span>Loading…</span></span></li>';
      try {
        let src;
        if (path === S.path) src = region;
        else {
          const html = await (await fetch(path, { credentials: 'same-origin' })).text();
          const doc2 = new DOMParser().parseFromString(html, 'text/html');
          src = doc2.querySelector(`[data-cms="${CSS.escape(keyOf(region))}"]`) || doc2.querySelector('[data-cms]:not([data-cms^="@"])');
        }
        sections = src ? [...src.children].filter((c) => c.nodeType === 1 && !/^(SCRIPT|STYLE|TEMPLATE)$/.test(c.tagName)) : [];
        list.innerHTML = sections.length ? sections.map((s, i) => {
          const hd = s.querySelector('h1,h2,h3,h4')?.textContent.trim().replace(/\s+/g, ' ') || s.getAttribute('aria-label') || `${s.tagName.toLowerCase()}.${[...s.classList].join('.')}`;
          return `<li><span class="grow"><b>${esc(hd.slice(0, 80))}</b><span>${esc([...s.classList].join(' ') || s.tagName.toLowerCase())}</span></span><button class="btn" data-ins="${i}">Add</button></li>`;
        }).join('') : '<li><span class="grow"><span>No sections found on that page.</span></span></li>';
      } catch (err) { list.innerHTML = `<li><span class="grow"><span>${esc(err.message)}</span></span></li>`; }
    };
    pb.querySelector('#from').addEventListener('change', (e) => load(e.target.value));
    list.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ins]');
      if (!b) return;
      const node = stripJunk(d.importNode(sections[+b.dataset.ins], true));
      node.removeAttribute('data-cms-hidden');
      notePageTags(node);
      mutate(region, () => after.after(node));
      openDetails();
      closePanel();
      node.scrollIntoView({ behavior: 'smooth', block: 'start' });
      toast('Section added. Click any text in it to change it.');
    });
    load(S.path);
  }

  /* ---------------------------------------------------------------- conflicts */
  const conflicts = Object.entries(S.regions || {}).filter(([, v]) => v.conflict).map(([k]) => k);
  if (conflicts.length) {
    R.banner.innerHTML = `<p>The developer changed ${conflicts.some((k) => !k.startsWith('@')) ? 'this page' : 'the site-wide header or footer'} after it was last edited here. You’re seeing the edited version, so their changes aren’t shown.</p>
      <button class="btn" data-k="keep">Keep the edited version</button>${conflicts.some((k) => !k.startsWith('@')) ? '<button class="btn danger" data-k="theirs">Use the developer’s version</button>' : ''}`;
    R.banner.classList.add('show');
    R.banner.addEventListener('click', async (e) => {
      const k = e.target.closest('[data-k]')?.dataset.k;
      if (k === 'keep') { conflicts.forEach((key) => { const r = regionByKey(key); if (r) dirty.add(key); }); setStatus('unsaved'); await save(); R.banner.classList.remove('show'); toast('Kept. Publish to update the live page.'); }
      if (k === 'theirs' && confirm('Drop the edits on this page and use the developer’s new version?')) { await api('POST', 'reset', { path: S.path }); location.reload(); }
    });
  }

  Object.assign(panels, { pages: pagesPanel, settings: settingsPanel, history: historyPanel, users: usersPanel });

  /* ---------------------------------------------------------------- core API for features */
  const core = {
    S, d, R, root, host, P, icon, esc, btn, api, toast, when, val,
    on, emit,
    // regions and structure
    keyOf, regionOf, regionByKey, pageRegionOf, isGlobal, locked, sectionFor, itemFor, textBlockFor, classify, label,
    regionHtml, stripJunk, notePageTags, openDetails, isRich, linkOf,
    // editing
    mutate, markDirty, pushUndo, save, setExtra, setStatus, finishEdit, startEdit, select, queueDraw, publishNow,
    get sel() { return sel; },
    get editing() { return editing; },
    get status() { return status; },
    get dirty() { return dirty.size > 0 || metaDirty || extras.size > 0; },
    // UI
    openPanel, closePanel, togglePanel, showPop, closePop, positionBar, modal, pickImage, openImage, sitePages,
    clearPagesCache() { pagesCache = null; },
    addIcons(map) { Object.assign(P, map); },
    addClassifier(fn) { classifiers.push(fn); },
    addSectionAction(spec) { const i = sectionActions.findIndex((a) => a.act === spec.act); if (i >= 0) sectionActions[i] = { ...sectionActions[i], ...spec }; else sectionActions.push({ order: 70, ...spec }); sbarFor = null; queueDraw(); },
    addToolAction(spec) { const i = toolActions.findIndex((a) => a.act === spec.act); if (i >= 0) toolActions[i] = spec; else toolActions.push(spec); tbarKey = ''; queueDraw(); },
    addBarButton(spec) { barButtons.push(spec); drawBar(); },
    addPanel(name, fn) { panels[name] = fn; },
    setPublishButton(spec) { publishButton = spec; drawBar(); },
    beforePublish(fn) { return on('publish:before', fn); },
    redrawSectionBar() { sbarFor = null; queueDraw(); },
    redrawToolbar() { tbarKey = ''; queueDraw(); },
  };

  /*__FEATURES__*/

  for (const [name, setup] of features) {
    try { setup(core); } catch (err) { console.error(`vibecms: feature "${name}" failed to start`, err); }
  }
  emit('ready');

  drawBar();
  queueDraw();
  if (!sessionStorage.getItem('vibecms-hint')) {
    toast('Click any text to change it. Click a picture to replace it.');
    hintShowing = true;
    try { sessionStorage.setItem('vibecms-hint', '1'); } catch { /* private mode */ }
  }
})();
