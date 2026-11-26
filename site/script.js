(() => {
  const d = document;
  const root = d.documentElement;

  /* Theme: light, dark, or the device's choice until someone picks. */
  const dark = () => root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  d.querySelectorAll('.theme-toggle').forEach((b) => b.addEventListener('click', () => {
    const next = dark() ? 'light' : 'dark';
    root.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch (e) { /* private mode */ }
  }));

  /* Menu: the header's links (so a menu edited in Vibe CMS shows here too), in a full-screen sheet. */
  const menu = d.getElementById('menu');
  const toggle = d.querySelector('.menu-toggle');
  const headNav = d.querySelector('.site-head .nav');
  if (menu && headNav) {
    const nav = menu.querySelector('nav');
    const links = [...headNav.querySelectorAll('a')].map((a) => a.cloneNode(true));
    const home = nav.querySelector('a[href="/"]');
    const last = nav.querySelector('a[href="/early-access/"]');
    nav.replaceChildren(...[home, ...links, last].filter(Boolean));
  }
  const setMenu = (open) => {
    if (!menu || !toggle) return;
    menu.hidden = !open;
    menu.classList.toggle('is-open', open);
    d.body.classList.toggle('menu-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    toggle.querySelector('use').setAttribute('href', open ? '#i-close' : '#i-menu');
  };
  toggle && toggle.addEventListener('click', () => setMenu(menu.hidden));
  menu && menu.addEventListener('click', (e) => { if (e.target.closest('a')) setMenu(false); });
  d.addEventListener('keydown', (e) => { if (e.key === 'Escape' && menu && !menu.hidden) { setMenu(false); toggle.focus(); } });
  matchMedia('(min-width: 1024px)').addEventListener('change', (e) => { if (e.matches) setMenu(false); });

  /* The live demo: a pretend client site you can edit in place (nothing is saved). */
  const demo = d.querySelector('[data-demo]');
  if (demo) {
    const site = demo.querySelector('.demo-site');
    const btn = demo.querySelector('[data-demo-toggle]');
    const status = demo.querySelector('.ds-status');
    const tool = demo.querySelector('.ds-tool');
    const fields = [...site.querySelectorAll('[data-edit]')];
    let timer;
    const say = (t) => { status.textContent = t; };
    const place = (el) => {
      const r = el.getBoundingClientRect();
      const s = site.getBoundingClientRect();
      tool.style.display = 'flex';
      const above = r.top - s.top - tool.offsetHeight - 8;
      tool.style.top = `${above >= 4 ? above : r.bottom - s.top + 8}px`;
      tool.style.left = `${Math.min(Math.max(4, r.left - s.left), s.width - tool.offsetWidth - 4)}px`;
    };
    const on = (yes) => {
      demo.classList.toggle('demo-on', yes);
      btn.textContent = yes ? 'Done' : 'Edit page';
      btn.setAttribute('aria-pressed', String(yes));
      fields.forEach((f) => { if (yes) { f.setAttribute('contenteditable', 'true'); f.spellcheck = false; } else f.removeAttribute('contenteditable'); });
      if (!yes) tool.style.display = 'none';
      say(yes ? 'Click any text and type. Click the photo to replace it.' : '');
      if (yes) fields[0].focus();
    };
    btn.addEventListener('click', () => on(!demo.classList.contains('demo-on')));
    site.addEventListener('focusin', (e) => { const f = e.target.closest('[data-edit]'); if (f && demo.classList.contains('demo-on')) place(f); });
    site.addEventListener('focusout', () => setTimeout(() => { if (!site.contains(d.activeElement)) tool.style.display = 'none'; }, 120));
    site.addEventListener('input', () => { say('Saving draft…'); clearTimeout(timer); timer = setTimeout(() => say('Draft saved. Only editors can see it.'), 700); });
    site.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.closest('.ds-title,[data-single]')) e.preventDefault(); });
    tool.addEventListener('mousedown', (e) => e.preventDefault());
    tool.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.cmd === 'link') { say('In the real editor you pick a page or paste a link here.'); return; }
      d.execCommand(b.dataset.cmd);
    });
    const photo = site.querySelector('.ds-photo');
    const looks = ['', 'look-2', 'look-3'];
    let look = 0;
    photo.addEventListener('click', () => {
      if (!demo.classList.contains('demo-on')) return;
      photo.classList.remove(...looks.filter(Boolean));
      look = (look + 1) % looks.length;
      if (looks[look]) photo.classList.add(looks[look]);
      say('Photo replaced. The real editor resizes uploads and asks for alt text.');
    });
    demo.querySelector('[data-demo-publish]').addEventListener('click', () => say('Published. Visitors see it now. (Demo only: refresh to reset.)'));
  }

  /* Wide tables: hide the swipe hint after the first swipe. */
  d.querySelectorAll('.scroller').forEach((s) => s.addEventListener('scroll', () => { const h = s.previousElementSibling; if (h && h.classList.contains('swipe-hint')) h.hidden = true; }, { once: true, passive: true }));

  /* Forms that post to the Vibe CMS inbox: send without leaving the page. */
  d.querySelectorAll('form[data-cms-form]').forEach((form) => form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const out = form.querySelector('[role="status"]');
    const b = form.querySelector('button[type="submit"]');
    b.disabled = true;
    try {
      const r = await fetch(form.action, { method: 'POST', body: new URLSearchParams(new FormData(form)), headers: { accept: 'application/json' } });
      const j = await r.json().catch(() => ({}));
      out.dataset.cmsFormResult = j.ok ? 'sent' : 'error';
      out.textContent = j.ok ? (form.dataset.cmsSuccess || j.message) : (j.error || 'That didn’t send. Try again in a minute.');
      if (j.ok) form.reset();
    } catch (err) {
      out.dataset.cmsFormResult = 'error';
      out.textContent = 'That didn’t send. Check your connection and try again.';
    }
    b.disabled = false;
  }));
})();
