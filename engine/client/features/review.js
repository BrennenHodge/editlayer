  // Approval, share-preview links, scheduled publishing and emailed invites (Worker: src/features/review.js).
  feature('review', (core) => {
    const { S, esc, icon, api, toast } = core;
    const F = S.features.review || {};
    const isEditor = S.user.role === 'editor' || S.user.role === 'admin';
    const isAuthor = !isEditor;

    core.addIcons({
      review: '<path d="M9 4H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2"/><rect x="9" y="2.5" width="6" height="3.5" rx="1"/><path d="m9 13 2 2 4-4"/>',
      clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
      share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
      mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    });

    const pageName = (p) => (p === '/' ? 'Home' : p);
    const fmt = (ms) => new Date(ms).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const day = (ms) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const tzId = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };
    const tzName = () => {
      try { return new Intl.DateTimeFormat(undefined, { timeZoneName: 'long' }).formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value || tzId(); } catch { return tzId(); }
    };
    /** "2026-11-26T09:00" in the browser's time zone, for datetime-local inputs. */
    const localInput = (ms) => { const dt = new Date(ms); dt.setMinutes(dt.getMinutes() - dt.getTimezoneOffset()); return dt.toISOString().slice(0, 16); };

    const STATUS = {
      pending: ['Waiting for review', 'rv-wait'],
      approved: ['Published', 'rv-ok'],
      declined: ['Declined', 'rv-no'],
      withdrawn: ['Cancelled', 'rv-off'],
      closed: ['Changes discarded', 'rv-off'],
    };
    const pill = (status) => { const [t, c] = STATUS[status] || [status, 'rv-off']; return `<span class="pill rv-pill ${c}">${esc(t)}</span>`; };

    /* ---------- bar button with a count: editors see requests waiting, authors see new decisions */
    const seenKey = `editlayer-review-seen:${S.user.email}`;
    const seen = () => { try { return Number(localStorage.getItem(seenKey)) || 0; } catch { return 0; } };
    const markSeen = () => { try { localStorage.setItem(seenKey, String(Date.now())); } catch { /* private mode */ } };
    let pending = F.pending || 0;
    let mine = F.mine || [];
    // New answers: the latest request for each page, decided since the author last opened the list.
    const unseen = () => {
      const latest = new Map();
      for (const r of mine) if (!latest.has(r.path) || latest.get(r.path).id < r.id) latest.set(r.path, r);
      return [...latest.values()].filter((r) => r.decided && ['approved', 'declined'].includes(r.status) && r.decided > seen()).length;
    };
    const count = () => (isEditor ? pending : unseen());
    const redrawBar = () => core.setStatus(core.status);

    core.addBarButton({
      id: 'review', icon: 'review', panel: 'review', order: 70,
      title: () => {
        const n = count();
        if (isEditor) return n ? `Reviews and scheduling: ${n} waiting` : 'Reviews, scheduling and preview links';
        return n ? `Review requests: ${n} new answer${n === 1 ? '' : 's'}` : 'Review requests and preview links';
      },
    });
    core.on('bar', (bar) => {
      const b = bar.querySelector('[data-act="p-review"]');
      const n = count();
      if (b && n) { b.classList.add('rv-has'); b.insertAdjacentHTML('beforeend', `<i class="rv-badge" aria-hidden="true">${n > 9 ? '9+' : n}</i>`); }
    });

    /* ---------- authors: Publish becomes Submit for review */
    if (isAuthor) {
      core.setPublishButton({ text: 'Submit for review', title: 'Send your changes to an editor to check and publish', icon: 'send', run: submitForReview });
      // Authors can't publish everything or reset pages (the server refuses too): hide those buttons.
      core.on('panel:pages', (pb) => pb.querySelector('[data-pub-all]')?.closest('.note')?.remove());
      core.on('panel:history', (pb) => pb.querySelector('[data-x="reset"]')?.remove());
    }

    function smallModal(title, body, foot) {
      const m = core.modal({ title, body: `<div class="rv-mbody">${body}</div>`, foot });
      m.el.classList.add('rv-modal');
      m.el.addEventListener('keydown', (e) => { if (e.key === 'Escape') m.close(); });
      setTimeout(() => m.el.querySelector('textarea, input, .btn.primary')?.focus(), 0);
      return m;
    }

    async function submitForReview() {
      core.finishEdit();
      await core.save();
      if (core.dirty) { toast('Your latest changes aren’t saved yet. Check your connection and try again.', true); return; }
      const open = mine.find((r) => r.path === S.path && r.status === 'pending');
      const m = smallModal('Send for review', `
        <p>An editor checks your changes, then publishes them or sends them back with a comment. You can keep editing while you wait.</p>
        ${open ? `<p class="note">You already sent this page on ${esc(fmt(open.created))}. Sending again updates your request.</p>` : ''}
        <div class="field"><label for="rv-note">Note for the editor <small>optional</small></label>
        <textarea id="rv-note" maxlength="1000" placeholder="What did you change, and why?">${esc(open?.note || '')}</textarea></div>`,
      `<button class="btn" data-act="close">Cancel</button><button class="btn primary" data-rv="send">${icon('send')}Send for review</button>`);
      const send = m.el.querySelector('[data-rv="send"]');
      send.addEventListener('click', async () => {
        send.disabled = true;
        try {
          const r = await api('POST', 'review/requests', { path: S.path, note: m.el.querySelector('#rv-note').value });
          mine = [r.request, ...mine.filter((x) => x.id !== r.request.id)];
          m.close();
          redrawBar();
          toast(r.updated ? 'Request updated. An editor will check your changes.' : 'Sent for review. An editor will check your changes and publish them.');
        } catch (err) { send.disabled = false; toast(err.message, true); }
      });
    }

    /* ---------- the panel */
    let tab = isEditor ? 'waiting' : 'mine';
    let freshLink = null;  // { link, path } just created: shown once
    core.addPanel('review', () => openPanel());

    async function openPanel() {
      const pb = core.openPanel(isEditor ? 'Review and publish' : 'Review requests', '<p>Loading…</p>');
      let data;
      try {
        data = await api('GET', `review?path=${encodeURIComponent(S.path)}`);
      } catch (err) {
        pb.innerHTML = `<p class="note">${esc(err.message)}</p>`;
        return;
      }
      if (isEditor) pending = data.pending.length;
      else { mine = data.mine; }
      const draw = () => {
        const tabs = isEditor
          ? [['waiting', `Waiting${pending ? ` (${pending})` : ''}`], ['schedule', 'Schedule'], ['share', 'Preview links']]
          : [['mine', 'My requests'], ['share', 'Preview links']];
        if (!tabs.some(([k]) => k === tab)) tab = tabs[0][0];
        pb.innerHTML = `<div class="tabs rv-tabs" role="tablist">${tabs.map(([k, t]) => `<button type="button" role="tab" aria-selected="${k === tab}" class="${k === tab ? 'on' : ''}" data-tab="${k}">${esc(t)}</button>`).join('')}</div>
          <div data-pane>${{ waiting: waitingPane, mine: minePane, schedule: schedulePane, share: sharePane }[tab](data)}</div>`;
        if (tab === 'mine') { markSeen(); redrawBar(); }
      };
      const reload = async () => {
        try {
          data = await api('GET', `review?path=${encodeURIComponent(S.path)}`);
          if (isEditor) pending = data.pending.length; else mine = data.mine;
          redrawBar();
          draw();
        } catch (err) { toast(err.message, true); }
      };
      draw();

      pb.addEventListener('click', async (e) => {
        const t = e.target.closest('[data-tab],[data-rv],[data-open]');
        if (!t) return;
        if (t.dataset.tab) { tab = t.dataset.tab; freshLink = null; draw(); pb.querySelector(`[data-tab="${tab}"]`)?.focus(); return; }
        if (t.dataset.open) {
          e.preventDefault();
          if (!/^\/(?![/\\])/.test(t.dataset.open)) return;
          core.finishEdit();
          await core.save();
          location.href = `${t.dataset.open}?edit`;
          return;
        }
        const act = t.dataset.rv;
        const id = t.dataset.id;
        try {
          if (act === 'approve') {
            const r = data.pending.find((x) => String(x.id) === id);
            if (!r || !confirm(`Publish the changes on ${pageName(r.path)} now? Visitors see them straight away.`)) return;
            if (r.path === S.path) { core.finishEdit(); await core.save(); }
            t.disabled = true;
            const out = await api('POST', `review/requests/${id}/approve`, {});
            if (r.path === S.path) { S.hasDraft = false; core.setStatus('live'); core.emit('published', { all: false, count: out.published }); }
            toast(out.published ? `Approved and published. Visitors see the changes on ${pageName(r.path)} now.` : 'Approved. There was nothing new to publish: the changes may already be live.');
            await reload();
          }
          if (act === 'decline-open') {
            const f = pb.querySelector(`[data-decline-form="${CSS.escape(id)}"]`);
            f.hidden = !f.hidden;
            if (!f.hidden) f.querySelector('textarea').focus();
          }
          if (act === 'decline-cancel') pb.querySelector(`[data-decline-form="${CSS.escape(id)}"]`).hidden = true;
          if (act === 'withdraw') {
            if (!confirm('Cancel this review request? Your changes stay saved as a draft.')) return;
            await api('POST', `review/requests/${id}/withdraw`, {});
            toast('Request cancelled. Your changes are still saved as a draft.');
            await reload();
          }
          if (act === 'unschedule') {
            if (!confirm('Cancel this scheduled publish? The changes stay as a draft.')) return;
            await api('DELETE', `review/schedules/${id}`);
            toast('Scheduled publish cancelled.');
            await reload();
          }
          if (act === 'mklink') {
            t.disabled = true;
            const r = await api('POST', 'review/previews', { path: S.path, timeZone: tzId() });
            freshLink = { link: r.link, path: S.path };
            await reload();
            pb.querySelector('.rv-fresh input')?.select();
          }
          if (act === 'copy') {
            const i = pb.querySelector('.rv-fresh input');
            i.select();
            await navigator.clipboard.writeText(i.value).catch(() => core.d.execCommand('copy'));
            toast('Link copied. Paste it into an email or message.');
          }
          if (act === 'revoke') {
            if (!confirm('Turn off this preview link? Anyone who has it will see a “link expired” page.')) return;
            await api('DELETE', `review/previews/${id}`);
            toast('Preview link turned off.');
            await reload();
          }
        } catch (err) { t.disabled = false; toast(err.message, true); }
      });

      pb.addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = e.target;
        const btn = f.querySelector('[type=submit]');
        try {
          if (f.dataset.declineForm) {
            const comment = f.querySelector('textarea').value.trim();
            if (!comment) { toast('Say what should change, so the author knows what to fix.', true); f.querySelector('textarea').focus(); return; }
            btn.disabled = true;
            await api('POST', `review/requests/${f.dataset.declineForm}/decline`, { comment });
            toast('Sent back to the author with your comment.');
            await reload();
          }
          if (f.dataset.sched !== undefined) {
            const v = f.querySelector('input').value;
            const at = v ? new Date(v).getTime() : NaN;
            if (!Number.isFinite(at)) { toast('Pick a date and time.', true); return; }
            if (at < Date.now() + 60000) { toast('Pick a time at least a minute from now.', true); return; }
            btn.disabled = true;
            if (core.dirty) await core.save();
            const r = await api('POST', 'review/schedules', { path: S.path, at, timeZone: tzId() });
            F.scheduled = r.at;
            toast(`${r.updated ? 'Time changed.' : 'Scheduled.'} This page goes live ${fmt(r.at)}.`);
            await reload();
          }
        } catch (err) { if (btn) btn.disabled = false; toast(err.message, true); }
      });
    }

    const empty = (text) => `<p class="note rv-empty">${esc(text)}</p>`;

    function waitingPane(data) {
      const items = data.pending.map((r) => `<li class="rv-item">
          <div class="rv-top"><span class="grow"><b>${esc(pageName(r.path))}</b><span>${esc(r.author)} · ${esc(fmt(r.created))}</span></span>${r.path === S.path ? '<span class="pill cur">This page</span>' : ''}</div>
          ${r.note ? `<p class="rv-quote">${esc(r.note)}</p>` : ''}
          <div class="rv-acts">
            ${r.path === S.path ? '' : `<a class="btn" href="${esc(r.path)}?edit" data-open="${esc(r.path)}">Open page</a>`}
            <a class="btn" href="${esc(r.path)}?preview" target="_blank" rel="noopener" title="See the page with the changes, in a new tab">Preview</a>
            <button class="btn" type="button" data-rv="decline-open" data-id="${r.id}">Decline</button>
            <button class="btn primary" type="button" data-rv="approve" data-id="${r.id}">${icon('check')}Approve and publish</button>
          </div>
          <form class="rv-decline" data-decline-form="${r.id}" hidden>
            <div class="field"><label for="rv-c${r.id}">What should change?</label><textarea id="rv-c${r.id}" maxlength="1000" placeholder="The author sees this comment. Their changes stay saved."></textarea></div>
            <div class="row end"><button class="btn" type="button" data-rv="decline-cancel" data-id="${r.id}">Cancel</button><button class="btn danger" type="submit">Decline and send comment</button></div>
          </form></li>`).join('');
      const decided = data.decided.map((r) => `<li class="rv-item">
          <div class="rv-top"><span class="grow"><b>${esc(pageName(r.path))}</b><span>Sent by ${esc(r.author)}${r.reviewer && ['approved', 'declined'].includes(r.status) ? ` · ${r.status === 'approved' ? 'published' : 'declined'} by ${esc(r.reviewer)}` : ''} · ${esc(fmt(r.decided))}</span></span>${pill(r.status)}</div>
          ${r.comment ? `<p class="rv-quote">${esc(r.comment)}</p>` : ''}</li>`).join('');
      return `<p>Authors send pages here instead of publishing them. Approving publishes the page as it is now, including any changes made after it was sent, plus the site-wide header and footer.</p>
        ${items ? `<ul class="list rv-list">${items}</ul>` : empty('Nothing is waiting for review.')}
        ${decided ? `<p class="h3">Decided in the last 30 days</p><ul class="list rv-list">${decided}</ul>` : ''}`;
    }

    function minePane(data) {
      const items = data.mine.map((r) => `<li class="rv-item">
          <div class="rv-top"><span class="grow"><b>${esc(pageName(r.path))}</b><span>Sent ${esc(fmt(r.created))}${r.decided && r.status !== 'pending' ? ` · ${r.reviewer ? `${esc(r.reviewer)}, ` : ''}${esc(fmt(r.decided))}` : ''}</span></span>${pill(r.status)}</div>
          ${r.note ? `<p class="rv-quote rv-mute">You wrote: ${esc(r.note)}</p>` : ''}
          ${r.comment ? `<p class="rv-quote">${esc(r.comment)}</p>` : ''}
          ${r.status === 'declined' ? `<p class="muted">Your changes are still saved. Make the changes, then press <b>Submit for review</b> again${r.path === S.path ? '' : ' on that page'}.</p>` : ''}
          <div class="rv-acts">
            ${r.path === S.path ? '' : `<a class="btn" href="${esc(r.path)}?edit" data-open="${esc(r.path)}">Open page</a>`}
            ${r.status === 'pending' ? `<button class="btn" type="button" data-rv="withdraw" data-id="${r.id}">Cancel request</button>` : ''}
          </div></li>`).join('');
      return `<p>When you’re happy with a page, press <b>Submit for review</b>. An editor publishes it or sends it back with a comment.</p>
        ${items ? `<ul class="list rv-list">${items}</ul>` : empty('You haven’t sent anything for review yet.')}`;
    }

    function schedulePane(data) {
      const here = data.schedules.find((s) => s.path === S.path && s.status === 'pending');
      // Same limit as the check on submit and the server: at least a minute from now (rounded up to the next minute).
      const min = localInput(Math.ceil((Date.now() + 60000) / 60000) * 60000);
      const def = here ? localInput(here.at) : '';
      const list = data.schedules.map((s) => `<li><span class="grow"><b>${esc(pageName(s.path))}</b><span>${esc(fmt(s.at))} · ${esc(s.by)}</span></span>
          ${s.status === 'running' ? '<span class="pill">Publishing…</span>' : `<button class="btn" type="button" data-rv="unschedule" data-id="${s.id}">Cancel</button>`}</li>`).join('');
      const words = { published: (s) => `Published ${s.published} change${s.published === 1 ? '' : 's'}`, nothing: () => 'Nothing new to publish', error: () => 'Failed. Publish it by hand.', stalled: () => 'Didn’t finish. Publish it by hand.' };
      const ran = data.ran.map((s) => `<li><span class="grow"><b>${esc(pageName(s.path))}</b><span>${esc(fmt(s.ran || s.at))} · ${esc((words[s.result] || words.error)(s))}</span></span>${s.status === 'failed' ? '<span class="pill rv-pill rv-no">Failed</span>' : ''}</li>`).join('');
      return `<p>Pick when this page’s unpublished changes go live.</p>
        <form data-sched>
          <div class="field"><label for="rv-at">Date and time</label><input id="rv-at" name="at" type="datetime-local" required min="${min}" value="${def}"></div>
          <p class="muted rv-tz">${icon('clock')}<span>Your time zone: ${esc(tzName())}</span></p>
          <p class="note">At that time everything unpublished on this page goes live, <b>including changes made after you schedule it</b>, plus the site-wide header and footer. It happens within 5 minutes of the time you pick.</p>
          <div class="row end"><button class="btn primary" type="submit">${icon('clock')}${here ? 'Change the time' : 'Schedule publish'}</button></div>
        </form>
        <p class="h3">Scheduled</p>${list ? `<ul class="list">${list}</ul>` : empty('Nothing is scheduled.')}
        ${ran ? `<p class="h3">Done in the last 14 days</p><ul class="list">${ran}</ul>` : ''}`;
    }

    function sharePane(data) {
      const fresh = freshLink ? `<div class="note rv-fresh"><b>Preview link ready for ${esc(pageName(freshLink.path))}.</b> Copy it now: for safety it can’t be shown again. It works for 7 days.
          <div class="copy"><input type="text" readonly value="${esc(freshLink.link)}" aria-label="Preview link"><button class="btn" type="button" data-rv="copy">Copy</button></div></div>` : '';
      const list = data.previews.map((l) => `<li><span class="grow"><b>${esc(pageName(l.path))}</b><span>Until ${esc(day(l.expires))} · ${esc(l.mine ? 'you' : l.by)}</span></span>
          ${l.mine || isEditor ? `<button class="btn" type="button" data-rv="revoke" data-id="${l.id}">Turn off</button>` : ''}</li>`).join('');
      return `<p>Send someone a link to see this page with its unpublished changes, without signing in. They see the page as it is when they open the link, so later edits show too.</p>
        ${fresh}
        <div class="row rv-mkrow"><button class="btn primary" type="button" data-rv="mklink">${icon('share')}Create a preview link</button></div>
        <p class="h3">Active links</p>${list ? `<ul class="list">${list}</ul>` : empty('No active preview links.')}`;
    }

    /* ---------- Page settings: a shortcut to preview links */
    core.on('panel:settings', (pb) => {
      pb.insertAdjacentHTML('beforeend', `<p class="h3">Before publishing</p><p>Want someone to check this page first? Send them a link that shows your unpublished changes.</p>
        <div class="row"><button class="btn" type="button" data-rv-share>${icon('share')}Share a preview</button></div>`);
      pb.querySelector('[data-rv-share]').addEventListener('click', () => { tab = 'share'; freshLink = null; core.togglePanel('review'); });
    });

    /* ---------- Editors panel: the Author role, and emailed invites */
    let emailed = null; // { email, sent, link } from the last "Email the invite"
    const wired = new WeakSet();
    core.on('panel:users', (pb) => {
      const sel = pb.querySelector('select[name="role"]');
      if (sel && !sel.querySelector('option[value="author"]')) {
        sel.insertAdjacentHTML('afterbegin', '<option value="author">Author: edits pages, an editor publishes them</option>');
        sel.value = 'editor';
        [...pb.querySelectorAll('.h3')].find((h) => h.textContent === 'Invite an editor')?.replaceChildren('Invite someone');
        sel.closest('.field')?.insertAdjacentHTML('beforeend', `<ul class="rv-roles">
          <li><b>Author</b> edits pages and sends them for review. Can’t publish.</li>
          <li><b>Editor</b> edits and publishes pages, approves reviews and schedules publishing.</li>
          <li><b>Admin</b> does all of that and manages who can edit.</li></ul>`);
      }
      pb.querySelectorAll('.list li .grow span').forEach((s) => { s.textContent = s.textContent.replace(/ · (author|editor|admin)\b/, (m, r) => ` · ${r[0].toUpperCase()}${r.slice(1)}`); });
      if (!F.emailInvites) return;
      const form = pb.querySelector('form');
      const primary = form?.querySelector('.btn.primary');
      if (primary && !form.querySelector('[data-rv-email]')) primary.insertAdjacentHTML('beforebegin', `<button class="btn" type="button" data-rv-email>${icon('mail')}Email the invite</button>`);
      pb.querySelectorAll('[data-reinvite]').forEach((b) => {
        b.insertAdjacentHTML('afterend', `<button class="ib" type="button" data-rv-reemail="${esc(b.dataset.reinvite)}" data-name="${esc(b.dataset.name || '')}" data-role="${esc(b.dataset.role || '')}" title="Email them a new invite link" aria-label="Email a new invite link">${icon('mail')}</button>`);
      });
      if (emailed) {
        pb.insertAdjacentHTML('afterbegin', emailed.sent
          ? `<div class="note"><b>Invite emailed to ${esc(emailed.email)}.</b> The link in it works once, for 7 days.</div>`
          : `<div class="note"><b>The email couldn’t be sent.</b> Send this link to ${esc(emailed.email)} yourself. It works once, for 7 days.<div class="copy"><input type="text" readonly value="${esc(emailed.link)}"><button class="btn" data-copy>Copy</button></div></div>`);
        emailed = null;
      }
      if (wired.has(pb)) return;
      wired.add(pb);
      pb.addEventListener('click', async (e) => {
        const t = e.target.closest('[data-rv-email],[data-rv-reemail]');
        if (!t) return;
        let body;
        if (t.dataset.rvReemail) {
          if (!confirm(`Email ${t.dataset.rvReemail} a new invite link? They can use it to choose a new password. It works once, for 7 days.`)) return;
          body = { email: t.dataset.rvReemail, name: t.dataset.name, role: t.dataset.role };
        } else {
          const f = t.closest('form');
          if (!f.reportValidity()) return;
          body = Object.fromEntries(new FormData(f));
        }
        t.disabled = true;
        try {
          const r = await api('POST', 'review/invite-email', body);
          emailed = r;
          core.closePanel();
          core.togglePanel('users');
          if (r.sent) toast(`Invite emailed to ${r.email}.`);
        } catch (err) { t.disabled = false; toast(err.message, true); }
      });
    });

    /* ---------- refresh the count after a normal publish, and say hello */
    if (isEditor) {
      core.on('published', () => {
        api('GET', `review?path=${encodeURIComponent(S.path)}`).then((r) => { pending = r.pending.length; redrawBar(); }).catch(() => {});
      });
    }
    core.on('ready', () => {
      let msg = '';
      const here = F.here || [];
      if (isEditor && here.length) msg = `${here[0].author} asked for a review of this page. Open Reviews (bottom bar) to approve or decline.`;
      if (isAuthor) {
        const back = mine.find((r) => r.path === S.path && r.status === 'declined' && r.decided > seen());
        if (back) msg = 'An editor sent this page back with a comment. Open Review requests (bottom bar) to read it.';
      }
      if (isEditor && F.scheduled && !msg) msg = `This page is scheduled to go live ${fmt(F.scheduled)}.`;
      let hinted = false;
      try { hinted = Boolean(sessionStorage.getItem('editlayer-hint')); } catch { /* private mode */ }
      if (msg) setTimeout(() => toast(msg), hinted ? 400 : 3600);
    });
  });
