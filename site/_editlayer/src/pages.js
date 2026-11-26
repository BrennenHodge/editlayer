import { escapeHtml } from './util.js';

// Sign-in and invite screens. Plain HTML, no dependencies, system font stack.
/** Black or white, whichever reads better on the accent colour. */
export function onAccent(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.179 ? '#111' : '#fff';
}

export function accentOf(opts) {
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(opts.accent || '') ? opts.accent : '#2563eb';
}

export function screen(opts, title, body, status = 200) {
  const accent = accentOf(opts);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>${escapeHtml(title)} · ${escapeHtml(opts.siteName)}</title>
<style>
:root{--a:${accent};--ink:#111418;--mute:#5b6470;--line:#dfe3e8;--bg:#f4f5f7;--card:#fff;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--ink:#eef1f4;--mute:#a3acb7;--line:#2c333b;--bg:#0f1215;--card:#171b20}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px 16px;background:var(--bg);color:var(--ink);
font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{width:100%;max-width:400px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:32px 28px}
.site{font-size:13px;color:var(--mute);margin:0 0 4px}h1{font-size:22px;line-height:1.25;margin:0 0 20px}
label{display:block;font-size:14px;font-weight:600;margin:16px 0 6px}
input{width:100%;font:inherit;padding:11px 12px;border:1px solid var(--line);border-radius:9px;background:transparent;color:inherit}
input:focus{outline:2px solid var(--a);outline-offset:1px;border-color:transparent}
button{margin-top:22px;width:100%;font:inherit;font-weight:600;padding:12px;border:0;border-radius:9px;background:var(--a);color:${onAccent(accent)};cursor:pointer}
.err{background:#fdecec;color:#8a1c1c;border-radius:9px;padding:10px 12px;font-size:14px;margin:0 0 8px}
@media (prefers-color-scheme:dark){.err{background:#3a1717;color:#ffc9c9}}
.hint{font-size:13px;color:var(--mute);margin:14px 0 0}
</style></head><body><main><p class="site">${escapeHtml(opts.siteName)}</p><h1>${escapeHtml(title)}</h1>${body}</main></body></html>`;
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY' } });
}

/**
 * mode: "password" (email + password), "link" (email only: we send a sign-in link) or "both" (the link form,
 * with a password form one click away).
 */
export function loginScreen(opts, { next = '/?edit', error = '', email = '', mode = 'password' } = {}) {
  const err = error ? `<p class="err" role="alert">${escapeHtml(error)}</p>` : '';
  const passwordForm = (focus) => `<form method="post" action="/_cms/login">
  <input type="hidden" name="next" value="${escapeHtml(next)}">
  <label for="email">Email</label><input id="email" name="email" type="email" autocomplete="username" required value="${escapeHtml(email)}"${focus ? ' autofocus' : ''}>
  <label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required>
  <button type="submit">Sign in</button>
</form>`;
  if (mode === 'password') {
    return screen(opts, 'Sign in to edit', `${err}${passwordForm(true)}
<p class="hint">Forgot your password? Ask your site admin for a new invite link.</p>`, error ? 401 : 200);
  }
  const linkForm = `<form method="post" action="/_cms/login/link">
  <input type="hidden" name="next" value="${escapeHtml(next)}">
  <label for="link-email">Email</label><input id="link-email" name="email" type="email" autocomplete="email" required value="${escapeHtml(email)}" autofocus>
  <button type="submit">Email me a sign-in link</button>
</form>`;
  return screen(opts, 'Sign in to edit', `${err}${linkForm}
<p class="hint">We’ll email you a link that signs you in. No password needed.</p>
${mode === 'both' ? `<details style="margin-top:18px"><summary style="cursor:pointer;font-size:14px;font-weight:600">Use a password instead</summary>${passwordForm(false)}</details>` : ''}`, error ? 401 : 200);
}

export function linkSentScreen(opts, { email }) {
  return screen(opts, 'Check your email', `
<p>If <strong>${escapeHtml(email)}</strong> can edit this site, a sign-in link is on its way. It works once, for 15 minutes.</p>
<p class="hint">Nothing after a minute or two? Check your spam folder, or <a href="/_cms/login">ask for a new link</a>.</p>`);
}

/** Shown when the emailed link is opened: one press signs in (so link checkers in mail apps can't use it up). */
export function linkConfirmScreen(opts, { token, user, action }) {
  if (!user) return screen(opts, 'This link has expired', '<p>Sign-in links work once, for 15 minutes.</p><p class="hint"><a href="/_cms/login">Get a new link</a></p>', 410);
  return screen(opts, `Hi${user.name ? ', ' + user.name.split(' ')[0] : ''}`, `
<p class="hint" style="margin-top:0">Signing in as <strong>${escapeHtml(user.email)}</strong>.</p>
<form method="post" action="${escapeHtml(action || `/_cms/magic/${token}`)}">
  <button type="submit" autofocus>Sign in and start editing</button>
</form>`);
}

export function inviteScreen(opts, { token, invite, error = '' }) {
  if (!invite) return screen(opts, 'This link has expired', '<p>Invite links work for 7 days and only once. Ask your site admin for a new one.</p>', 410);
  return screen(opts, `Welcome${invite.name ? ', ' + invite.name.split(' ')[0] : ''}`, `
${error ? `<p class="err" role="alert">${escapeHtml(error)}</p>` : ''}
<p class="hint" style="margin-top:0">Choose a password for <strong>${escapeHtml(invite.email)}</strong>.</p>
<form method="post" action="/_cms/invite/${escapeHtml(token)}">
  <input type="hidden" name="username" value="${escapeHtml(invite.email)}" autocomplete="username">
  <label for="pw">New password</label><input id="pw" name="password" type="password" minlength="10" autocomplete="new-password" required autofocus>
  <label for="pw2">Type it again</label><input id="pw2" name="password2" type="password" minlength="10" autocomplete="new-password" required>
  <button type="submit">Save password and start editing</button>
</form>
<p class="hint">At least 10 characters.</p>`, error ? 400 : 200);
}
