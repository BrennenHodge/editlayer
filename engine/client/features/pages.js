// New pages (Pages panel: New page, Duplicate this page, Delete this page) and device preview
// (bar button: the page with unpublished changes at phone, tablet and computer sizes).
//
// Menu contract (answered by the Menu feature, if the site has one):
//   core.emit('nav:available')               → a listener returns true if it can add menu links
//   core.emit('nav:add', { label, href })    → the listener adds the link (through core.mutate or
//                                               core.setExtra) and may return a promise; Pages waits
//                                               for it and saves before leaving the page.
// Pages also emits 'page:created' { path, title } and 'page:deleted' { path } for other features.
feature('pages', (core) => {
  const { S, d, esc, icon, api, toast } = core;
  const F = (S.features && S.features.pages) || {};
  const me = F.page || null;          // the page open now, if it was made here
  const canDelete = ['editor', 'admin'].includes(S.user.role);
  const HOST = location.host;

  core.addIcons({
    devices: '<rect x="2" y="4" width="14" height="11" rx="1.5"/><path d="M6 19h6M9 15v4"/><rect x="17" y="8" width="5" height="12" rx="1.2"/>',
    phone: '<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18.5h2"/>',
    tablet: '<rect x="4.5" y="2.5" width="15" height="19" rx="2"/><path d="M11 18.5h2"/>',
    desktop: '<rect x="2.5" y="4" width="19" height="13" rx="1.5"/><path d="M8 21h8M12 17v4"/>',
    reload: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
    filePlus: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M12 11v6M9 14h6"/>',
  });

  /* ------------------------------------------------------------ helpers */
  let cmsCache = null;
  const cmsPages = () => (cmsCache ||= api('GET', 'cms-pages').then((r) => r.pages).catch(() => []));
  const pageName = (p) => (p === '/' ? 'Home' : p);
  const slugify = (s) => {
    let out = String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/&/g, ' and ').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (out.length > 60) out = out.slice(0, 60).replace(/-[^-]*$/, '') || out.slice(0, 60);
    return out;
  };
  const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  const currentTitle = () => (me && me.title) || d.querySelector('[data-cms] h1')?.textContent.trim().replace(/\s+/g, ' ') || d.title.split(' | ')[0];
  const navAvailable = () => core.emit('nav:available').some((v) => v === true);

  /** Top-level page regions (not site-wide ones) of a document. */
  const pageRegions = (doc) => [...doc.querySelectorAll('[data-cms]')]
    .filter((el) => !/^[@#]/.test(el.getAttribute('data-cms')) && !el.parentElement.closest('[data-cms]'));

  /** A page's regions as the editor sees them (drafts applied, hidden sections kept). */
  async function regionsOf(path) {
    if (path === S.path) {
      core.finishEdit();
      await core.save();
      return pageRegions(d).map((el) => [core.keyOf(el), core.regionHtml(el)]);
    }
    const res = await fetch(`${path}?edit`, { credentials: 'same-origin' });
    if (!res.ok) throw new Error('Couldn’t open that page. Try another.');
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    return pageRegions(doc).map((el) => [el.getAttribute('data-cms'), el.innerHTML]);
  }

  const CRUMBS = '.crumbs, .breadcrumb, .breadcrumbs, [aria-label="Breadcrumb" i], [aria-label="Breadcrumbs" i], [itemtype*="BreadcrumbList"]';
  const box = (html) => { const t = d.createElement('template'); t.innerHTML = html; return t.content; };
  const outer = (frag) => { const t = d.createElement('div'); t.append(frag); return t.innerHTML; };

  /** A copy of a page: same content, minus a breadcrumb trail that would point at the other page. */
  function copyContent(html) {
    const frag = box(html);
    frag.querySelectorAll(CRUMBS).forEach((n) => n.remove());
    return outer(frag);
  }

  /** A simple page: the layout's first section as the page header, plus one text section to fill in. */
  function simpleContent(html, title) {
    const frag = box(html);
    const sections = [...frag.children].filter((c) => !/^(SCRIPT|STYLE|TEMPLATE|LINK)$/.test(c.tagName));
    if (!sections.length) throw new Error('That layout has no sections to start from. Pick another.');
    const head = sections[0].cloneNode(true);
    // Make it this page's own: not a shared section, no locked live text, no breadcrumb trail.
    [head, ...head.querySelectorAll('*')].forEach((n) => [...n.attributes].forEach((a) => { if (/^data-cms/.test(a.name)) n.removeAttribute(a.name); }));
    head.querySelectorAll(`${CRUMBS}, [data-cms-lock], ul, ol, dl, form, iframe, video, table`).forEach((n) => n.remove());
    head.querySelectorAll('a').forEach((a) => { if (!a.querySelector('img')) a.remove(); });
    const h1 = head.querySelector('h1') || head.querySelector('h2');
    if (h1) h1.textContent = title;
    let intro = false;
    head.querySelectorAll('p, figcaption, blockquote, h2, h3, h4, h5, h6').forEach((n) => {
      if (n === h1 || !head.contains(n)) return;
      if (n.tagName === 'FIGCAPTION') { n.textContent = 'Add a caption for the picture.'; return; }
      const before = h1 && (h1.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_PRECEDING);
      if (n.tagName === 'P' && before) n.textContent = 'Add a short label';
      else if (n.tagName === 'P' && !intro) { n.textContent = 'Add a short introduction to this page.'; intro = true; }
      else n.remove();
    });
    // Drop wrappers left empty by the clean-up.
    for (let i = 0; i < 3; i++) head.querySelectorAll('div, span, nav').forEach((n) => { if (!n.children.length && !/\S/.test(n.textContent)) n.remove(); });
    if (h1 && !intro) h1.insertAdjacentHTML('afterend', '<p>Add a short introduction to this page.</p>');
    return `${head.outerHTML}\n${textSection(sections.slice(1))}`;
  }

  const TEXT = '<h2>Add a heading</h2><p>Add the main text of this page. Click here and start typing; press Enter for a new paragraph.</p>';
  /** One text section that uses the layout's own section and container classes. */
  function textSection(rest) {
    if (F.textSection) {
      const frag = box(F.textSection);
      const slot = frag.querySelector('[data-text]');
      if (slot) { slot.removeAttribute('data-text'); slot.innerHTML = TEXT; return outer(frag); }
    }
    const model = rest.find((s) => s.querySelector('h2') && s.querySelector('p') && !s.querySelector('form')) || rest[0];
    if (!model) return `<section>${TEXT}</section>`;
    const sec = d.createElement(model.tagName.toLowerCase() === 'section' ? 'section' : 'div');
    const cls = [...model.classList].filter((c) => !/dark|cta|hero|grid-bg/i.test(c));
    if (cls.length) sec.className = cls.join(' ');
    const wrap = model.firstElementChild;
    if (wrap && wrap.tagName === 'DIV' && wrap.classList.length) {
      const w = d.createElement('div');
      w.className = [...wrap.classList].filter((c) => !/grid|split|cols|row|cta/i.test(c)).join(' ');
      w.innerHTML = TEXT;
      sec.append(w);
    } else sec.innerHTML = TEXT;
    return sec.outerHTML;
  }

  /* ------------------------------------------------------------ Pages panel additions */
  core.on('panel:pages', (pb, pages) => {
    const intro = pb.querySelector('p');
    const acts = d.createElement('div');
    acts.className = 'np-acts';
    acts.innerHTML = `<button class="btn primary" type="button" data-np="new">${icon('filePlus')}New page</button>
      <button class="btn" type="button" data-np="dup">${icon('copy')}Duplicate this page</button>
      ${me && canDelete ? `<button class="btn danger" type="button" data-np="del">${icon('trash')}Delete this page</button>` : ''}`;
    (intro || pb.firstChild) ? (intro || pb.firstChild).after(acts) : pb.prepend(acts);
    if (me && !me.live) acts.insertAdjacentHTML('afterend', '<div class="note">This page isn’t published yet. Visitors can’t find it until you publish it.</div>');
    acts.addEventListener('click', (e) => {
      const a = e.target.closest('[data-np]')?.dataset.np;
      if (a === 'new') newPageForm({ pages });
      if (a === 'dup') newPageForm({ pages, mode: 'copy', from: S.path, title: `${currentTitle()} (copy)` });
      if (a === 'del') deletePage();
    });
    // Show which pages were made here, and whether they're public yet.
    cmsPages().then((list) => {
      for (const p of list) {
        const link = pb.querySelector(`[data-go="${CSS.escape(p.path)}"]`);
        if (!link || link.dataset.np) continue;
        link.dataset.np = '1';
        link.querySelector('.grow')?.insertAdjacentHTML('beforeend', `<span>${esc(p.title)}</span>`);
        if (!p.live) link.querySelector('.grow')?.insertAdjacentHTML('afterend', '<span class="pill np-off">Not published</span>');
      }
    });
  });

  // A page made here has no "original" to go back to: resetting it would wipe it and show the
  // layout page's content at its address, and discarding a never-published page does the same.
  core.on('panel:history', (pb) => {
    if (!me) return;
    pb.querySelector('[data-x="reset"]')?.remove();
    if (!me.live) {
      const row = pb.querySelector('[data-x="discard"]')?.closest('.row');
      row?.insertAdjacentHTML('beforebegin', '<p class="note">This page hasn’t been published yet. To start it again, delete it in <b>Pages</b> and make a new one.</p>');
      row?.remove();
    }
  });

  // "Publish all pages" also puts new pages that were never published on the site. Say which, so a
  // page someone is still preparing doesn't go live by surprise.
  core.beforePublish(async ({ all }) => {
    if (!all) return true;
    cmsCache = null;
    const fresh = (await cmsPages()).filter((p) => !p.live && p.draft && p.path !== S.path);
    if (!fresh.length) return true;
    const names = fresh.slice(0, 5).map((p) => `“${p.title}” (${p.path})`).join(', ') + (fresh.length > 5 ? ` and ${fresh.length - 5} more` : '');
    return confirm(`This also makes ${fresh.length === 1 ? 'a new page' : `${fresh.length} new pages`} visible to visitors for the first time: ${names}. Publish ${fresh.length === 1 ? 'it' : 'them'} too?`);
  });

  /* ------------------------------------------------------------ New page form */
  async function newPageForm({ pages, mode = 'simple', from = S.path, title = '' } = {}) {
    const all = pages || await core.sitePages();
    const made = new Set((await cmsPages()).map((p) => p.path));
    const layouts = all.filter((p) => !made.has(p.path));
    const layout = [F.layout, me ? me.template : S.path, ...layouts.map((p) => p.path).filter((p) => p !== '/')]
      .find((p) => p && layouts.some((l) => l.path === p)) || (layouts[0] && layouts[0].path) || '/';
    const opt = (list, sel) => list.map((p) => `<option value="${esc(p.path)}" ${p.path === sel ? 'selected' : ''}>${esc(pageName(p.path))}</option>`).join('');
    const nav = navAvailable();
    const pb = core.openPanel(title ? 'Duplicate page' : 'New page', `
      <form class="np" novalidate>
        <div class="field"><label for="np-t">Page title</label>
          <input id="np-t" name="title" type="text" maxlength="120" required autocomplete="off" value="${esc(title)}" placeholder="What is this page about?"></div>
        <div class="field"><label for="np-s">Web address</label>
          <div class="np-url"><span class="np-host">${esc(HOST)}/</span><input id="np-s" name="path" type="text" maxlength="80" required autocomplete="off" spellcheck="false" autocapitalize="off" aria-describedby="np-msg"><span>/</span></div>
          <p class="np-msg" id="np-msg" aria-live="polite">Made from the title. Lowercase words joined by hyphens.</p></div>
        <fieldset class="np-from"><legend>Start from</legend>
          <label class="np-opt"><input type="radio" name="mode" value="copy" ${mode === 'copy' ? 'checked' : ''}><span><b>A copy of a page</b><span class="muted">Everything on it, ready to change.</span></span></label>
          <select name="copy" aria-label="Page to copy">${opt(all, from)}</select>
          <label class="np-opt"><input type="radio" name="mode" value="simple" ${mode === 'simple' ? 'checked' : ''}><span><b>A simple page</b><span class="muted">The top of the page you pick as the layout, plus one text section to fill in.</span></span></label>
          <select name="layout" aria-label="Layout">${opt(layouts, layout)}</select>
        </fieldset>
        ${nav ? '<label class="np-check"><input type="checkbox" name="nav" checked><span>Add it to the menu</span></label>' : ''}
        <p class="note">The new page starts as a draft. Only editors can see it until you publish it.</p>
        <div class="row end"><button class="btn" type="button" data-np="back">Back</button><button class="btn primary" type="submit">Create page</button></div>
      </form>`);
    const form = pb.querySelector('form');
    const tIn = form.querySelector('#np-t');
    const sIn = form.querySelector('#np-s');
    const msg = form.querySelector('#np-msg');
    const submit = form.querySelector('[type="submit"]');
    let slugEdited = false;
    let checked = { slug: '', ok: false, message: '' };
    let timer = 0;
    const say = (text, kind = '') => { msg.textContent = text; msg.className = `np-msg ${kind}`; };
    const check = () => {
      clearTimeout(timer);
      const s = sIn.value;
      if (!s) { say('Made from the title. Lowercase words joined by hyphens.'); return; }
      // A hyphen typed at the end is the start of the next word, not a mistake (tidied on blur).
      if (/[a-z0-9]-+$/.test(s) && SLUG_RE.test(s.replace(/-+$/, ''))) { say('Lowercase words joined by hyphens.'); return; }
      if (!SLUG_RE.test(s)) { say('Use lowercase letters, numbers and hyphens only, like summer-workshops.', 'bad'); return; }
      say('Checking…');
      timer = setTimeout(async () => {
        try {
          const r = await api('GET', `cms-pages/check?path=${encodeURIComponent(s)}`);
          checked = { slug: s, ok: r.ok, message: r.message };
          if (sIn.value === s) say(r.ok ? `Free to use: ${HOST}/${s}/` : r.message, r.ok ? 'ok' : 'bad');
        } catch (err) { say(err.message, 'bad'); }
      }, 300);
    };
    sIn.value = slugify(title);
    if (sIn.value) check();
    tIn.addEventListener('input', () => { if (!slugEdited) { sIn.value = slugify(tIn.value); check(); } });
    sIn.addEventListener('input', () => {
      slugEdited = sIn.value !== '';
      const clean = sIn.value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      if (clean !== sIn.value) sIn.value = clean;
      check();
    });
    sIn.addEventListener('blur', () => { const v = sIn.value.replace(/-+/g, '-').replace(/^-|-$/g, ''); if (v !== sIn.value) { sIn.value = v; check(); } });
    form.querySelectorAll('select').forEach((s) => s.addEventListener('change', () => { form.querySelector(`input[name="mode"][value="${s.name === 'copy' ? 'copy' : 'simple'}"]`).checked = true; }));
    form.querySelector('[data-np="back"]').addEventListener('click', () => { core.closePanel(); core.togglePanel('pages'); });
    setTimeout(() => (title ? sIn : tIn).focus(), 0);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const t = String(fd.get('title') || '').trim();
      const s = sIn.value = sIn.value.replace(/-+/g, '-').replace(/^-|-$/g, '');
      if (!t) { toast('Give the page a title.', true); tIn.focus(); return; }
      if (!SLUG_RE.test(s)) { say('Use lowercase letters, numbers and hyphens only, like summer-workshops.', 'bad'); sIn.focus(); return; }
      if (checked.slug === s && !checked.ok) { say(checked.message, 'bad'); sIn.focus(); return; }
      const m = fd.get('mode');
      const src = String(fd.get(m === 'copy' ? 'copy' : 'layout') || '');
      submit.disabled = true;
      submit.textContent = 'Creating…';
      try {
        const regions = {};
        for (const [key, html] of await regionsOf(src)) regions[key] = m === 'copy' ? copyContent(html) : simpleContent(html, t);
        const r = await api('POST', 'cms-pages', { title: t, path: s, mode: m, from: src, regions });
        cmsCache = null;
        core.clearPagesCache();
        core.emit('page:created', { path: r.path, title: r.title });
        if (fd.get('nav')) {
          await Promise.all(core.emit('nav:add', { label: r.title, href: r.path }).map((p) => Promise.resolve(p).catch(() => {})));
        }
        core.finishEdit();
        await core.save();
        try { sessionStorage.setItem('vibecms-new-page', r.path); } catch { /* private mode */ }
        location.href = `${r.path}?edit`;
      } catch (err) {
        submit.disabled = false;
        submit.textContent = 'Create page';
        say(err.message, 'bad');
        toast(`Couldn’t create the page: ${err.message}`, true);
      }
    });
  }

  /* ------------------------------------------------------------ Delete */
  function deletePage() {
    if (!me) return;
    const inMenu = core.emit('nav:count', me.path).reduce((n, v) => n + (Number(v) || 0), 0);
    const menuNote = inMenu ? ' Its links in the menu are taken out too; publish to update the menu for visitors.' : '';
    const m = core.modal({
      title: 'Delete this page?',
      body: `<div class="np-del"><p><b>${esc(me.title)}</b> at ${esc(HOST + me.path)} will be deleted, with its text, pictures and page settings.</p>
        ${me.live ? `<p>Visitors will no longer find it. Links to it from other pages will stop working, so remove those too.${menuNote}</p>` : `<p>It was never published, so visitors won’t notice.${menuNote}</p>`}
        <p><b>This can’t be undone.</b></p></div>`,
      foot: '<button class="btn" data-act="close">Cancel</button><button class="btn danger np-del-go">Delete page</button>',
    });
    m.el.classList.add('np-modal');
    m.el.querySelector('.np-del-go').focus();
    m.el.querySelector('.np-del-go').addEventListener('click', async (e) => {
      e.target.disabled = true;
      try {
        core.finishEdit();
        await core.save();
        await api('DELETE', 'cms-pages', { path: me.path });
        // Listeners (the menu) may change the site-wide header: save that before leaving the page.
        const removed = (await Promise.all(core.emit('page:deleted', { path: me.path }).map((p) => Promise.resolve(p).catch(() => 0))))
          .reduce((n, v) => n + (Number(v) || 0), 0);
        core.finishEdit();
        await core.save();
        m.close();
        try { sessionStorage.setItem('vibecms-deleted-page', me.title); if (removed) sessionStorage.setItem('vibecms-deleted-menu', '1'); } catch { /* private mode */ }
        location.href = '/?edit';
      } catch (err) { e.target.disabled = false; toast(`Couldn’t delete the page: ${err.message}`, true); }
    });
  }

  core.on('ready', () => {
    try {
      const made = sessionStorage.getItem('vibecms-new-page');
      const gone = sessionStorage.getItem('vibecms-deleted-page');
      if (made === S.path) { sessionStorage.removeItem('vibecms-new-page'); sessionStorage.setItem('vibecms-hint', '1'); setTimeout(() => toast('Page created as a draft. Click any text to change it, then publish when it’s ready.'), 300); }
      else if (gone) {
        const menu = sessionStorage.getItem('vibecms-deleted-menu');
        sessionStorage.removeItem('vibecms-deleted-page');
        sessionStorage.removeItem('vibecms-deleted-menu');
        setTimeout(() => toast(`“${gone}” was deleted.${menu ? ' Its menu links were taken out too: publish to update the menu for visitors.' : ''}`), 300);
      }
      else if (me && !me.live && !sessionStorage.getItem(`vibecms-unpub:${S.path}`)) {
        sessionStorage.setItem(`vibecms-unpub:${S.path}`, '1');
        setTimeout(() => toast('This page isn’t published yet. Visitors can’t find it until you publish it.'), 300);
      }
    } catch { /* private mode */ }
  });

  /* ------------------------------------------------------------ Device preview */
  const SIZES = {
    phone: { w: 390, h: 844, label: 'Phone' },
    tablet: { w: 768, h: 1024, label: 'Tablet' },
    desktop: { w: 1280, h: 800, label: 'Computer' },
  };
  let pv = null;
  let size = 'phone';
  try { size = SIZES[sessionStorage.getItem('vibecms-preview-size')] ? sessionStorage.getItem('vibecms-preview-size') : 'phone'; } catch { /* private mode */ }

  core.addBarButton({ id: 'preview', icon: 'devices', title: 'Preview on phone, tablet and computer', order: 40, run: openPreview });

  async function openPreview() {
    if (pv) return;
    core.finishEdit();
    core.closePanel();
    core.closePop();
    await core.save();
    if (core.dirty) toast('Your latest changes couldn’t be saved, so the preview may be missing them.', true);
    const back = d.activeElement;
    const el = d.createElement('div');
    el.className = 'pv';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Preview');
    el.innerHTML = `<div class="pv-top">
        <div class="pv-title"><b>Preview</b><span>With your unpublished changes</span></div>
        <div class="pv-seg" role="radiogroup" aria-label="Screen size">${Object.entries(SIZES).map(([k, v]) => `<button type="button" role="radio" data-size="${k}" aria-checked="${k === size}" tabindex="${k === size ? 0 : -1}">${icon(k)}<span>${v.label}</span></button>`).join('')}</div>
        <div class="pv-acts">${core.btn('reload', 'Reload', 'pv-reload')}${core.btn('x', 'Close preview (Esc)', 'pv-close')}</div>
      </div>
      <div class="pv-stage"><div class="pv-dev"><iframe title="Preview of this page" src="${esc(S.path)}?preview"></iframe></div></div>
      <p class="pv-foot" aria-live="polite"></p>`;
    core.root.querySelector('.root').append(el);
    const frame = el.querySelector('iframe');
    const dev = el.querySelector('.pv-dev');
    const stage = el.querySelector('.pv-stage');
    const foot = el.querySelector('.pv-foot');
    const layout = () => {
      const s = SIZES[size];
      const W = stage.clientWidth - 24;
      const H = stage.clientHeight - 24;
      let scale = Math.min(1, W / s.w);
      let h = s.h;
      if (size === 'desktop') h = Math.max(480, H / scale);   // a computer screen fills the height
      else scale = Math.min(scale, H / s.h);
      frame.style.width = `${s.w}px`;
      frame.style.height = `${h}px`;
      frame.style.transform = `scale(${scale})`;
      dev.style.width = `${Math.round(s.w * scale)}px`;
      dev.style.height = `${Math.round(h * scale)}px`;
      dev.dataset.size = size;
      foot.textContent = `${s.label}: ${s.w} pixels wide${scale < 0.995 ? `, shown at ${Math.round(scale * 100)}% to fit` : ''}. Links open other pages in the preview too.`;
    };
    const setSize = (k, focus) => {
      size = k;
      try { sessionStorage.setItem('vibecms-preview-size', k); } catch { /* private mode */ }
      el.querySelectorAll('[data-size]').forEach((b) => { const on = b.dataset.size === k; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; if (on && focus) b.focus(); });
      layout();
    };
    const close = () => {
      removeEventListener('keydown', onKey, true);
      removeEventListener('resize', layout);
      el.remove();
      pv = null;
      (back && back.focus ? back : core.R.bar.querySelector('[data-act="b-preview"]'))?.focus?.();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
      if (e.key === 'Tab') {   // keep focus inside the preview
        const items = [...el.querySelectorAll('button:not([tabindex="-1"]), iframe')];
        const i = items.indexOf(core.root.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); items[items.length - 1].focus(); }
        else if (!e.shiftKey && i === items.length - 1) { e.preventDefault(); items[0].focus(); }
      }
    };
    el.querySelector('.pv-seg').addEventListener('keydown', (e) => {
      const keys = Object.keys(SIZES);
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!step) return;
      e.preventDefault();
      setSize(keys[(keys.indexOf(size) + step + keys.length) % keys.length], true);
    });
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.size) setSize(b.dataset.size);
      if (b.dataset.act === 'pv-close') close();
      if (b.dataset.act === 'pv-reload') { foot.textContent = 'Reloading…'; frame.contentWindow?.location.reload(); }
    });
    frame.addEventListener('load', () => {
      layout();
      try {
        const doc = frame.contentDocument;
        doc.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } });
        // Keep other pages in preview mode, so links show their unpublished changes too.
        doc.addEventListener('click', (e) => {
          const a = e.target.closest && e.target.closest('a[href]');
          if (!a || a.target === '_blank' || e.defaultPrevented) return;
          const u = new URL(a.href, frame.contentWindow.location.href);
          if (!/^https?:$/.test(u.protocol)) return;   // mailto:, tel:
          // Other websites usually refuse to show inside a frame: open them in a new tab instead.
          if (u.origin !== location.origin) { e.preventDefault(); open(u.href, '_blank', 'noopener'); return; }
          if (u.pathname.startsWith('/_cms') || u.searchParams.has('preview')) return;
          if (u.pathname === frame.contentWindow.location.pathname && u.hash) return;
          e.preventDefault();
          u.searchParams.set('preview', '');
          frame.contentWindow.location.href = u.href.replace('preview=', 'preview');
        });
      } catch { /* not same-origin */ }
    });
    addEventListener('keydown', onKey, true);
    addEventListener('resize', layout);
    pv = { el, close };
    setSize(size, true);
  }
});
