/* Vibe CMS, source mode (Phase 0). One script tag on any site:
 *   <script src="https://<service>/vibe.js" async></script>
 * Visitors: checks for a sign-in hand-off and stops. Editors: freezes the rendered page (so React/Vue stop
 * redrawing it), lets them click any text and type, and sends each change to the service, which finds the text in
 * the site's source code. Publish commits the changes; the site's own deploy puts them live.
 */
(() => {
  if (window.__vibecms) return;
  window.__vibecms = true;
  const me = document.currentScript || [...document.scripts].find((s) => /\/vibe\.js(\?|$)/.test(s.src));
  if (!me) return;
  const API = new URL(me.src).origin;
  const KEY = 'vibecms:' + API;

  const store = {
    get() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } },
    set(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch {} },
    patch(v) { this.set({ ...this.get(), ...v }); },
  };

  const norm = (s) => String(s || '').replace(/[\s ​]+/g, ' ').trim();

  async function api(method, route, body) {
    const { token } = store.get();
    const r = await fetch(API + '/api/' + route, {
      method,
      headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await r.json().catch(() => ({}));
    if (r.status === 401 && route !== 'handoff') { store.set({}); }
    if (!r.ok) throw new Error(data.error || 'Request failed (' + r.status + ')');
    return data;
  }

  async function boot() {
    const m = /[#&]vibe=([\w-]+)/.exec(location.hash);
    if (m) {
      history.replaceState(null, '', location.pathname + location.search);
      try {
        const { token, user } = await api('POST', 'handoff', { code: m[1] });
        store.set({ token, user, edit: true });
      } catch (e) { alert('Vibe CMS: ' + e.message); return; }
    }
    const st = store.get();
    if (!st.token) return;
    await settled();
    if (st.edit) startEditor(); else showLauncher();
  }

  /** Waits until the app has rendered: page loaded, then a quiet moment. */
  function settled() {
    return new Promise((resolve) => {
      const go = () => setTimeout(() => (window.requestIdleCallback || setTimeout)(resolve, { timeout: 1500 }), 400);
      if (document.readyState === 'complete') go(); else addEventListener('load', go, { once: true });
    });
  }

  // ---------- UI shell (shadow root, so the site's CSS and ours never mix)
  let host, root;
  function shell() {
    host = document.createElement('vibe-cms');
    host.style.cssText = 'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483646';
    root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${CSS}</style><div class="hover"></div><div class="focus"></div><div class="bar" part="bar"></div><div class="toasts"></div><div class="modal-wrap"></div>`;
    document.documentElement.appendChild(host);
  }

  const CSS = `
    :host { --ink:#14161a; --muted:#5d636e; --line:#e3e5e9; --bg:#ffffff; --accent:#2f6df6; --ok:#13804b; --warn:#a15c00; --bad:#b42318;
      font: 14px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--ink); }
    @media (prefers-color-scheme: dark) { :host { --ink:#eceef2; --muted:#a3a9b4; --line:#30343b; --bg:#1b1e23; --accent:#6d9bff; --ok:#4cc38a; --warn:#f0a94b; --bad:#ff7b72; } }
    * { box-sizing: border-box; }
    .bar, .toasts, .modal-wrap { font: 14px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--ink); text-align: left; letter-spacing: normal; text-transform: none; }
    .hover, .focus { position: fixed; pointer-events: none; border-radius: 4px; display: none; }
    .hover { outline: 2px dashed var(--accent); outline-offset: 2px; }
    .focus { outline: 2px solid var(--accent); outline-offset: 3px; }
    .bar { position: fixed; left: 50%; bottom: max(12px, env(safe-area-inset-bottom)); transform: translateX(-50%);
      pointer-events: auto; display: flex; align-items: center; gap: 6px; padding: 6px; max-width: calc(100vw - 24px);
      background: var(--bg); border: 1px solid var(--line); border-radius: 14px; box-shadow: 0 8px 30px rgba(0,0,0,.18); }
    .brand { font-weight: 650; padding: 0 8px; white-space: nowrap; }
    .status { color: var(--muted); padding: 0 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 34vw; }
    .status.building { color: var(--warn); } .status.live { color: var(--ok); } .status.failed { color: var(--bad); }
    button, select { font: inherit; color: var(--ink); background: transparent; border: 1px solid var(--line); border-radius: 10px;
      padding: 7px 12px; min-height: 36px; cursor: pointer; }
    button:hover, select:hover { border-color: var(--muted); }
    button.primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
    button.primary:disabled { opacity: .5; cursor: default; }
    select { max-width: 30vw; }
    .toasts { position: fixed; right: 12px; top: 12px; display: grid; gap: 8px; pointer-events: none; max-width: min(420px, calc(100vw - 24px)); }
    .toast { pointer-events: auto; background: var(--bg); border: 1px solid var(--line); border-left: 4px solid var(--accent);
      border-radius: 10px; padding: 10px 12px; box-shadow: 0 6px 20px rgba(0,0,0,.15); }
    .toast.ok { border-left-color: var(--ok); } .toast.warn { border-left-color: var(--warn); } .toast.bad { border-left-color: var(--bad); }
    .toast code, .modal code { font: 12px/1.4 ui-monospace, Consolas, monospace; color: var(--muted); }
    .modal-wrap:not(:empty) { position: fixed; inset: 0; background: rgba(0,0,0,.35); pointer-events: auto; display: grid; place-items: center; padding: 16px; }
    .modal { background: var(--bg); border: 1px solid var(--line); border-radius: 14px; width: min(560px, 100%); max-height: 80vh; overflow: auto; padding: 18px; }
    .modal h2 { margin: 0 0 6px; font-size: 17px; }
    .modal p { margin: 0 0 12px; color: var(--muted); }
    .opt { display: block; width: 100%; text-align: left; margin: 0 0 8px; }
    .opt b { display: block; font-weight: 600; }
    .row { display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px; flex-wrap: wrap; }
    .list { margin: 0; padding: 0; list-style: none; }
    .list li { border-top: 1px solid var(--line); padding: 10px 0; display: flex; gap: 10px; align-items: start; justify-content: space-between; }
    .list .t { min-width: 0; } .list .t s { color: var(--muted); } .list .t div { overflow-wrap: anywhere; }
    @media (max-width: 560px) {
      .brand, .status { display: none; }
      .bar { gap: 4px; padding: 5px; }
      button, select { padding: 7px 9px; }
      select { max-width: 32vw; }
      .bar.building [data-a=publish]::after { content: "…"; }
    }
  `;

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function toast(html, kind = '', ms = 4500) {
    const t = document.createElement('div');
    t.className = 'toast ' + kind;
    t.innerHTML = html;
    root.querySelector('.toasts').appendChild(t);
    if (ms) setTimeout(() => t.remove(), ms);
    return t;
  }
  function modal(html) {
    const wrap = root.querySelector('.modal-wrap');
    wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
    const close = () => { wrap.innerHTML = ''; };
    wrap.onclick = (e) => { if (e.target === wrap) close(); };
    return { el: wrap.firstElementChild, close };
  }

  // ---------- signed in, not editing: one button
  function showLauncher() {
    shell();
    const bar = root.querySelector('.bar');
    bar.innerHTML = `<button class="primary" data-a="edit">Edit page</button>`;
    bar.querySelector('[data-a=edit]').onclick = () => { store.patch({ edit: true }); location.reload(); };
  }

  // ---------- edit mode
  let state = { drafts: [], deploy: {} };
  let editing = null; // { el, originals: Map<Text, string> }
  const snapshots = new WeakMap(); // element -> its content when editing started
  const editing_snapshot = (el) => snapshots.get(el);

  function freeze() {
    // A copy of the rendered page has no event listeners, so the app can't redraw or navigate it.
    const live = document.body;
    const frozen = live.cloneNode(true);
    live.replaceWith(frozen);
    // things the app would have revealed on scroll: show them
    for (const el of frozen.querySelectorAll('[style*="opacity"]')) {
      if (parseFloat(el.style.opacity) < 0.05 && norm(el.textContent)) { el.style.opacity = '1'; el.style.transform = 'none'; }
    }
    for (const d of frozen.querySelectorAll('details:not([open])')) d.open = true;
    frozen.querySelectorAll('[autofocus]').forEach((el) => el.removeAttribute('autofocus'));
  }

  function textNodes(scope) {
    const out = [];
    const w = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => {
        const p = n.parentElement;
        if (!p || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|SVG)$/i.test(p.tagName) || p.closest('svg, vibe-cms, [data-cms-lock]')) return NodeFilter.FILTER_REJECT;
        return norm(n.data) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      },
    });
    while (w.nextNode()) out.push(w.currentNode);
    return out;
  }

  /** The element to edit for a pointer target: the nearest element that holds text directly. */
  function editableFor(target) {
    let el = target instanceof Element ? target : target?.parentElement;
    while (el && el !== document.body) {
      if (el.closest('vibe-cms, [data-cms-lock], svg')) return null;
      if ([...el.childNodes].some((n) => n.nodeType === 3 && norm(n.data))) {
        // prefer the block that contains inline pieces (a <p> with a <strong> inside)
        const block = el.closest('p, h1, h2, h3, h4, h5, h6, li, blockquote, figcaption, td, th, dt, dd, label, button, a, summary, span, div');
        if (block && block !== el && /^(STRONG|EM|B|I|SPAN|SMALL|MARK|SUP|SUB|BR|CODE|U)$/.test(el.tagName) &&
          [...block.childNodes].some((n) => n.nodeType === 3 && norm(n.data))) return block;
        return el;
      }
      el = el.parentElement;
    }
    return null;
  }

  function placeBox(box, el) {
    if (!el) { box.style.display = 'none'; return; }
    const r = el.getBoundingClientRect();
    Object.assign(box.style, { display: 'block', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
  }

  function neighboursOf(el) {
    const sec = el.closest('section, header, footer, nav, article, aside, form, [class*="card"], main') || el.parentElement || document.body;
    const mine = new Set(textNodes(el));
    return textNodes(sec).filter((n) => !mine.has(n)).map((n) => norm(n.data)).filter((t) => t.length >= 6).slice(0, 24);
  }

  function startEdit(el, evt) {
    if (editing?.el === el) return;
    finishEdit();
    const originals = new Map(textNodes(el).map((n) => [n, n.data]));
    if (!originals.size) return;
    editing = { el, originals, neighbours: neighboursOf(el) };
    snapshots.set(el, el.cloneNode(true));
    try { el.contentEditable = 'plaintext-only'; } catch { el.contentEditable = 'true'; }
    if (el.contentEditable !== 'plaintext-only') el.contentEditable = 'true';
    el.spellcheck = true;
    el.focus({ preventScroll: true });
    const pos = evt && (document.caretPositionFromPoint?.(evt.clientX, evt.clientY) || document.caretRangeFromPoint?.(evt.clientX, evt.clientY));
    if (pos) {
      const range = document.createRange();
      if (pos.offsetNode) range.setStart(pos.offsetNode, pos.offset); else range.setStart(pos.startContainer, pos.startOffset);
      range.collapse(true);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
    }
    placeBox(root.querySelector('.focus'), el);
  }

  async function finishEdit(cancel = false) {
    if (!editing) return;
    const { el, originals, neighbours } = editing;
    editing = null;
    el.removeAttribute('contenteditable');
    el.removeAttribute('spellcheck');
    root.querySelector('.focus').style.display = 'none';
    const restore = () => el.replaceChildren(...editing_snapshot(el).cloneNode(true).childNodes);
    if (cancel) { restore(); return; }
    const list = [...originals.entries()];
    const now = textNodes(el);
    // Selecting everything and typing makes the browser replace the text node instead of changing it.
    if (list.some(([n]) => !n.isConnected) || now.some((n) => !originals.has(n))) {
      const typed = now.map((n) => n.data).join('');
      restore();
      if (list.length !== 1) {
        toast('This text has bold, links or other parts inside. Click into one part and edit it without selecting everything. Changed back.', 'warn', 8000);
        return;
      }
      const node = textNodes(el)[0];
      const orig = node.data;
      if (norm(typed) === norm(orig)) return;
      if (!norm(typed)) { toast('Text can’t be left empty yet. Changed back.', 'warn'); return; }
      node.data = typed;
      await send(node, orig, neighbours);
      return;
    }
    for (const [node, orig] of list) {
      if (norm(node.data) === norm(orig)) continue;
      if (!norm(node.data)) { node.data = orig; toast('Text can’t be left empty yet. Changed back.', 'warn'); continue; }
      await send(node, orig, neighbours);
    }
  }

  async function send(node, orig, neighbours) {
    const typed = node.data;
    try {
      const r = await api('POST', 'drafts', { path: location.pathname, old: orig, new: typed, neighbours, shared: !!node.parentElement?.closest('header, footer, nav') });
      const res = r.result || {};
      if (res.status === 'missing') {
        node.data = orig;
        toast(`<b>This text isn’t written in the site’s code.</b><br>It’s built by code or comes from data, so it can’t be edited here yet. Changed back.`, 'warn', 7000);
      } else if (res.status === 'ambiguous') {
        await ask(r.draft, res.candidates, node, orig);
      } else if (res.status === 'found') {
        const w = res.where;
        const copies = res.copies ? ` Also changes ${res.copies} other cop${res.copies > 1 ? 'ies' : 'y'} in the same file (for example the phone menu or the footer).` : '';
        toast(`Saved as a draft${w ? ` · <code>${esc(w.file)}:${w.line}</code>` : ''}.${copies}`, 'ok', copies ? 6000 : 2500);
      }
      await refresh();
    } catch (e) {
      node.data = orig;
      toast(esc(e.message), 'bad', 7000);
    }
  }

  function ask(draft, candidates, node, orig) {
    return new Promise((resolve) => {
      const m = modal(`
        <h2>This text is in ${candidates.length} places</h2>
        <p>“${esc(draft.old)}” → “${esc(draft.new)}”. Change it everywhere, or pick the one on this page.</p>
        <button class="opt primary" data-all>Change all ${candidates.length}</button>
        ${candidates.map((c, i) => `<button class="opt" data-i="${i}"><b>Only in ${esc(c.file)}, line ${c.line}</b><code>${esc(c.snippet)}</code></button>`).join('')}
        <div class="row"><button data-cancel>Cancel</button></div>`);
      const done = async (choice) => {
        m.close();
        try {
          if (choice === null) { await api('DELETE', 'drafts/' + draft.id); node.data = orig; }
          else await api('POST', `drafts/${draft.id}/choose`, { choice });
          if (choice !== null) toast('Saved as a draft', 'ok', 2500);
        } catch (e) { toast(esc(e.message), 'bad'); }
        resolve();
      };
      m.el.querySelector('[data-all]').onclick = () => done('all');
      m.el.querySelectorAll('[data-i]').forEach((b) => { b.onclick = () => { const c = candidates[+b.dataset.i]; done({ file: c.file, line: c.line }); }; });
      m.el.querySelector('[data-cancel]').onclick = () => done(null);
    });
  }

  /** Shows drafts on the frozen page: any text that reads as a draft's old text now reads as its new text. */
  function overlayDrafts() {
    if (!state.drafts.length) return;
    const byOld = new Map(state.drafts.filter((d) => d.scope !== 'pending').map((d) => [d.old, d]));
    for (const n of textNodes(document.body)) {
      const d = byOld.get(norm(n.data));
      if (d) n.data = n.data.replace(/\S[\s\S]*\S|\S/, d.new);
    }
  }

  async function refresh() {
    try { state = await api('GET', 'state'); } catch (e) { toast(esc(e.message), 'bad'); return; }
    drawBar();
  }

  let pages = null;
  async function loadPages() {
    try {
      const xml = await (await fetch('/sitemap.xml')).text();
      pages = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => { try { return new URL(m[1].trim()).pathname; } catch { return null; } }).filter(Boolean);
    } catch { pages = []; }
    drawBar();
  }

  function drawBar() {
    const bar = root.querySelector('.bar');
    const n = state.drafts.length;
    const dep = state.deploy || {};
    const sha = dep.sha ? dep.sha.slice(0, 7) : '';
    const status = dep.state === 'building' ? `Publishing ${sha}…` : dep.state === 'failed' ? `Build failed (${sha})` :
      n ? `${n} unpublished change${n > 1 ? 's' : ''}` : dep.state === 'live' && dep.finishedAt ? `Live · ${sha}` : 'No changes';
    const opts = (pages || []).map((p) => `<option value="${esc(p)}"${p === location.pathname || p === location.pathname + '/' ? ' selected' : ''}>${esc(p)}</option>`).join('');
    bar.innerHTML = `
      <span class="brand">Vibe CMS</span>
      ${pages && pages.length ? `<select data-a="page" aria-label="Page">${opts}</select>` : ''}
      <button data-a="changes" ${n ? '' : 'disabled'}>Changes</button>
      <span class="status ${esc(dep.state || '')}">${esc(status)}</span>
      <button class="primary" data-a="publish" ${n && dep.state !== 'building' ? '' : 'disabled'}>Publish</button>
      <button data-a="exit" title="Stop editing">Done</button>`;
    bar.querySelector('[data-a=page]')?.addEventListener('change', (e) => { location.href = e.target.value; });
    bar.querySelector('[data-a=changes]').onclick = showChanges;
    bar.querySelector('[data-a=publish]').onclick = publish;
    bar.querySelector('[data-a=exit]').onclick = async () => { await finishEdit(); store.patch({ edit: false }); location.reload(); };
  }

  function showChanges() {
    const m = modal(`
      <h2>Unpublished changes</h2>
      <p>Publishing writes these into the site’s code as one commit. The site’s normal deploy then puts them live.</p>
      <ul class="list">${state.drafts.map((d) => `
        <li><div class="t"><div><s>${esc(d.old)}</s></div><div>${esc(d.new)}</div>
          <code>${d.scope === 'all' ? 'everywhere it appears' : d.where ? esc(d.where.file) + ':' + d.where.line : 'place not chosen'} · ${esc(d.path)}</code></div>
          <button data-del="${esc(d.id)}">Undo</button></li>`).join('')}</ul>
      <div class="row"><button data-close>Close</button></div>`);
    m.el.querySelector('[data-close]').onclick = m.close;
    m.el.querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = async () => {
        const d = state.drafts.find((x) => x.id === b.dataset.del);
        await api('DELETE', 'drafts/' + b.dataset.del);
        for (const n of textNodes(document.body)) if (d && norm(n.data) === d.new) n.data = n.data.replace(/\S[\s\S]*\S|\S/, d.old);
        await refresh();
        m.close();
        if (state.drafts.length) showChanges();
      };
    });
  }

  async function publish() {
    await finishEdit();
    const btn = root.querySelector('[data-a=publish]');
    btn.disabled = true;
    try {
      const r = await api('POST', 'publish');
      if (r.skipped?.length) toast(`${r.skipped.length} change${r.skipped.length > 1 ? 's' : ''} couldn’t be placed and stay as drafts: ${r.skipped.map((s) => esc(s.reason)).join('; ')}`, 'warn', 9000);
      if (r.sha) toast(`Committed <code>${r.sha.slice(0, 7)}</code> (${r.files.map(esc).join(', ')}). The site is deploying.`, 'ok', 6000);
      await refresh();
      watchDeploy(r.sha);
    } catch (e) { toast(esc(e.message), 'bad', 8000); await refresh(); }
  }

  function watchDeploy(sha) {
    if (!sha) return;
    const tick = async () => {
      await refresh();
      const d = state.deploy || {};
      if (d.sha !== sha || d.state === 'building') return setTimeout(tick, 2000);
      if (d.state === 'live') {
        const t = toast(`<b>Live.</b> The published site now has your changes. <button data-reload>Reload</button>`, 'ok', 0);
        t.querySelector('[data-reload]').onclick = () => location.reload();
      } else toast(`The build failed. Your changes are committed (<code>${sha.slice(0, 7)}</code>) but not live.<br><code>${esc((d.log || []).slice(-2).join(' '))}</code>`, 'bad', 0);
    };
    setTimeout(tick, 1500);
  }

  async function startEditor() {
    freeze();
    shell();
    const hover = root.querySelector('.hover');
    let hovered = null;
    const inUi = (e) => e.composedPath().includes(host);
    document.addEventListener('pointerover', (e) => {
      if (inUi(e)) return;
      hovered = editableFor(e.target);
      placeBox(hover, hovered && hovered !== editing?.el ? hovered : null);
    }, true);
    document.addEventListener('click', (e) => {
      if (inUi(e)) return;
      if (editing && editing.el.contains(e.target)) { e.preventDefault(); return; }
      e.preventDefault();
      e.stopPropagation();
      const el = editableFor(e.target);
      if (el) startEdit(el, e); else finishEdit();
    }, true);
    document.addEventListener('submit', (e) => e.preventDefault(), true);
    document.addEventListener('keydown', (e) => {
      if (!editing) return;
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finishEdit(); }
      else if (e.key === 'Escape') { e.preventDefault(); finishEdit(true); }
    }, true);
    document.addEventListener('focusout', (e) => {
      if (editing && e.target === editing.el) setTimeout(() => { if (editing && document.activeElement !== editing.el) finishEdit(); }, 0);
    }, true);
    const redraw = () => { placeBox(hover, null); if (editing) placeBox(root.querySelector('.focus'), editing.el); };
    addEventListener('scroll', redraw, { passive: true, capture: true });
    addEventListener('resize', redraw);
    await refresh();
    overlayDrafts();
    loadPages();
    if (state.deploy?.state === 'building') watchDeploy(state.deploy.sha);
  }

  boot();
})();
