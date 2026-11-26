  // Whole-section tools: section settings (background, spacing, alignment, image side, show on),
  // shared sections (edit once, changes everywhere), a section library and drag to reorder.
  feature('sections', (core) => {
    const { S, d, esc, icon } = core;
    const F = (S.features && S.features.sections) || {};
    const BGS = Array.isArray(F.backgrounds) ? F.backgrounds : [];
    const PHOTO_CLASS = String(F.photoClass || '').split(/\s+/).filter(Boolean);
    const BLOCKS = F.blocks || '/editlayer-blocks.html';
    const shared = { ...(F.shared || {}) };   // id → { name, tag, attrs }
    const OVERLAY = 'rgba(10,12,16,.62)';
    const KEEP = ['class', 'data-cms-space', 'data-cms-align', 'data-cms-show', 'data-cms-bg', 'data-cms-focus', 'id', 'aria-labelledby', 'aria-label', 'role'];
    const ui = core.R.bar.parentElement;   // the .root element inside the shadow root

    core.addIcons({
      grip: '<circle cx="9" cy="6" r=".6"/><circle cx="15" cy="6" r=".6"/><circle cx="9" cy="12" r=".6"/><circle cx="15" cy="12" r=".6"/><circle cx="9" cy="18" r=".6"/><circle cx="15" cy="18" r=".6"/>',
      gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
      shared: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
      blocks: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M17.5 14v7M14 17.5h7"/>',
    });

    /* ------------------------------------------------------------ helpers */
    const keyOfEl = (el) => el.getAttribute('data-cms') || '';
    const isShared = (el) => /^@s-[a-z0-9]+$/.test(keyOfEl(el));
    const idOf = (el) => keyOfEl(el).slice(3);
    const nameOf = (el) => (shared[idOf(el)] && shared[idOf(el)].name) || 'Shared section';
    const pageRegion = (sec) => core.regionOf(sec.parentElement);
    const contentRegion = (sec) => (isShared(sec) ? sec : pageRegion(sec));
    const rid = (n = 6) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
    const tokens = (s) => String(s || '').split(/\s+/).filter(Boolean);
    const isSectionEl = (c) => c.nodeType === 1 && !/^(SCRIPT|STYLE|TEMPLATE|LINK|META)$/.test(c.tagName);
    const short = (s, n = 28) => (s.length > n ? `${s.slice(0, n - 1).trim()}…` : s);
    const bgStyle = (src, focus, rest = '') => [...String(rest).split(';').map((x) => x.trim()).filter((x) => x && !/^background/i.test(x)),
      `background-image:linear-gradient(${OVERLAY},${OVERLAY}),url(${src})`, 'background-size:cover', `background-position:${focus}`, 'background-repeat:no-repeat'].join(';');
    const stripBgStyle = (el) => {
      const rest = (el.getAttribute('style') || '').split(';').map((x) => x.trim()).filter((x) => x && !/^background/i.test(x)).join(';');
      if (rest) el.setAttribute('style', rest); else el.removeAttribute('style');
    };
    const sameOriginPath = (url) => {
      try { const u = new URL(url, location.href); return u.origin === location.origin ? u.pathname : null; } catch { return null; }
    };
    const headingOf = (el) => (el.querySelector('h1,h2,h3,h4')?.textContent || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ');

    /** The settings that travel with a shared section, in a fixed order so they can be compared. */
    function attrsOf(source) {
      const get = (k) => (source instanceof Element ? source.getAttribute(k) : source && source[k]);
      const o = { class: tokens(get('class')).join(' ') };
      for (const k of KEEP.slice(1)) { const v = get(k); if (v != null && String(v).trim() !== '') o[k] = String(v).trim(); }
      return o;
    }

    /* Shared-section names and settings are one site-wide data key, sent as a patch. */
    let pending = {};
    function patchShared(id, entry) {
      pending[id] = { ...(pending[id] || {}), ...entry };
      shared[id] = { ...(shared[id] || {}), ...entry };
      core.setExtra('@sections', { set: pending });
    }
    // After every save, catch settings that changed without the panel (undo, redo), so the site-wide
    // copy never keeps a setting the page no longer has. Nothing is sent when they already match.
    core.on('saved', ({ extras }) => { if (extras.includes('@sections')) pending = {}; syncShared(); });
    /** A shared section's own settings (background, spacing…) live on its placeholder. Copy them to the
        site-wide data so every page shows them. Returns true if anything changed. */
    function syncShared() {
      let changed = false;
      for (const el of d.querySelectorAll('[data-cms] > [data-cms^="@s-"]')) {
        if (!isShared(el)) continue;
        const id = idOf(el);
        const now = attrsOf(el);
        const known = shared[id] || {};
        if (JSON.stringify(now) !== JSON.stringify(attrsOf(known.attrs || {})) || (known.tag && known.tag !== el.localName)) {
          patchShared(id, { attrs: now, tag: el.localName, ...(known.name ? {} : { name: 'Shared section' }) });
          changed = true;
        }
      }
      return changed;
    }
    // Also catches undo: anything still out of step is saved just before publishing.
    core.beforePublish(async () => { if (syncShared()) await core.save(); return true; });

    /** New ids for everything inside an inserted or copied section, with labels and links updated. */
    function freshIds(node) {
      const map = {};
      const withId = [node, ...node.querySelectorAll('[id]')].filter((e) => e.id);
      for (const el of withId) {
        const next = `${el.id.replace(/-c[a-z0-9]{4}$/, '')}-c${rid(4)}`;
        map[el.id] = next;
        el.id = next;
      }
      if (!withId.length) return node;
      for (const el of [node, ...node.querySelectorAll('*')]) {
        for (const a of ['aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-owns', 'for', 'list']) {
          if (el.hasAttribute(a)) el.setAttribute(a, tokens(el.getAttribute(a)).map((t) => map[t] || t).join(' '));
        }
        const href = el.tagName === 'A' ? el.getAttribute('href') : null;
        if (href && href.startsWith('#') && map[href.slice(1)]) el.setAttribute('href', `#${map[href.slice(1)]}`);
      }
      return node;
    }

    /** Markup without editor state and whitespace differences, for finding identical copies. */
    function norm(el) {
      const c = core.stripJunk(el.cloneNode(true));
      for (const n of [c, ...c.querySelectorAll('*')]) {
        if (n.hasAttribute('data-editlayer-open')) n.removeAttribute('open');
        for (const a of [...n.attributes]) if (/^(data-cms|data-editlayer|contenteditable$|spellcheck$)/.test(a.name)) n.removeAttribute(a.name);
      }
      return c.outerHTML.replace(/\xa0/g, '&nbsp;').replace(/\s+/g, ' ').replace(/>\s+</g, '><').trim();
    }

    /* ------------------------------------------------------------ section bar */
    core.on('section:label', (sec) => {
      const show = { phone: 'Phones only', large: 'Larger screens only' }[sec.getAttribute('data-cms-show')];
      if (isShared(sec)) return `Shared section · ${short(nameOf(sec))}${show ? ` · ${show}` : ''}`;
      return show ? `Section · ${show}` : undefined;
    });

    // Tell people once per section that a shared section changes everywhere.
    const noted = new Set();
    d.addEventListener('click', (e) => {
      if (e.composedPath().includes(core.host)) return;
      const t = e.target.nodeType === 1 ? e.target : e.target.parentElement;
      const s = t && t.closest('[data-cms^="@s-"]');
      if (!s || noted.has(keyOfEl(s))) return;
      noted.add(keyOfEl(s));
      setTimeout(() => core.toast(`This is the shared section “${short(nameOf(s), 40)}”. Your changes appear on every page that uses it.`), 0);
    }, true);

    core.addSectionAction({ act: 'sec-drag', order: 5, icon: 'grip', title: 'Drag to move this section', cls: 'sx-drag', run: () => {
      if (Date.now() - lastDragEnd < 400) return;
      core.toast('Drag this handle up or down to move the section. The arrow buttons move it one step.');
    } });
    core.addSectionAction({ act: 'sec-settings', order: 62, icon: 'gear', title: 'Section settings', run: (sec) => openSettings(sec) });
    core.addSectionAction({ act: 'sec-add', title: 'Add a section below', run: (sec, region) => openLibrary(sec, region) });
    core.addSectionAction({ act: 'sec-dup', run: (sec, region) => {
      const wasShared = isShared(sec);
      core.mutate(region, () => {
        const c = sec.cloneNode(true);
        c.removeAttribute('data-cms');
        sec.after(freshIds(c));
      });
      if (wasShared) core.toast('Copied. The copy is not shared, so changes to it stay on this page.');
    } });
    core.addSectionAction({ act: 'sec-del', run: (sec, region) => {
      const msg = isShared(sec)
        ? `Remove the shared section “${nameOf(sec)}” from this page? Other pages keep it. You can undo with Ctrl+Z.`
        : 'Delete this whole section? You can undo with Ctrl+Z.';
      if (!confirm(msg)) return;
      core.mutate(region, () => sec.remove());
      core.select(null);
    } });

    /* ------------------------------------------------------------ settings panel */
    let target = null;
    const targetBox = d.createElement('div');
    targetBox.className = 'box sx-target';
    ui.prepend(targetBox);
    function placeTarget() {
      const open = core.R.panel.classList.contains('show') && core.R.panel.querySelector('[data-sx="settings"]');
      if (!open || !target || !target.isConnected) { targetBox.style.display = 'none'; return; }
      const r = target.getBoundingClientRect();
      Object.assign(targetBox.style, { display: 'block', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    }
    let tRaf = 0;
    const queueTarget = () => { if (!tRaf) tRaf = requestAnimationFrame(() => { tRaf = 0; placeTarget(); }); };
    addEventListener('scroll', queueTarget, { passive: true, capture: true });
    addEventListener('resize', queueTarget);
    new MutationObserver(queueTarget).observe(core.R.panel, { attributes: true, attributeFilter: ['class'], childList: true });

    core.addPanel('sec-settings', () => drawSettings());
    let targetAt = null;   // where the section is, to find it again after undo replaces the page's HTML
    function openSettings(sec) {
      target = sec;
      core.closePanel();
      core.togglePanel('sec-settings');
    }

    function currentBg(sec) {
      if (sec.hasAttribute('data-cms-bg')) return 'photo';
      const cls = new Set(sec.classList);
      let best = -1;
      let bestN = -1;
      BGS.forEach((b, i) => {
        const t = tokens(b.class);
        if (t.every((c) => cls.has(c)) && t.length > bestN) { best = i; bestN = t.length; }
      });
      return best;
    }
    const hasPadding = (sec) => {
      const cs = getComputedStyle(sec);
      return sec.hasAttribute('data-cms-space') || parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) > 8;
    };
    function mediaIn(el) { return el.matches('img,picture,video,iframe,figure') || el.querySelector('img,picture,video,iframe'); }
    /** The section's two-column layout with an image on one side, if it has one. */
    function twoColumns(sec) {
      const queue = [sec];
      let n = 0;
      while (queue.length && n++ < 80) {
        const el = queue.shift();
        const kids = [...el.children].filter((c) => isSectionEl(c) && getComputedStyle(c).display !== 'none' && !c.matches('.sr-only'));
        if (kids.length === 2 && /grid|flex/.test(getComputedStyle(el).display)) {
          const m = kids.map((k) => Boolean(mediaIn(k)));
          const other = kids[m[0] ? 1 : 0];
          if (m[0] !== m[1] && other.querySelector('h1,h2,h3,h4,p')) return { container: el, kids, media: m[0] ? 0 : 1 };
        }
        queue.push(...kids);
      }
      return null;
    }

    const seg = (legend, name, options, value, hint = '') => `<fieldset class="sx-seg"><legend>${esc(legend)}</legend>${hint ? `<p class="muted">${esc(hint)}</p>` : ''}
      <div class="sx-opts">${options.map(([v, label]) => `<label><input type="radio" name="${name}" value="${esc(v)}" ${String(v) === String(value) ? 'checked' : ''}><span>${esc(label)}</span></label>`).join('')}</div></fieldset>`;
    const FOCUS = [['0% 0%', 'Top left'], ['50% 0%', 'Top'], ['100% 0%', 'Top right'], ['0% 50%', 'Left'], ['50% 50%', 'Centre'], ['100% 50%', 'Right'], ['0% 100%', 'Bottom left'], ['50% 100%', 'Bottom'], ['100% 100%', 'Bottom right']];

    function drawSettings(focusName) {
      if ((!target || !target.isConnected) && targetAt) {
        const region = core.regionByKey(targetAt.key);
        const again = region && region.children[targetAt.index];
        if (again) target = again;
      }
      const sec = target;
      if (sec && sec.isConnected) {
        const region = pageRegion(sec);
        targetAt = region ? { key: core.keyOf(region), index: [...region.children].indexOf(sec) } : null;
      }
      if (!sec || !sec.isConnected) {
        const pb = core.openPanel('Section settings', '<p>That section is no longer on the page. Point at a section and press its settings button.</p>');
        pb.dataset.sx = 'settings';
        return;
      }
      const sh = isShared(sec);
      const bg = currentBg(sec);
      const two = twoColumns(sec);
      const src = sec.getAttribute('data-cms-bg');
      const focus = sec.getAttribute('data-cms-focus') || '50% 50%';
      const bgOptions = [...(BGS.length ? BGS.map((b, i) => [i, b.label]) : [[-1, 'As designed']]), ['photo', 'Photo']];
      const body = `
        ${sh ? `<div class="note sx-note"><b>${icon('shared')}Shared section · ${esc(nameOf(sec))}</b>
            <span>Edits to its words, pictures and settings appear on every page that uses it.</span>
            <div class="row"><button class="btn" type="button" data-x="rename">Rename</button><button class="btn" type="button" data-x="unshare">Stop sharing</button></div></div>`
        : `<div class="note sx-note"><span>Use this section on several pages and change it in one place.</span>
            <div class="row"><button class="btn" type="button" data-x="share">${icon('shared')}Share this section</button></div></div>`}
        <form data-sx-form>
        ${seg('Background', 'bg', bgOptions, BGS.length ? bg : (bg === 'photo' ? 'photo' : -1))}
        ${src ? `<div class="sx-photo"><div class="sx-focus" style="background-image:url(&quot;${esc(src)}&quot;)" role="group" aria-label="Part of the photo to keep in view">
            ${FOCUS.map(([v, l]) => `<button type="button" data-focus="${v}" aria-label="${l}" aria-pressed="${v === focus}" title="${l}"></button>`).join('')}</div>
            <div class="sx-photo-side"><p class="muted">Pick the part of the photo to keep in view. A dark tint keeps the text readable.</p>
            <button class="btn" type="button" data-x="photo">${icon('image')}Change photo</button></div></div>` : ''}
        ${hasPadding(sec) ? seg('Spacing', 'space', [['compact', 'Compact'], ['', 'Normal'], ['roomy', 'Roomy']], sec.getAttribute('data-cms-space') || '') : ''}
        ${seg('Alignment', 'align', [['', 'Left'], ['center', 'Centre']], sec.getAttribute('data-cms-align') || '')}
        ${two ? seg('Image side', 'side', [['0', 'Left'], ['1', 'Right']], String(two.media), 'On phones the columns stack, and the left one shows first.') : ''}
        ${seg('Show on', 'show', [['', 'All devices'], ['phone', 'Phones only'], ['large', 'Larger screens only']], sec.getAttribute('data-cms-show') || '')}
        </form>
        <p class="muted">Changes are saved as a draft. Press Ctrl+Z to undo.</p>`;
      const pb = core.openPanel('Section settings', body);
      pb.dataset.sx = 'settings';
      queueTarget();
      if (focusName) pb.querySelector(`input[name="${focusName}"]:checked, [data-focus][aria-pressed="true"]`)?.focus();
      pb.addEventListener('change', (e) => {
        const inp = e.target.closest('input[type=radio]');
        if (inp) apply(inp.name, inp.value);
      });
      // Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y work while the panel has focus too.
      pb.addEventListener('keydown', (e) => {
        if (!(e.ctrlKey || e.metaKey) || !/^[zy]$/i.test(e.key) || /^(TEXT|SEARCH|EMAIL|URL)/i.test(e.target.type || '')) return;
        e.preventDefault();
        const redo = e.key.toLowerCase() === 'y' || e.shiftKey;
        core.R.bar.querySelector(`[data-act="${redo ? 'redo' : 'undo'}"]`)?.click();
        const name = e.target.name;
        setTimeout(() => { core.redrawSectionBar(); drawSettings(name); }, 0);
      });
      pb.addEventListener('click', (e) => {
        const f = e.target.closest('[data-focus]');
        if (f) { setFocus(f.dataset.focus); return; }
        const x = e.target.closest('[data-x]')?.dataset.x;
        if (x === 'photo') choosePhoto();
        if (x === 'share') shareFlow(target);
        if (x === 'rename') renameFlow(target);
        if (x === 'unshare') unshare(target);
      });
    }

    function changed(focusName) {
      core.redrawSectionBar();
      drawSettings(focusName);
    }
    function setAttr(sec, name, value) { if (value) sec.setAttribute(name, value); else sec.removeAttribute(name); }

    function apply(name, value) {
      const sec = target;
      if (!sec || !sec.isConnected) { drawSettings(); return; }
      const region = pageRegion(sec);
      if (name === 'bg') {
        if (value === 'photo') { if (!sec.hasAttribute('data-cms-bg')) choosePhoto(); return; }
        const opt = BGS[+value];
        core.mutate(region, () => {
          clearPhoto(sec);
          BGS.forEach((b) => tokens(b.class).forEach((c) => sec.classList.remove(c)));
          if (opt) tokens(opt.class).forEach((c) => sec.classList.add(c));
          if (!sec.classList.length) sec.removeAttribute('class');
        });
      } else if (name === 'space') core.mutate(region, () => setAttr(sec, 'data-cms-space', value));
      else if (name === 'align') core.mutate(region, () => setAttr(sec, 'data-cms-align', value));
      else if (name === 'show') {
        core.mutate(region, () => setAttr(sec, 'data-cms-show', value));
        if (value) core.toast(value === 'phone' ? 'Visitors see this section only on phones. You still see it while editing.' : 'Visitors see this section only on tablets and computers. You still see it while editing.');
      } else if (name === 'side') {
        const two = twoColumns(sec);
        if (two && String(two.media) !== value) core.mutate(contentRegion(sec), () => two.kids[0].before(two.kids[1]));
      }
      if (isShared(sec)) syncShared();
      changed(name);
    }
    function clearPhoto(sec) {
      if (!sec.hasAttribute('data-cms-bg')) return;
      sec.removeAttribute('data-cms-bg');
      sec.removeAttribute('data-cms-focus');
      stripBgStyle(sec);
      PHOTO_CLASS.forEach((c) => sec.classList.remove(c));
    }
    async function choosePhoto() {
      const sec = target;
      const chosen = await core.pickImage({ title: 'Background photo', withAlt: false, maxW: 2400, current: sec.getAttribute('data-cms-bg') || '' });
      if (!chosen) { drawSettings('bg'); return; }
      const path = sameOriginPath(chosen.url);
      if (!path) { core.toast('Use an image uploaded here or one from the site.', true); return; }
      if (!sec.isConnected) return;
      core.mutate(pageRegion(sec), () => {
        BGS.forEach((b) => tokens(b.class).forEach((c) => sec.classList.remove(c)));
        PHOTO_CLASS.forEach((c) => sec.classList.add(c));
        const focus = sec.getAttribute('data-cms-focus') || '50% 50%';
        sec.setAttribute('data-cms-bg', path);
        sec.setAttribute('data-cms-focus', focus);
        sec.setAttribute('style', bgStyle(path, focus, sec.getAttribute('style') || ''));
      });
      if (isShared(sec)) syncShared();
      core.toast('Photo background added. Pick the part of the photo to keep in view.');
      changed('bg');
    }
    function setFocus(focus) {
      const sec = target;
      if (!sec || !sec.isConnected || !sec.hasAttribute('data-cms-bg')) return;
      core.mutate(pageRegion(sec), () => {
        sec.setAttribute('data-cms-focus', focus);
        sec.setAttribute('style', bgStyle(sec.getAttribute('data-cms-bg'), focus, sec.getAttribute('style') || ''));
      });
      if (isShared(sec)) syncShared();
      changed('focus');
    }

    /* ------------------------------------------------------------ shared sections */
    function smallModal(title, body, foot) {
      const m = core.modal({ title, body: `<div class="sx-mbody">${body}</div>`, foot });
      m.el.classList.add('sx-modal');
      setTimeout(() => m.el.querySelector('input[type=text]')?.focus(), 0);
      return m;
    }
    async function pool(items, n, fn) {
      const queue = [...items];
      await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => { while (queue.length) await fn(queue.shift()); }));
    }
    /** Other pages whose page region has an identical copy of this section (developer partials). */
    async function findCopies(sec, regionKey, onProgress) {
      const want = norm(sec);
      const pages = (await core.sitePages()).filter((p) => p.path !== S.path);
      const found = [];
      let done = 0;
      await pool(pages, 4, async (p) => {
        try {
          const res = await fetch(`${p.path}?edit`, { credentials: 'same-origin' });
          if (res.ok && (res.headers.get('content-type') || '').includes('text/html')) {
            const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
            const main = doc.querySelector(`[data-cms="${CSS.escape(regionKey)}"]`);
            const child = main && [...main.children].find((c) => !c.hasAttribute('data-cms') && norm(c) === want);
            if (child) found.push({ path: p.path, main, child, draft: Boolean(p.draft) });
          }
        } catch { /* skip that page */ }
        onProgress(++done, pages.length);
      });
      return found.sort((a, b) => a.path.localeCompare(b.path));
    }
    const pageName = (p) => (p === '/' ? 'Home' : p);

    function shareFlow(sec) {
      if (!sec || !sec.isConnected || isShared(sec)) return;
      const region = pageRegion(sec);
      const suggested = short(headingOf(sec), 40).replace(/[.…]$/, '');
      const m = smallModal('Share this section', `
        <p>A shared section is changed in one place and updates on every page that uses it. Give it a name your team will recognise.</p>
        <div class="field"><label for="sx-name">Name</label><input id="sx-name" type="text" maxlength="60" value="${esc(suggested)}" placeholder="For example: Contact band"></div>
        <div data-r="copies" class="note"><span class="muted">Looking for the same section on other pages…</span></div>`,
      '<button class="btn" data-act="close">Cancel</button><button class="btn primary" data-x="go">Share section</button>');
      let copies = [];
      const box = m.el.querySelector('[data-r="copies"]');
      findCopies(sec, core.keyOf(region), (n, total) => { if (n < total) box.innerHTML = `<span class="muted">Looking for the same section on other pages… ${n} of ${total}</span>`; })
        .then((found) => {
          copies = found;
          box.innerHTML = found.length
            ? `<label class="sx-check"><input type="checkbox" data-r="link" checked><span><b>Also link the same section on ${found.length} other page${found.length === 1 ? '' : 's'}</b>
               <span class="muted">They get a draft that uses the shared section. Publish them when you’re ready.</span></span></label>
               <details class="sx-pages"><summary>Show the pages</summary><ul>${found.map((f) => `<li>${esc(pageName(f.path))}</li>`).join('')}</ul></details>`
            : '<span class="muted">No other page has an identical copy of this section. You can add it to other pages from “Add a section”, under Shared.</span>';
        })
        .catch(() => { box.innerHTML = '<span class="muted">Couldn’t check the other pages. You can still share this section.</span>'; });
      m.el.querySelector('[data-x="go"]').addEventListener('click', async (e) => {
        const name = m.el.querySelector('#sx-name').value.replace(/\s+/g, ' ').trim().slice(0, 60) || 'Shared section';
        const link = copies.length && m.el.querySelector('[data-r="link"]')?.checked;
        e.target.disabled = true;
        e.target.textContent = 'Sharing…';
        const id = rid(8);
        const key = `@s-${id}`;
        core.mutate(region, () => sec.setAttribute('data-cms', key));
        patchShared(id, { name, tag: sec.localName, attrs: attrsOf(sec) });
        core.markDirty(sec);
        await core.save();
        const linked = [];
        const failed = [];
        if (link) {
          await pool(copies, 3, async (c) => {
            try {
              c.child.setAttribute('data-cms', key);
              await core.api('PUT', 'draft', { path: c.path, regions: { [core.keyOf(region)]: { html: c.main.innerHTML, base: c.main.getAttribute('data-cms-v') || null } } });
              linked.push(c);
            } catch { failed.push(c.path); }
          });
          core.clearPagesCache();
        }
        m.close();
        core.redrawSectionBar();
        if (target === sec) drawSettings();
        sharedDone(name, linked, failed);
      });
    }
    function sharedDone(name, linked, failed) {
      if (!linked.length && !failed.length) { core.toast(`Shared as “${name}”. Publish to make it live.`); return; }
      const canPublish = S.user.role !== 'author';
      const n = linked.length;
      const busy = linked.filter((c) => c.draft).length;
      const m = smallModal('Section shared', `
        <p><b>“${esc(name)}” is now a shared section.</b></p>
        ${n ? `<p>It’s linked on ${n} other page${n === 1 ? '' : 's'} as unpublished changes. ${canPublish ? 'Publish this page and those pages now to make it live everywhere, or do it later from the Pages panel.' : 'An editor can publish them from the Pages panel.'}</p>` : ''}
        ${n && busy && canPublish ? `<p class="note">${busy} of those page${busy === 1 ? ' already has' : 's already have'} other unpublished changes. Publishing makes those live too.</p>` : ''}
        ${failed.length ? `<p class="note">Couldn’t link: ${failed.map((p) => esc(pageName(p))).join(', ')}.</p>` : ''}`,
      `<button class="btn" data-act="close">Later</button>${canPublish && n ? `<button class="btn primary" data-x="pub">Publish ${n + 1} pages</button>` : ''}`);
      // Publishes this page (with the usual checks), then only the pages that were just linked.
      m.el.querySelector('[data-x="pub"]')?.addEventListener('click', async () => {
        m.close();
        let ok = false;
        const off = core.on('published', () => { ok = true; });
        try { await core.publishNow(); } finally { off(); }
        if (!ok) return;
        let done = 0;
        const bad = [];
        await pool(linked, 3, async (c) => {
          try { await core.api('POST', 'publish', { path: c.path }); done++; } catch { bad.push(c.path); }
        });
        core.clearPagesCache();
        if (bad.length) core.toast(`Published here and on ${done} other pages. Couldn’t publish: ${bad.map(pageName).join(', ')}. Try again from the Pages panel.`, true);
        else core.toast(`Published here and on ${done} other page${done === 1 ? '' : 's'}. Visitors see the shared section now.`);
      });
    }
    function renameFlow(sec) {
      if (!sec || !isShared(sec)) return;
      const m = smallModal('Rename shared section', `<div class="field"><label for="sx-name">Name</label><input id="sx-name" type="text" maxlength="60" value="${esc(nameOf(sec))}"></div>`,
        '<button class="btn" data-act="close">Cancel</button><button class="btn primary" data-x="go">Save name</button>');
      const go = () => {
        const name = m.el.querySelector('#sx-name').value.replace(/\s+/g, ' ').trim().slice(0, 60);
        if (!name) return;
        patchShared(idOf(sec), { name });
        m.close();
        core.redrawSectionBar();
        drawSettings();
        core.toast('Name saved as a draft.');
      };
      m.el.querySelector('[data-x="go"]').addEventListener('click', go);
      m.el.querySelector('#sx-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    }
    async function unshare(sec) {
      if (!sec || !isShared(sec)) return;
      if (!confirm(`Stop sharing here? This page keeps its own copy of “${nameOf(sec)}” that you can change on its own. Other pages keep the shared section.`)) return;
      await core.save();
      core.mutate(pageRegion(sec), () => sec.removeAttribute('data-cms'));
      core.redrawSectionBar();
      drawSettings();
      core.toast('This page now has its own copy. Press Ctrl+Z to undo.');
    }

    /* ------------------------------------------------------------ section library */
    let lib = null;   // { after, region }
    core.addPanel('sec-lib', () => drawLibrary());
    function openLibrary(after, region) {
      lib = { after, region };
      core.closePanel();
      core.togglePanel('sec-lib');
    }
    const headLinks = () => [...d.head.querySelectorAll('link[rel="stylesheet"], link[rel="preconnect"], style[data-editlayer-sections], style#editlayer-theme')]
      .filter((l) => !/\/_cms\//.test(l.getAttribute('href') || '')).map((l) => l.outerHTML).join('');
    /** Site styles (colours, corners, fonts…) set live on <html> while editing, so previews match the page. */
    function liveVars() {
      const st = d.documentElement.style;
      const out = [];
      for (let i = 0; i < st.length; i++) if (st[i].startsWith('--')) out.push(`${st[i]}:${st.getPropertyValue(st[i])}`);
      return out.length ? `<style>:root{${out.join(';').replace(/</g, '\\3c ')}}</style>` : '';
    }
    function thumb(html) {
      return `<!doctype html><html lang="en"><head><meta charset="utf-8"><base href="${esc(location.origin)}/">${headLinks()}${liveVars()}
        <style>html,body{overflow:hidden!important}body{pointer-events:none}</style></head><body>${html}</body></html>`;
    }
    const card = (i, title, note, extra = '') => `<li class="sx-card">
      <div class="sx-thumb" aria-hidden="true"><iframe tabindex="-1" sandbox loading="lazy" title="" data-i="${i}"></iframe></div>
      <div class="sx-meta"><span class="grow"><b>${esc(title)}</b>${note ? `<span>${esc(note)}</span>` : ''}</span>${extra}</div></li>`;
    function fillThumbs(list, htmlFor) {
      const scale = (list.querySelector('.sx-thumb')?.clientWidth || 340) / 1280;
      list.querySelectorAll('iframe[data-i]').forEach((f) => {
        f.style.transform = `scale(${scale})`;
        f.srcdoc = thumb(htmlFor(+f.dataset.i));
      });
    }

    let blocksCache = null;
    async function loadBlocks() {
      if (!blocksCache) {
        blocksCache = fetch(BLOCKS, { credentials: 'same-origin' }).then(async (res) => {
          if (!res.ok) return [];
          const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
          const main = doc.querySelector('main') || doc.body;
          return [...main.children].filter((c) => c.hasAttribute('data-block'));
        }).catch(() => []);
      }
      return blocksCache;
    }

    function drawLibrary() {
      if (!lib || !lib.after.isConnected) { core.openPanel('Add a section', '<p>Point at a section and press its + button to add one below it.</p>'); return; }
      const pb = core.openPanel('Add a section', `<p>Pick a section to add below the one you chose. Then click its words and pictures to change them.</p>
        <div class="tabs sx-tabs" role="tablist"><button type="button" role="tab" class="on" aria-selected="true" data-tab="ready">Ready-made</button>
        <button type="button" role="tab" aria-selected="false" data-tab="shared">Shared</button><button type="button" role="tab" aria-selected="false" data-tab="page">From a page</button></div>
        <div data-pane="ready"></div><div data-pane="shared" hidden></div><div data-pane="page" hidden></div>`);
      pb.dataset.sx = 'library';
      const panes = Object.fromEntries([...pb.querySelectorAll('[data-pane]')].map((p) => [p.dataset.pane, p]));
      const loaded = new Set();
      const show = (tab) => {
        pb.querySelectorAll('[data-tab]').forEach((b) => { b.classList.toggle('on', b.dataset.tab === tab); b.setAttribute('aria-selected', String(b.dataset.tab === tab)); });
        Object.entries(panes).forEach(([k, p]) => { p.hidden = k !== tab; });
        if (loaded.has(tab)) return;
        loaded.add(tab);
        ({ ready: paneReady, shared: paneShared, page: panePage })[tab](panes[tab]);
      };
      pb.querySelector('.sx-tabs').addEventListener('click', (e) => { const t = e.target.closest('[data-tab]'); if (t) show(t.dataset.tab); });
      pb.querySelector('.sx-tabs').addEventListener('keydown', (e) => {
        if (!/^Arrow(Left|Right)$/.test(e.key)) return;
        const tabs = [...pb.querySelectorAll('[data-tab]')];
        const i = tabs.indexOf(e.target.closest('[data-tab]'));
        const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
        next.focus();
        show(next.dataset.tab);
      });
      show('ready');
    }

    function insert(node, { keepShared = false } = {}) {
      const { after, region } = lib;
      if (!after.isConnected) { core.toast('That section is no longer on the page.', true); return; }
      core.stripJunk(node);
      node.removeAttribute('data-cms-hidden');
      node.removeAttribute('data-block');
      node.removeAttribute('data-block-note');
      if (!keepShared) { node.removeAttribute('data-cms'); freshIds(node); }
      node.querySelectorAll('[data-cms]').forEach((n) => n.removeAttribute('data-cms'));
      core.notePageTags(node);
      core.mutate(region, () => after.after(node));
      core.openDetails();
      core.closePanel();
      node.scrollIntoView({ behavior: 'smooth', block: 'start' });
      core.root.activeElement?.blur?.();   // so Ctrl+Z reaches the page straight away
      core.toast('Section added. Click any text in it to change it.');
    }

    async function paneReady(pane) {
      pane.innerHTML = '<p class="muted">Loading…</p>';
      const blocks = await loadBlocks();
      if (!blocks.length) { pane.innerHTML = '<p class="note">This site has no ready-made sections yet. Use “From a page” to copy one.</p>'; return; }
      pane.innerHTML = `<ul class="sx-cards">${blocks.map((b, i) => card(i, b.getAttribute('data-block'), b.getAttribute('data-block-note') || '',
        `<button class="btn" type="button" data-ins="${i}">Add</button>`)).join('')}</ul>`;
      fillThumbs(pane, (i) => blocks[i].outerHTML);
      pane.addEventListener('click', (e) => {
        const b = e.target.closest('[data-ins]');
        if (b) insert(d.importNode(blocks[+b.dataset.ins], true));
      });
    }

    async function paneShared(pane) {
      pane.innerHTML = '<p class="muted">Loading…</p>';
      let list = [];
      try { ({ shared: list } = await core.api('GET', 'sections')); } catch (err) { pane.innerHTML = `<p class="note">${esc(err.message)}</p>`; return; }
      if (!list.length) {
        pane.innerHTML = '<p class="note">No shared sections yet. To make one, open a section’s settings (the gear) and choose “Share this section”.</p>';
        return;
      }
      pane.innerHTML = `<p class="muted">Shared sections change everywhere at once when you edit them.</p><ul class="sx-cards">${list.map((s, i) => {
        const here = Boolean(core.regionByKey(s.key));
        const where = s.pages.length ? `On ${s.pages.length} page${s.pages.length === 1 ? '' : 's'}` : 'Not on any page yet';
        return card(i, s.name, `${where}${s.draft ? ' · unpublished changes' : ''}`,
          here ? '<span class="pill cur">On this page</span>' : `<button class="btn" type="button" data-ins="${i}">Add</button>`);
      }).join('')}</ul>`;
      const build = (s) => {
        const el = d.createElement(s.tag || 'section');
        for (const [k, v] of Object.entries(s.attrs || {})) if (v !== '') el.setAttribute(k, v);
        if (el.hasAttribute('data-cms-bg')) el.setAttribute('style', bgStyle(el.getAttribute('data-cms-bg'), el.getAttribute('data-cms-focus') || '50% 50%'));
        el.setAttribute('data-cms', s.key);
        el.innerHTML = s.html;
        return el;
      };
      fillThumbs(pane, (i) => build(list[i]).outerHTML);
      pane.addEventListener('click', (e) => {
        const b = e.target.closest('[data-ins]');
        if (!b) return;
        const s = list[+b.dataset.ins];
        if (!shared[s.id]) shared[s.id] = { name: s.name, tag: s.tag, attrs: s.attrs };
        insert(build(s), { keepShared: true });
      });
    }

    async function panePage(pane) {
      const pages = await core.sitePages();
      pane.innerHTML = `<div class="field"><label for="sx-from">From page</label><select id="sx-from">${pages.map((p) => `<option value="${esc(p.path)}" ${p.path === S.path ? 'selected' : ''}>${esc(pageName(p.path))}</option>`).join('')}</select></div>
        <div data-r="list"></div>`;
      const box = pane.querySelector('[data-r="list"]');
      let sections = [];
      const load = async (path) => {
        box.innerHTML = '<p class="muted">Loading…</p>';
        try {
          let src;
          if (path === S.path) src = lib.region;
          else {
            const html = await (await fetch(path, { credentials: 'same-origin' })).text();
            const doc2 = new DOMParser().parseFromString(html, 'text/html');
            src = doc2.querySelector(`[data-cms="${CSS.escape(core.keyOf(lib.region))}"]`) || doc2.querySelector('[data-cms]:not([data-cms^="@"])');
          }
          sections = src ? [...src.children].filter(isSectionEl) : [];
          if (!sections.length) { box.innerHTML = '<p class="note">No sections found on that page.</p>'; return; }
          box.innerHTML = `<ul class="sx-cards">${sections.map((s, i) => card(i, short(headingOf(s) || 'Section without a heading', 70),
            isShared(s) ? `Copy of the shared section “${(shared[idOf(s)] && shared[idOf(s)].name) || 'Shared section'}”` : '',
            `<button class="btn" type="button" data-ins="${i}">Add</button>`)).join('')}</ul>`;
          fillThumbs(box, (i) => { const c = sections[i].cloneNode(true); c.removeAttribute('data-cms-hidden'); return c.outerHTML; });
        } catch (err) { box.innerHTML = `<p class="note">${esc(err.message)}</p>`; }
      };
      pane.querySelector('#sx-from').addEventListener('change', (e) => load(e.target.value));
      box.addEventListener('click', (e) => {
        const b = e.target.closest('[data-ins]');
        if (b) insert(d.importNode(sections[+b.dataset.ins], true));
      });
      load(S.path);
    }

    /* ------------------------------------------------------------ drag to reorder */
    let lastDragEnd = 0;
    core.on('sbar', (bar, section) => {
      const h = bar.querySelector('[data-act="sec-drag"]');
      if (h) h.addEventListener('pointerdown', (e) => startDrag(e, section));
    });
    function startDrag(e, section) {
      if (e.button !== 0 || !section.isConnected) return;
      e.preventDefault();
      core.finishEdit();
      const region = pageRegion(section);
      if (!region) return;
      const layer = d.createElement('div');
      layer.className = 'sx-layer';
      const ghost = d.createElement('div');
      ghost.className = 'sx-ghost';
      const line = d.createElement('div');
      line.className = 'sx-line';
      line.innerHTML = '<span>Move here</span>';
      let lastY = e.clientY;
      const startY = e.clientY;
      let moved = false;
      let drop = null;
      let raf = 0;
      const others = () => [...region.children].filter((c) => c !== section && isSectionEl(c) && c.getBoundingClientRect().height > 0);
      const compute = () => {
        const list = others();
        for (const c of list) {
          const r = c.getBoundingClientRect();
          if (lastY < r.top + r.height / 2) return { before: c, y: r.top };
        }
        const last = list[list.length - 1];
        return { before: null, after: last, y: last ? last.getBoundingClientRect().bottom : 0 };
      };
      const draw = () => {
        const r = section.getBoundingClientRect();
        Object.assign(ghost.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
        if (!moved) return;
        drop = compute();
        const rr = region.getBoundingClientRect();
        const same = drop.before === section.nextElementSibling || (!drop.before && drop.after === section.previousElementSibling && !section.nextElementSibling);
        line.classList.toggle('same', same);
        Object.assign(line.style, { display: 'block', left: `${Math.max(4, rr.left)}px`, width: `${Math.min(innerWidth - 8, rr.width)}px`, top: `${Math.max(2, Math.min(innerHeight - 6, drop.y - 2))}px` });
      };
      const tick = () => {
        raf = 0;
        const edge = Math.min(90, innerHeight / 5);
        let dy = 0;
        if (moved && lastY < edge) dy = -Math.ceil(((edge - lastY) / edge) * 22 + 2);
        else if (moved && lastY > innerHeight - edge) dy = Math.ceil(((lastY - (innerHeight - edge)) / edge) * 22 + 2);
        if (dy) scrollBy(0, dy);
        draw();
        if (dy) raf = requestAnimationFrame(tick);
      };
      const kick = () => { if (!raf) raf = requestAnimationFrame(tick); };
      const onMove = (ev) => {
        lastY = ev.clientY;
        if (!moved && Math.abs(lastY - startY) > 5) { moved = true; ui.classList.add('sx-dragging'); }
        kick();
      };
      const end = (commit) => {
        removeEventListener('pointermove', onMove, true);
        removeEventListener('pointerup', onUp, true);
        removeEventListener('pointercancel', onCancel, true);
        removeEventListener('keydown', onKey, true);
        cancelAnimationFrame(raf);
        layer.remove(); ghost.remove(); line.remove();
        ui.classList.remove('sx-dragging');
        // A plain click on the handle (no drag) still shows the hint about dragging.
        if (moved) lastDragEnd = Date.now();
        if (!commit || !moved || !drop) return;
        const before = region.innerHTML;
        core.mutate(region, () => {
          if (drop.before) drop.before.before(section);
          else if (drop.after) drop.after.after(section);
        });
        if (region.innerHTML !== before) {
          section.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          core.toast('Section moved. Press Ctrl+Z to put it back.');
        }
      };
      const onUp = () => end(true);
      const onCancel = () => end(false);
      const onKey = (ev) => {
        if (ev.key !== 'Escape') return;
        ev.preventDefault();
        ev.stopPropagation();
        end(false);
        core.toast('Move cancelled.');
      };
      addEventListener('pointermove', onMove, true);
      addEventListener('pointerup', onUp, true);
      addEventListener('pointercancel', onCancel, true);
      addEventListener('keydown', onKey, true);
      ui.append(layer, ghost, line);
      draw();
    }
  });
