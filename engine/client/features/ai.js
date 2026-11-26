// AI assistants: admins connect ChatGPT, Claude, Grok or any MCP client to this site from the Editors panel.
// Each connection gets its own key (shown once) and can be turned off at any time.
feature('ai', (core) => {
  const { S, esc, icon, api, toast, when } = core;
  if (!(S.features && S.features.mcp)) return;   // admins only
  core.addIcons({ spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.5 2.5M15.2 15.2l2.5 2.5M6.3 17.7l2.5-2.5M15.2 8.8l2.5-2.5"/>' });

  let fresh = null;   // { name, url } of a key just made, shown once
  const wired = new WeakSet();

  async function paint(pb) {
    let box = pb.querySelector('.ai-box');
    if (!box) { pb.insertAdjacentHTML('beforeend', '<div class="ai-box"></div>'); box = pb.querySelector('.ai-box'); }
    let data;
    try { data = await api('GET', 'ai-tokens'); } catch (err) { box.innerHTML = `<p class="note">${esc(err.message)}</p>`; return; }
    box.innerHTML = `<p class="h3">${icon('spark')}AI assistants</p>
      <p>Let ChatGPT, Claude or Grok edit this site when you ask them to. Their changes are saved as drafts you can check here before they go live.</p>
      ${fresh ? `<div class="note"><b>${esc(fresh.name)} is ready.</b> Paste this address into the assistant (ChatGPT: Settings › Apps › Create; Claude: Settings › Connectors › Add custom connector). It’s shown only once, so keep it private, like a password.
        <div class="copy"><input type="text" readonly value="${esc(fresh.url)}"><button class="btn" type="button" data-ai-copy>Copy</button></div></div>` : ''}
      ${data.tokens.length ? `<ul class="list">${data.tokens.map((t) => `<li><span class="grow"><b>${esc(t.name)}</b><span>${t.role === 'editor' ? 'Can publish' : 'Drafts only'} · ${t.last_used ? `last used ${esc(when(t.last_used))}` : 'not used yet'}</span></span>
        <button class="ib danger" type="button" data-ai-off="${t.id}" data-name="${esc(t.name)}" title="Turn off" aria-label="Turn off ${esc(t.name)}">${icon('trash')}</button></li>`).join('')}</ul>` : ''}
      <form class="ai-new"><div class="field"><label for="ai-n">Assistant</label><input id="ai-n" name="name" type="text" placeholder="ChatGPT" required maxlength="60"></div>
      <div class="field"><label for="ai-r">It may</label><select id="ai-r" name="role"><option value="author">Save drafts only (you publish)</option><option value="editor">Save drafts and publish when you ask</option></select></div>
      <div class="row end"><button class="btn primary" type="submit">Connect an assistant</button></div></form>`;
    fresh = null;
  }

  core.on('panel:users', (pb) => {
    paint(pb);
    if (wired.has(pb)) return;
    wired.add(pb);
    pb.addEventListener('submit', async (e) => {
      if (!e.target.closest('.ai-new')) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const body = Object.fromEntries(new FormData(e.target));
      try { const r = await api('POST', 'ai-tokens', body); fresh = { name: body.name, url: r.url }; await paint(pb); } catch (err) { toast(err.message, true); }
    }, true);
    pb.addEventListener('click', async (e) => {
      const c = e.target.closest('[data-ai-copy]');
      if (c) { const i = c.parentElement.querySelector('input'); i.select(); await navigator.clipboard.writeText(i.value).catch(() => core.d.execCommand('copy')); toast('Address copied.'); return; }
      const off = e.target.closest('[data-ai-off]');
      if (off && confirm(`Turn off ${off.dataset.name}? It will no longer be able to read or change the site. Drafts it saved stay.`)) {
        try { await api('DELETE', 'ai-tokens', { id: off.dataset.aiOff }); await paint(pb); } catch (err) { toast(err.message, true); }
      }
    });
  });
});
