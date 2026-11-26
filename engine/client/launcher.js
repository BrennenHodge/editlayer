// Shown to signed-in editors while they browse the live site: one button to start editing this page.
(() => {
  if (window.__vibecmsLauncher || document.getElementById('vibecms-state')) return;
  window.__vibecmsLauncher = true;
  const me = document.currentScript;
  const accent = (me && me.dataset.accent) || '#2563eb';
  const host = document.createElement('vibecms-launcher');
  host.style.cssText = 'all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483646';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `<style>
    a{display:inline-flex;align-items:center;gap:8px;padding:11px 16px;border-radius:999px;background:#16181c;color:#fff;
      font:600 14px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;text-decoration:none;
      box-shadow:0 6px 24px rgba(0,0,0,.28),0 0 0 1px rgba(255,255,255,.08) inset}
    a:hover{background:#23262c}a:focus-visible{outline:2px solid ${accent};outline-offset:2px}
    svg{width:16px;height:16px;stroke:${accent};fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
  </style><a href="${location.pathname}?edit" title="Edit this page"><svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>Edit page</a>`;
  document.documentElement.append(host);
})();
