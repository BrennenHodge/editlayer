// Inbox: messages visitors send through the site's forms (form[data-cms-form]). Editors and admins only.
feature('forms', (core) => {
  const { S, esc, icon, api, toast, when, R } = core;
  const info = S.features && S.features.forms;
  if (!info) return;   // authors, or the forms table isn't set up

  core.addIcons({
    inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z"/>',
    back: '<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>',
    mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
    download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
  });

  let unread = info.unread || 0;
  const view = { box: 'inbox', form: '', q: '' };
  let items = [];
  let hasMore = false;
  let meta = { forms: [], spam: 0 };
  let pb = null;

  core.addBarButton({ id: 'inbox', icon: 'inbox', title: () => (unread ? `Inbox (${unread} new)` : 'Inbox'), panel: 'inbox', order: 45 });
  const paintBadge = (bar = R.bar) => {
    const b = bar.querySelector('[data-act="p-inbox"]');
    if (!b) return;
    b.classList.add('fx-inbox');
    b.querySelector('.fx-badge')?.remove();
    const t = unread ? `Inbox (${unread} new)` : 'Inbox';
    b.title = t;
    b.setAttribute('aria-label', t);
    if (unread) b.insertAdjacentHTML('beforeend', `<span class="fx-badge" aria-hidden="true">${unread > 99 ? '99+' : unread}</span>`);
  };
  core.on('bar', paintBadge);
  // Publishing any page also publishes the site-wide "@forms" setting: drop the Draft mark.
  core.on('published', () => { if (info.email) info.email.draft = false; });
  paintBadge();
  const setUnread = (n) => { unread = Math.max(0, n); paintBadge(); };

  const qs = (extra = {}) => {
    const p = new URLSearchParams();
    if (view.box === 'spam') p.set('box', 'spam');
    if (view.form) p.set('form', view.form);
    if (view.q) p.set('q', view.q);
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
    const s = p.toString();
    return s ? `?${s}` : '';
  };
  const who = (m) => m.name || m.email || 'No name given';

  /* ---------------------------------------------------------------- list */
  async function load(more = false) {
    const r = await api('GET', `forms${qs(more && items.length ? { before: items[items.length - 1].id } : {})}`);
    items = more ? [...items, ...r.items] : r.items;
    hasMore = r.hasMore;
    meta = { forms: r.forms, spam: r.spam };
    setUnread(r.unread);
  }

  function listHtml() {
    const opt = (value, text) => `<option value="${esc(value)}" ${`${view.box}:${view.form}` === value ? 'selected' : ''}>${esc(text)}</option>`;
    const total = meta.forms.reduce((n, f) => n + f.total, 0);
    const options = opt('inbox:', `All forms${unread ? ` (${unread} new)` : total ? ` (${total})` : ''}`)
      + meta.forms.map((f) => opt(`inbox:${f.form}`, `${f.label}${f.unread ? ` (${f.unread} new)` : ` (${f.total})`}`)).join('')
      + opt('spam:', `Spam (${meta.spam})`);
    const rows = items.map((m) => `<li class="fx-item${m.read ? '' : ' fx-unread'}"><button type="button" class="fx-open" data-id="${m.id}">
        <i class="fx-dot" aria-hidden="true"></i>
        <span class="grow"><span class="fx-top"><b>${esc(who(m))}</b><time>${esc(when(m.at))}</time></span>
        <span class="fx-line">${esc(m.preview || m.email || '')}</span>
        <span class="fx-meta">${esc(m.label)}${m.read ? '' : ' · <em>New</em>'}</span></span></button></li>`).join('');
    const empty = view.q ? 'No messages match your search.'
      : view.box === 'spam' ? 'Nothing here. Messages the spam checks catch show up here for 30 days.'
        : 'No messages yet. When someone sends a form on your site, it shows up here.';
    return `<p>${view.box === 'spam'
      ? 'Messages the spam checks caught. They’re deleted after 30 days. If a real message ended up here, open it and choose <b>Not spam</b>.'
      : 'Messages people send with the forms on your site, newest first.'}</p>
      <div class="fx-filters"><label class="fx-sr" for="fx-show">Show</label><select id="fx-show">${options}</select>
      <label class="fx-sr" for="fx-q">Search messages</label><input id="fx-q" type="search" placeholder="Search messages" value="${esc(view.q)}"></div>
      ${items.length ? `<ul class="list fx-list">${rows}</ul>` : `<p class="note">${esc(empty)}</p>`}
      ${hasMore ? '<div class="row"><button class="btn" type="button" data-fx="more">Show older messages</button></div>' : ''}
      <div class="row fx-foot">${items.length ? `<a class="btn" href="/_cms/api/forms/export.csv${esc(qs())}" download>${icon('download')}Download as a spreadsheet</a>` : ''}
      ${view.box === 'spam' && items.length ? '<button class="btn danger" type="button" data-fx="empty-spam">Delete all spam</button>' : ''}</div>
      ${alertsHtml()}`;
  }

  async function showList({ reload = true, focus } = {}) {
    if (!pb) return;
    if (reload) {
      try { await load(); } catch (err) { pb.innerHTML = `<p class="note">${esc(err.message)}</p>`; return; }
    }
    pb.innerHTML = listHtml();
    pb.dataset.fxView = 'list';
    if (focus) pb.querySelector(focus)?.focus();
  }

  /* ---------------------------------------------------------------- one message */
  async function showMessage(id) {
    let m;
    try { m = await api('GET', `forms/${id}`); } catch (err) { toast(err.message, true); return; }
    if (!m.read && !m.spam) {
      try { await api('POST', `forms/${id}`, { read: true }); m.read = true; setUnread(unread - 1); } catch { /* still show it */ }
      const it = items.find((x) => x.id === id);
      if (it) it.read = true;
    }
    const subject = `Re: your message to ${S.site.name}`;
    const fields = m.fields.map(([k, v]) => `<dt>${esc(fieldName(k))}</dt><dd>${esc(v)}</dd>`).join('');
    pb.innerHTML = `<button class="btn fx-back" type="button" data-fx="back">${icon('back')}Back to ${view.box === 'spam' ? 'spam' : 'Inbox'}</button>
      <div class="fx-head"><h3>${esc(who(m))}</h3>${m.email ? `<p>${esc(m.email)}</p>` : ''}</div>
      ${m.spam ? `<p class="note">The spam checks caught this message${m.spamReason ? ` (${esc(reason(m.spamReason))})` : ''}. If it’s real, choose <b>Not spam</b> to move it to the Inbox.</p>` : ''}
      <dl class="fx-fields">${fields}</dl>
      <p class="muted">${esc(m.label)} form${m.page ? ` on <a class="fx-link" href="${esc(m.page)}" target="_blank" rel="noopener">${esc(m.page === '/' ? 'the home page' : m.page)}</a>` : ''} · ${esc(when(m.at))}</p>
      <div class="row fx-actions">
        ${m.email && !m.spam ? `<a class="btn primary" href="mailto:${esc(m.email)}?subject=${esc(encodeURIComponent(subject))}">${icon('mail')}Reply by email</a>` : ''}
        ${m.spam ? '<button class="btn primary" type="button" data-fx="not-spam">Not spam</button>' : `<button class="btn" type="button" data-fx="unread">Mark as unread</button><button class="btn" type="button" data-fx="spam">Spam</button>`}
        <button class="btn danger" type="button" data-fx="delete">${icon('trash')}Delete</button>
      </div>`;
    pb.dataset.fxView = 'message';
    pb.dataset.fxId = String(id);
    pb.scrollTop = 0;
    pb.querySelector('[data-fx="back"]').focus();
  }
  const fieldName = (k) => { const s = String(k).replace(/[_-]+/g, ' ').trim(); return s ? s[0].toUpperCase() + s.slice(1) : k; };
  const reason = (r) => ({ honeypot: 'a hidden field only robots fill in was filled in', 'no time check': 'it was sent without the page’s timing check', 'robot check unavailable': 'the robot check couldn’t be reached', 'marked by an editor': 'marked as spam by an editor' }[r] || r);

  /* ---------------------------------------------------------------- email alerts (admins, only when email is set up) */
  function alertsHtml() {
    if (!info.email || S.user.role !== 'admin' || view.box === 'spam') return '';
    return `<p class="h3">Email alerts</p>
      <form class="fx-alerts"><div class="field"><label for="fx-to">Email each new message to</label>
      <input id="fx-to" name="to" type="text" inputmode="email" autocomplete="off" placeholder="name@example.com, another@example.com" value="${esc(info.email.to.join(', '))}"></div>
      <p class="muted">Separate addresses with commas. Leave it empty to stop emails. This is saved as a draft: it starts working when you publish.${info.email.draft ? ' <span class="pill">Draft</span>' : ''}</p>
      <div class="row end"><button class="btn" type="submit">Save addresses</button></div></form>`;
  }

  /* ---------------------------------------------------------------- panel */
  core.addPanel('inbox', async () => {
    pb = core.openPanel('Inbox', '<p>Loading…</p>');
    pb.classList.add('fx-panel');
    let timer;
    pb.addEventListener('change', (e) => {
      if (e.target.id !== 'fx-show') return;
      const [box, form] = e.target.value.split(':');
      Object.assign(view, { box, form });
      showList({ focus: '#fx-show' });
    });
    pb.addEventListener('input', (e) => {
      const input = e.target;
      if (input.id !== 'fx-q') return;
      clearTimeout(timer);
      timer = setTimeout(async () => {
        view.q = input.value.trim();
        const pos = input.selectionStart;
        await showList();
        const q = pb.querySelector('#fx-q');
        if (q) { q.focus(); try { q.setSelectionRange(pos, pos); } catch { /* search inputs */ } }
      }, 350);
    });
    pb.addEventListener('submit', (e) => {
      if (!e.target.classList.contains('fx-alerts')) return;
      e.preventDefault();
      const list = [...new Set(String(new FormData(e.target).get('to') || '').split(/[,;\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean))];
      // Same pattern as the Worker (src/features/forms/fields.js EMAIL_RE): an address the server
      // refuses would make every autosave on the page fail until reload.
      const bad = list.find((s) => !/^[A-Za-z0-9._+'-]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/.test(s));
      if (bad) { toast(`“${bad}” isn’t a valid email address.`, true); return; }
      if (list.length > 10) { toast('Add up to 10 email addresses.', true); return; }
      info.email.to = list;
      info.email.draft = true;
      core.setExtra('@forms', { notifyTo: list });
      toast(list.length ? 'Saved as a draft. Publish to start emailing these addresses.' : 'Saved as a draft. Publish to stop the emails.');
      showList({ reload: false });
    });
    pb.addEventListener('click', async (e) => {
      const open = e.target.closest('.fx-open');
      if (open) { showMessage(Number(open.dataset.id)); return; }
      const act = e.target.closest('[data-fx]')?.dataset.fx;
      if (!act) return;
      const id = Number(pb.dataset.fxId);
      try {
        if (act === 'back') await showList({ reload: false, focus: '.fx-open' });
        if (act === 'more') { await load(true); await showList({ reload: false }); }
        if (act === 'unread') {
          await api('POST', `forms/${id}`, { read: false });
          setUnread(unread + 1);
          toast('Marked as unread.');
          await showList();
        }
        if (act === 'spam') {
          await api('POST', `forms/${id}`, { spam: true });
          toast('Moved to spam.');
          await showList();
        }
        if (act === 'not-spam') {
          await api('POST', `forms/${id}`, { spam: false, read: false });
          toast('Moved to the Inbox.');
          await showList();
        }
        if (act === 'delete' && confirm('Delete this message? This can’t be undone.')) {
          await api('DELETE', `forms/${id}`);
          toast('Message deleted.');
          await showList();
        }
        if (act === 'empty-spam' && confirm(`Delete all ${meta.spam} spam message${meta.spam === 1 ? '' : 's'}? This can’t be undone.`)) {
          const r = await api('DELETE', 'forms/spam');
          toast(`${r.deleted} spam message${r.deleted === 1 ? '' : 's'} deleted.`);
          await showList();
        }
      } catch (err) { toast(err.message, true); }
    });
    await showList();
  });
});
