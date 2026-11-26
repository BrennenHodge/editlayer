  /* Documents, video, focal points and background images.
     - Link popover: "Upload a file" / "Choose a file" fill the link with an uploaded document.
     - Links to documents: toolbar button to swap the file.
     - Videos (YouTube, Vimeo, <video>): selectable; "Change video", delete; "Insert a video" on paragraphs.
     - Images: "Focus" sets which part stays in view when the picture is cropped (object-position).
     - Inline background images: selectable on empty areas; Replace and Focus (background-position). */
  feature('media', (core) => {
    const { d, R, esc, icon, toast, api } = core;

    core.addIcons({
      'mx-video': '<rect x="2" y="5" width="14" height="14" rx="2"/><path d="m16 10 6-3.5v11L16 14"/>',
      'mx-video-add': '<rect x="2" y="5" width="14" height="14" rx="2"/><path d="m16 10 6-3.5v11L16 14"/><path d="M9 9v6M6 12h6"/>',
      'mx-focus': '<circle cx="12" cy="12" r="3"/><path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3"/>',
      'mx-file': '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>',
      'mx-bg': '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><circle cx="8.5" cy="14" r="1.5"/><path d="m21 18-4.5-4.5L11 19"/>',
    });

    /* Where the pointer is. Listening on window in the capture phase runs before the editor's own
       listeners on document, so classifiers below see the position of the current event. */
    let pt = null;
    const track = (e) => { pt = { x: e.clientX, y: e.clientY }; };
    addEventListener('mousemove', track, { capture: true, passive: true });
    addEventListener('pointerdown', track, { capture: true, passive: true });
    addEventListener('click', track, { capture: true, passive: true });
    const inside = (r, p) => p && p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;

    function overText(p) {
      if (!p) return false;
      let node = null;
      try {
        if (d.caretPositionFromPoint) node = d.caretPositionFromPoint(p.x, p.y)?.offsetNode || null;
        else if (d.caretRangeFromPoint) node = d.caretRangeFromPoint(p.x, p.y)?.startContainer || null;
      } catch { return false; }
      if (!node || node.nodeType !== 3 || !/\S/.test(node.textContent)) return false;
      const range = d.createRange();
      range.selectNodeContents(node);
      return [...range.getClientRects()].some((r) => p.x >= r.left - 2 && p.x <= r.right + 2 && p.y >= r.top - 2 && p.y <= r.bottom + 2);
    }

    /** Runs fn with the popover open; calls onGone once if it closes without being saved. */
    function watchPop(form, onGone) {
      const mo = new MutationObserver(() => {
        if (!R.pop.classList.contains('show') || !R.pop.contains(form)) { mo.disconnect(); onGone(); }
      });
      mo.observe(R.pop, { attributes: true, attributeFilter: ['class'], childList: true });
      form.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); core.closePop(); } });
      return () => mo.disconnect();
    }

    const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

    /* ================================================================ documents */
    const DOC_EXT = ['pdf', 'docx', 'xlsx', 'pptx', 'txt', 'csv'];
    const DOC_ACCEPT = '.pdf,.docx,.xlsx,.pptx,.txt,.csv,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain,text/csv';
    const MAX_DOC = 25 * 1024 * 1024;
    const isDocHref = (h) => /^\/_cms\/files\//.test(h || '') || /\.(pdf|docx?|xlsx?|pptx?|txt|csv)([?#]|$)/i.test(h || '');
    let filesCache = null;

    function docProblem(file) {
      const ext = (file.name.toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || '';
      if (!DOC_EXT.includes(ext)) {
        if (/^(doc|xls|ppt)$/.test(ext)) return `Older .${ext} files can’t be uploaded. Open it and use Save As to save it as .${ext}x, then upload that.`;
        return 'Use a PDF, Word (.docx), Excel (.xlsx), PowerPoint (.pptx), text (.txt) or CSV file.';
      }
      if (file.size > MAX_DOC) return `That file is ${fmtSize(file.size)}. Files must be 25 MB or smaller.`;
      if (!file.size) return 'That file is empty.';
      return '';
    }
    async function uploadDoc(file) {
      const problem = docProblem(file);
      if (problem) throw new Error(problem);
      const fd = new FormData();
      fd.append('file', file, file.name);
      const r = await api('POST', 'files', fd);
      filesCache = null;
      return r.file;
    }
    /** A hidden file input in the editor UI; resolves with the chosen file (or never, if cancelled). */
    function chooseFile(onFile) {
      const input = d.createElement('input');
      input.type = 'file';
      input.accept = DOC_ACCEPT;
      input.hidden = true;
      R.pop.parentNode.append(input);
      input.addEventListener('change', () => { const f = input.files[0]; input.remove(); if (f) onFile(f); });
      input.addEventListener('cancel', () => input.remove());
      input.click();
    }

    core.on('pop:link', (form) => {
      const href = form.querySelector('input[name="href"]');
      const actions = form.querySelector('.row.end');
      if (!href || !actions) return;
      const box = d.createElement('div');
      box.className = 'mx-files';
      box.innerHTML = `<div class="mx-acts"><button type="button" class="btn mx-sm" data-mx="up">${icon('upload')}Upload a file</button>
        <button type="button" class="btn mx-sm" data-mx="pick" aria-expanded="false">${icon('mx-file')}Choose a file</button></div>
        <p class="mx-note" data-mx="msg" role="status" hidden></p>
        <div class="mx-pick" data-mx="list" hidden></div>`;
      actions.before(box);
      const msg = box.querySelector('[data-mx="msg"]');
      const list = box.querySelector('[data-mx="list"]');
      const pickBtn = box.querySelector('[data-mx="pick"]');
      const apply = form.querySelector('button[value="ok"]');
      const say = (text, err = false) => { msg.hidden = !text; msg.textContent = text; msg.classList.toggle('err', err); core.queueDraw(); };
      const use = (f) => {
        href.value = f.url;
        say(`“${f.name}” is ready. Press Apply to link to it.`);
        apply?.focus();
      };
      box.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-mx]');
        if (!b) return;
        if (b.dataset.mx === 'up') {
          chooseFile(async (file) => {
            const problem = docProblem(file);
            if (problem) { say(problem, true); return; }
            box.querySelectorAll('button').forEach((x) => { x.disabled = true; });
            say(`Uploading “${file.name}”…`);
            try { use(await uploadDoc(file)); list.hidden = true; pickBtn.setAttribute('aria-expanded', 'false'); } catch (err) { say(err.message, true); }
            box.querySelectorAll('button').forEach((x) => { x.disabled = false; });
          });
        }
        if (b.dataset.mx === 'pick') {
          const open = list.hidden;
          list.hidden = !open;
          pickBtn.setAttribute('aria-expanded', String(open));
          if (open) await showFiles(list, use);
          core.queueDraw();
        }
      });
    });

    async function showFiles(list, use) {
      list.innerHTML = '<p class="mx-note">Loading…</p>';
      let files;
      try { filesCache = filesCache || (await api('GET', 'files')).files; files = filesCache; } catch (err) { list.innerHTML = `<p class="mx-note err">${esc(err.message)}</p>`; return; }
      if (!files.length) { list.innerHTML = '<p class="mx-note">No files uploaded yet. Use “Upload a file”.</p>'; core.queueDraw(); return; }
      list.innerHTML = `${files.length > 6 ? '<input type="text" class="mx-search" placeholder="Search files" aria-label="Search files">' : ''}<ul class="mx-flist"></ul>`;
      const ul = list.querySelector('ul');
      const draw = (q = '') => {
        const shown = files.filter((f) => !q || f.name.toLowerCase().includes(q.toLowerCase()));
        ul.innerHTML = shown.length ? shown.map((f) => `<li><button type="button" data-id="${esc(f.id)}"><span class="mx-kind" data-k="${esc(f.ext)}">${esc(f.ext.toUpperCase())}</span>
          <span class="mx-fname"><b>${esc(f.name)}</b><span>${esc(fmtSize(f.size))} · ${esc(core.when(f.at))}</span></span></button></li>`).join('') : '<li class="mx-note">No file matches.</li>';
        core.queueDraw();
      };
      draw();
      const search = list.querySelector('.mx-search');
      search?.addEventListener('input', (e) => draw(e.target.value.trim()));
      // Enter in the search box must not submit the link form.
      search?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ul.querySelector('button')?.focus(); } });
      ul.addEventListener('click', (e) => {
        const b = e.target.closest('[data-id]');
        if (!b) return;
        ul.querySelectorAll('.on').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        use(files.find((f) => f.id === b.dataset.id));
      });
    }

    core.addToolAction({
      act: 'mx-file-swap', icon: 'upload', order: 40,
      title: 'Replace the file this links to',
      when: (sel) => sel.type === 'text' && Boolean(core.linkOf(sel.el)) && isDocHref(core.linkOf(sel.el).getAttribute('href')),
      run: (sel) => {
        const a = core.linkOf(sel.el);
        const oldExt = ((a.getAttribute('href') || '').toLowerCase().match(/\.([a-z0-9]+)([?#]|$)/) || [])[1] || '';
        chooseFile(async (file) => {
          try {
            toast(`Uploading “${file.name}”…`);
            const f = await uploadDoc(file);
            core.mutate(core.regionOf(a), () => a.setAttribute('href', f.url));
            toast(f.ext !== oldExt && oldExt
              ? `Done. The link now opens “${f.name}”. It’s a different kind of file, so check the link’s words still fit.`
              : `Done. The link now opens “${f.name}”. Ctrl+Z undoes it.`);
          } catch (err) { toast(err.message, true); }
        });
      },
    });

    /* ================================================================ video */
    const PLAYER_SRC = /^https:\/\/(www\.)?(youtube\.com|youtube-nocookie\.com|player\.vimeo\.com)\//i;
    const isPlayer = (n) => Boolean(n && n.nodeType === 1 && (n.tagName === 'VIDEO' || (n.tagName === 'IFRAME' && PLAYER_SRC.test(n.getAttribute('src') || ''))));
    const playerIn = (el) => (isPlayer(el) ? el : [...el.querySelectorAll('iframe, video')].find(isPlayer) || null);

    /** What gets selected and deleted: the player, or a wrapper that holds only the player. Never a whole section. */
    function videoBox(v) {
      const region = core.regionOf(v);
      let box = v;
      while (!box.classList.contains('cms-video')) {
        const up = box.parentElement;
        if (!up || up === region || up.hasAttribute('data-cms') || core.locked(up)) break;
        // Our own wrapper always goes with its player, even when it sits right in the region.
        if (up.classList.contains('cms-video')) { box = up; break; }
        if (up.parentElement === region || up.children.length !== 1 || /\S/.test(up.textContent)) break;
        box = up;
      }
      return box;
    }
    const videoTarget = (v) => ({ type: 'video', el: videoBox(v), label: 'Video' });

    // Players ignore the pointer while editing (media.page.css), so a click lands on what is behind them.
    core.addClassifier((node) => {
      if (isPlayer(node)) return core.locked(node) ? null : videoTarget(node);
      if (!pt) return null;
      const region = core.regionOf(node);
      for (const v of region.querySelectorAll('iframe, video')) {
        if (!isPlayer(v) || core.locked(v) || !inside(v.getBoundingClientRect(), pt)) continue;
        if (node.contains(v) || videoBox(v).contains(node) || (v.parentElement && v.parentElement.contains(node))) return videoTarget(v);
      }
      return null;
    });

    function parseVideo(input) {
      let u;
      try { u = new URL(String(input || '').trim()); } catch { return null; }
      if (!/^https?:$/.test(u.protocol)) return null;
      const host = u.hostname.toLowerCase().replace(/^(www|m|music)\./, '');
      const parts = u.pathname.split('/').filter(Boolean);
      const time = (t) => {
        if (!t) return 0;
        if (/^\d+$/.test(t)) return +t;
        const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(t);
        return m ? (+(m[1] || 0)) * 3600 + (+(m[2] || 0)) * 60 + (+(m[3] || 0)) : 0;
      };
      const yt = (id) => (/^[A-Za-z0-9_-]{11}$/.test(id || '') ? { kind: 'youtube', id, start: time(u.searchParams.get('t') || u.searchParams.get('start')) } : null);
      if (host === 'youtu.be') return yt(parts[0]);
      if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
        if (parts[0] === 'watch') return yt(u.searchParams.get('v'));
        if (['embed', 'shorts', 'live', 'v'].includes(parts[0])) return yt(parts[1]);
        return null;
      }
      if (host === 'vimeo.com' || host === 'player.vimeo.com') {
        const i = parts.findIndex((p) => /^\d{5,12}$/.test(p));
        if (i < 0) return null;
        const next = parts[i + 1];
        const hash = u.searchParams.get('h') || (next && /^[a-f0-9]{6,20}$/i.test(next) ? next : '');
        return { kind: 'vimeo', id: parts[i], hash: /^[a-f0-9]{6,20}$/i.test(hash) ? hash : '' };
      }
      return null;
    }
    const embedSrc = (v) => (v.kind === 'youtube'
      ? `https://www.youtube-nocookie.com/embed/${v.id}?rel=0${v.start ? `&start=${v.start}` : ''}`
      : `https://player.vimeo.com/video/${v.id}?dnt=1${v.hash ? `&h=${v.hash}` : ''}`);
    const pageUrl = (v) => (v.kind === 'youtube'
      ? `https://www.youtube.com/watch?v=${v.id}${v.start ? `&t=${v.start}s` : ''}`
      : `https://vimeo.com/${v.id}${v.hash ? `/${v.hash}` : ''}`);
    const isVideoFile = (s) => /^(https:\/\/[^\s"'<>]+|\/[^\s"'<>]*)\.(mp4|webm|m4v|mov)(\?[^\s"'<>]*)?$/i.test(String(s || '').trim()) && !/^\/\//.test(String(s).trim());

    function setPlayer(f, src, title) {
      f.setAttribute('src', src);
      f.setAttribute('title', title);
      f.setAttribute('loading', 'lazy');
      f.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen');
      f.setAttribute('allowfullscreen', '');
      f.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    }
    /** A responsive 16:9 embed that needs no site CSS. */
    function newEmbed(src, title) {
      const wrap = d.createElement('div');
      wrap.className = 'cms-video';
      wrap.setAttribute('style', 'position:relative;width:100%;aspect-ratio:16/9;margin:1.5em 0;background:#000;overflow:hidden');
      const f = d.createElement('iframe');
      setPlayer(f, src, title);
      f.setAttribute('style', 'position:absolute;top:0;left:0;width:100%;height:100%;border:0');
      wrap.append(f);
      return wrap;
    }

    /** The "paste a link" popover for inserting or changing a video. */
    function videoForm(anchor, { url = '', title = '', allowFile = false, cta }, onUse) {
      core.showPop(anchor, `<form class="mx-video">
        <label for="mx-vurl">${allowFile ? 'YouTube or Vimeo link, or a link to a video file' : 'YouTube or Vimeo link'}</label>
        <input id="mx-vurl" name="url" type="text" inputmode="url" autocomplete="off" spellcheck="false" value="${esc(url)}" placeholder="https://www.youtube.com/watch?v=…">
        <label for="mx-vtitle" class="mx-gap">Title <span class="mx-hint">(read out by screen readers)</span></label>
        <input id="mx-vtitle" name="title" type="text" maxlength="200" value="${esc(title)}" placeholder="What the video is about">
        <p class="mx-note" data-mx="vmsg" role="status">Paste the link from the video’s page or its Share button. Visitors get a privacy-friendly player.</p>
        <div class="row end"><button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="submit">${esc(cta)}</button></div></form>`,
      (fd) => {
        const raw = String(fd.get('url') || '').trim();
        const v = parseVideo(raw);
        const t = String(fd.get('title') || '').trim().slice(0, 200);
        if (v) { onUse({ src: embedSrc(v), title: t || autoTitle || 'Video' }); core.closePop(); return; }
        if (allowFile && isVideoFile(raw)) { onUse({ file: raw, title: t || 'Video' }); core.closePop(); return; }
        say(raw ? 'That isn’t a YouTube or Vimeo video link. Open the video, press Share and copy the link.' : 'Paste a link to the video first.', true);
      });
      const form = R.pop.querySelector('form');
      watchPop(form, () => {});
      const urlIn = form.querySelector('#mx-vurl');
      const titleIn = form.querySelector('#mx-vtitle');
      const msg = form.querySelector('[data-mx="vmsg"]');
      const say = (text, err = false) => { msg.textContent = text; msg.classList.toggle('err', err); core.queueDraw(); };
      let autoTitle = '';
      let titleTouched = Boolean(title);
      let timer = 0;
      let asked = '';
      titleIn.addEventListener('input', () => { titleTouched = true; });
      const look = async () => {
        const raw = urlIn.value.trim();
        const v = parseVideo(raw);
        if (!raw) return;
        if (!v) { if (!(allowFile && isVideoFile(raw))) say('That isn’t a YouTube or Vimeo video link yet.', true); return; }
        say(v.kind === 'youtube' ? 'YouTube video found.' : 'Vimeo video found.');
        const key = `${v.kind}:${v.id}`;
        if (asked === key) return;
        asked = key;
        try {
          const r = await api('GET', `video-title?url=${encodeURIComponent(pageUrl(v))}`);
          if (r.title && asked === key) {
            autoTitle = r.title;
            if (!titleTouched) titleIn.value = r.title;
            say(`Found: “${r.title}”.`);
          }
        } catch { /* the title stays as typed */ }
      };
      urlIn.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(look, 350); });
      urlIn.addEventListener('paste', () => { clearTimeout(timer); timer = setTimeout(look, 0); });
      if (url) look();
    }

    core.addToolAction({
      act: 'mx-vid-change', icon: 'mx-video', text: 'Change video', order: 20,
      title: 'Show a different video',
      when: (sel) => sel.type === 'video',
      run: (sel) => {
        const box = sel.el;
        const player = playerIn(box);
        if (!player) return;
        const region = core.regionOf(box);
        const cur = player.tagName === 'IFRAME' ? parseVideo(player.getAttribute('src')) : null;
        const curFile = player.tagName === 'VIDEO' ? (player.getAttribute('src') || player.querySelector('source')?.getAttribute('src') || '') : '';
        videoForm(box, { url: cur ? pageUrl(cur) : curFile, title: player.getAttribute('title') || player.getAttribute('aria-label') || '', allowFile: player.tagName === 'VIDEO', cta: 'Use this video' }, ({ src, file, title }) => {
          let next = box;
          core.mutate(region, () => {
            if (file) {
              player.querySelectorAll('source').forEach((s) => s.remove());
              player.setAttribute('src', file);
              player.setAttribute('aria-label', title);
              if (!player.hasAttribute('controls')) player.setAttribute('controls', '');
            } else if (player.tagName === 'IFRAME') {
              setPlayer(player, src, title);
            } else {
              next = newEmbed(src, title);
              box.replaceWith(next);
            }
          });
          core.select({ type: 'video', el: next, label: 'Video' });
          toast('Video changed. Publish to show it to visitors.');
        });
      },
    });
    core.addToolAction({
      act: 'mx-vid-del', icon: 'trash', cls: 'danger', order: 90,
      title: 'Delete video',
      when: (sel, { item }) => sel.type === 'video' && item !== sel.el,
      run: (sel) => {
        const box = sel.el;
        core.mutate(core.regionOf(box), () => box.remove());
        core.select(null);
        toast('Video deleted. Press Ctrl+Z to undo.');
      },
    });
    core.addToolAction({
      act: 'mx-vid-insert', icon: 'mx-video-add', order: 60,
      title: 'Insert a video below this paragraph',
      when: (sel) => sel.type === 'text' && sel.el.tagName === 'P' && !sel.el.closest('a, button'),
      run: (sel) => {
        const p = sel.el;
        const region = core.regionOf(p);
        videoForm(p, { cta: 'Insert video' }, ({ src, title }) => {
          const embed = newEmbed(src, title);
          core.mutate(region, () => p.after(embed));
          core.select({ type: 'video', el: embed, label: 'Video' });
          embed.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          toast('Video added. Publish to show it to visitors.');
        });
      },
    });

    /* ================================================================ focal point */
    const KW = { left: 0, top: 0, center: 50, right: 100, bottom: 100 };
    function parsePos(value) {
      const first = String(value || '').split(',')[0].trim().split(/\s+/);
      const num = (t) => (t in KW ? KW[t] : /^-?[\d.]+%$/.test(t) ? parseFloat(t) : null);
      let [a, b] = first;
      if (a === 'top' || a === 'bottom') [a, b] = [b || 'center', a];
      const x = num(a ?? 'center');
      const y = num(b ?? 'center');
      return { x: x == null ? 50 : Math.max(0, Math.min(100, x)), y: y == null ? 50 : Math.max(0, Math.min(100, y)) };
    }
    /** The value a CSS property has from the site's own CSS (inline value set aside), restoring the attribute exactly. */
    function siteValue(el, prop) {
      const had = el.getAttribute('style');
      el.style.removeProperty(prop);
      const v = getComputedStyle(el).getPropertyValue(prop);
      if (had === null) el.removeAttribute('style'); else el.setAttribute('style', had);
      return v;
    }
    function setPos(el, prop, x, y) {
      const def = parsePos(siteValue(el, prop));
      if (Math.round(def.x) === x && Math.round(def.y) === y) el.style.removeProperty(prop);
      else el.style.setProperty(prop, `${x}% ${y}%`);
      if (el.getAttribute('style') === '') el.removeAttribute('style');
    }
    /* Live preview while the focus popover is open. It uses an animation that holds the value
       instead of changing the style attribute, so an autosave, an undo step or a click elsewhere
       can never pick up a point that wasn't saved. prop: 'objectPosition' | 'backgroundPosition'. */
    function previewer(el, prop) {
      let anim = null;
      return (x, y) => {
        if (x == null) { anim?.cancel(); anim = null; return; }
        const kf = { [prop]: `${x}% ${y}%` };
        try {
          if (anim) anim.effect.setKeyframes([kf, kf]);
          else { anim = el.animate([kf, kf], { duration: 1, fill: 'forwards' }); anim.finish(); }
        } catch { /* no preview in this browser; saving still works */ }
      };
    }
    const loadSize = (src) => new Promise((res) => {
      const i = new Image();
      i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight });
      i.onerror = () => res(null);
      i.src = src;
    });

    /**
     * Popover: click or drag on the picture to set the focus point. The page updates as you drag.
     * box() → { w, h, fit: 'cover'|'none'|'contain'|'fill'|'other' } describes how the picture is shown now.
     */
    function focusPop({ anchor, src, nat, start, box, kind, preview, save }) {
      core.showPop(anchor, `<form class="mx-focus">
        <p class="mx-lead">Click or drag on the picture to pick the part that must stay in view when it’s cropped${kind === 'bg' ? ' to fit the area' : ''}.</p>
        <div class="mx-stage" tabindex="0" role="application" aria-roledescription="focus point picker">
          <img alt="" src="${esc(src)}" draggable="false"><div class="mx-crop" hidden></div><div class="mx-dot"></div></div>
        <p class="mx-note" data-mx="fnote" aria-live="polite"></p>
        <div class="row"><button class="btn" type="button" data-mx="center">Center</button><span class="mx-grow"></span>
          <button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="submit">Save</button></div></form>`,
      () => { done = true; stop(); save(Math.round(pos.x), Math.round(pos.y)); core.closePop(); });
      const form = R.pop.querySelector('form');
      const stage = form.querySelector('.mx-stage');
      const crop = form.querySelector('.mx-crop');
      const dot = form.querySelector('.mx-dot');
      const note = form.querySelector('[data-mx="fnote"]');
      let done = false;
      const pos = { ...start };
      const stop = watchPop(form, () => { if (!done) preview(null); });
      const b = box();
      // Size the stage to the picture's shape, within the popover.
      const maxW = Math.max(200, form.clientWidth || 330);
      const maxH = Math.min(260, Math.round(innerHeight * 0.36));
      const sc = Math.min(maxW / nat.w, maxH / nat.h);
      const sw = Math.round(nat.w * sc);
      const sh = Math.round(nat.h * sc);
      Object.assign(stage.style, { width: `${sw}px`, height: `${sh}px` });

      // The part of the picture visitors see at this screen size (in picture pixels).
      let s = null;
      if (b.fit === 'cover') s = Math.max(b.w / nat.w, b.h / nat.h);
      else if (b.fit === 'none') s = 1;
      const vis = s ? { w: Math.min(nat.w, b.w / s), h: Math.min(nat.h, b.h / s) } : { w: nat.w, h: nat.h };
      const cropX = vis.w < nat.w * 0.99;
      const cropY = vis.h < nat.h * 0.99;
      const cropped = cropX || cropY;
      if (!s && (b.fit === 'fill' || b.fit === 'contain')) {
        note.textContent = kind === 'bg'
          ? 'This background is shown whole, not cropped, so the focus point only nudges where it sits.'
          : 'This picture is always shown whole here (never cropped), so a focus point has no visible effect. You can still save one.';
      } else if (!s) {
        note.textContent = 'Saved focus points are used whenever the picture is cropped to fit.';
      } else if (!cropped) {
        note.textContent = 'At this screen size the whole picture fits, so you won’t see a change here. The focus point is used when it gets cropped, for example on a phone or a wide screen.';
      } else {
        note.textContent = `The bright part is what visitors see at this screen size.${cropX && !cropY ? ' Only left and right moves change it.' : !cropX && cropY ? ' Only up and down moves change it.' : ''} Arrow keys move the point too.`;
      }

      const drawPos = () => {
        dot.style.left = `${pos.x}%`;
        dot.style.top = `${pos.y}%`;
        if (s && cropped) {
          crop.hidden = false;
          Object.assign(crop.style, {
            left: `${((nat.w - vis.w) * pos.x / 100) * sc}px`, top: `${((nat.h - vis.h) * pos.y / 100) * sc}px`,
            width: `${vis.w * sc}px`, height: `${vis.h * sc}px`,
          });
        }
        const lr = pos.x < 34 ? 'left' : pos.x > 66 ? 'right' : 'middle';
        const tb = pos.y < 34 ? 'top' : pos.y > 66 ? 'bottom' : 'middle';
        stage.setAttribute('aria-label', `Focus point: ${Math.round(pos.x)}% from the left, ${Math.round(pos.y)}% from the top (${tb === lr ? 'center' : `${tb} ${lr}`.replace('middle middle', 'center')}). Use the arrow keys to move it.`);
        preview(Math.round(pos.x), Math.round(pos.y));
      };
      const fromEvent = (e) => {
        const r = stage.getBoundingClientRect();
        pos.x = Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100));
        pos.y = Math.max(0, Math.min(100, ((e.clientY - r.top) / r.height) * 100));
        drawPos();
      };
      stage.addEventListener('pointerdown', (e) => { e.preventDefault(); stage.focus(); stage.setPointerCapture(e.pointerId); fromEvent(e); });
      stage.addEventListener('pointermove', (e) => { if (stage.hasPointerCapture(e.pointerId)) fromEvent(e); });
      stage.addEventListener('keydown', (e) => {
        const step = e.shiftKey ? 1 : 5;
        const mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
        if (!mv) return;
        e.preventDefault();
        pos.x = Math.max(0, Math.min(100, Math.round(pos.x + mv[0])));
        pos.y = Math.max(0, Math.min(100, Math.round(pos.y + mv[1])));
        drawPos();
      });
      form.querySelector('[data-mx="center"]').addEventListener('click', () => { pos.x = 50; pos.y = 50; drawPos(); });
      drawPos();
      core.queueDraw();
      setTimeout(() => stage.focus(), 0);
    }

    core.addToolAction({
      act: 'mx-img-focus', icon: 'mx-focus', text: 'Focus', order: 30,
      title: 'Focus point: pick the part of the picture that stays in view when it’s cropped',
      when: (sel) => sel.type === 'image',
      run: async (sel) => {
        const img = sel.el;
        const region = core.regionOf(img);
        const src = img.currentSrc || img.src;
        const nat = img.naturalWidth ? { w: img.naturalWidth, h: img.naturalHeight } : await loadSize(src);
        if (!nat || !nat.w) { toast('That picture hasn’t loaded yet. Try again in a moment.', true); return; }
        const preview = previewer(img, 'objectPosition');
        focusPop({
          anchor: img, src, nat, kind: 'img',
          start: parsePos(getComputedStyle(img).objectPosition),
          box: () => {
            const fit = getComputedStyle(img).objectFit;
            return { w: img.clientWidth, h: img.clientHeight, fit: fit === 'scale-down' ? 'contain' : fit };
          },
          preview,
          save: (x, y) => {
            preview(null);
            core.mutate(region, () => setPos(img, 'object-position', x, y));
            toast('Focus point saved. Publish to show it to visitors.');
          },
        });
      },
    });

    /* ================================================================ background images */
    const URL_RE = /url\(\s*(['"]?)(.*?)\1\s*\)/i;
    const sameOriginPath = (url) => {
      try { const u = new URL(url, location.href); return u.origin === location.origin ? u.pathname : null; } catch { return null; }
    };
    const bgUrlOf = (el) => (el && el.style ? (URL_RE.exec(el.style.backgroundImage || '') || [])[2] || '' : '');
    /** The nearest element (inside a region, not the region itself) with an inline background picture. */
    function bgFor(node) {
      const region = core.regionOf(node);
      for (let el = node; el && el !== region && el.nodeType === 1; el = el.parentElement) {
        if (el.hasAttribute('data-cms')) return null;
        if (bgUrlOf(el)) return core.locked(el) ? null : el;
      }
      return null;
    }
    // Only empty areas: never take a click meant for text, a picture, a link, a form or a card inside.
    core.addClassifier((node) => {
      const bg = bgFor(node);
      if (!bg) return null;
      const hit = node.closest('img, picture, video, iframe, svg, a, button, input, select, textarea, label, form, table, [contenteditable]');
      if (hit && bg.contains(hit)) return null;
      if (core.textBlockFor(node) || overText(pt)) return null;
      const item = core.itemFor(node);
      if (item && item !== bg && bg.contains(item)) return null;
      return { type: 'bg', el: bg, label: 'Background' };
    });

    core.addToolAction({
      act: 'mx-bg-replace', icon: 'image', text: 'Replace', order: 20,
      title: 'Replace the background picture',
      when: (sel) => sel.type === 'bg',
      run: async (sel) => {
        const el = sel.el;
        const region = core.regionOf(el);
        const chosen = await core.pickImage({ current: bgUrlOf(el), title: 'Replace background', withAlt: false, maxW: Math.min(2560, Math.max(1600, Math.round(el.clientWidth * 2))) });
        if (!chosen || !chosen.url) return;
        if (/[\s"'()\\]/.test(chosen.url)) { toast('That picture’s address can’t be used as a background.', true); return; }
        // A photo background made with Section settings is rebuilt from data-cms-bg when the page is
        // served, so that attribute must change too (it only takes a picture from this site).
        const photo = el.hasAttribute('data-cms-bg');
        const path = photo ? sameOriginPath(chosen.url) : null;
        if (photo && !path) { toast('Use an image uploaded here or one from the site.', true); return; }
        core.mutate(region, () => {
          el.style.backgroundImage = el.style.backgroundImage.replace(URL_RE, `url("${photo ? path : chosen.url}")`);
          if (photo) el.setAttribute('data-cms-bg', path);
        });
        core.select({ type: 'bg', el, label: 'Background' });
        toast('Background replaced. Publish to show it to visitors.');
      },
    });
    core.addToolAction({
      act: 'mx-bg-focus', icon: 'mx-focus', text: 'Focus', order: 30,
      title: 'Focus point: pick the part of the background that stays in view',
      when: (sel) => sel.type === 'bg',
      run: async (sel) => {
        const el = sel.el;
        const region = core.regionOf(el);
        const src = bgUrlOf(el);
        const nat = await loadSize(src);
        if (!nat || !nat.w) { toast('That background picture couldn’t be loaded.', true); return; }
        const preview = previewer(el, 'backgroundPosition');
        focusPop({
          anchor: el, src, nat, kind: 'bg',
          start: parsePos(getComputedStyle(el).backgroundPosition),
          box: () => {
            const size = getComputedStyle(el).backgroundSize.split(',').pop().trim();
            const fit = size === 'cover' ? 'cover' : size === 'contain' ? 'contain' : /^auto( auto)?$/.test(size) ? 'none' : 'other';
            return { w: el.clientWidth, h: el.clientHeight, fit };
          },
          preview,
          save: (x, y) => {
            preview(null);
            core.mutate(region, () => {
              // Section-settings photo backgrounds keep their focus in data-cms-focus (the Worker
              // rebuilds the style from it), so it is always written out, never left to the default.
              if (el.hasAttribute('data-cms-bg')) {
                el.setAttribute('data-cms-focus', `${x}% ${y}%`);
                el.style.setProperty('background-position', `${x}% ${y}%`);
              } else setPos(el, 'background-position', x, y);
            });
            toast('Focus point saved. Publish to show it to visitors.');
          },
        });
      },
    });
    core.addToolAction({
      act: 'mx-bg-select', icon: 'mx-bg', order: 80,
      title: 'Select the background picture behind this',
      when: (sel) => sel.type !== 'bg' && Boolean(bgFor(sel.el)),
      run: (sel) => { core.finishEdit(); core.select({ type: 'bg', el: bgFor(sel.el), label: 'Background' }); },
    });
  });
