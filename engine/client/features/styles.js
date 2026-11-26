  // Site styles: colours, fonts, weights, corners, buttons and spacing for the whole site.
  // Changes are applied live as custom properties on <html>, autosaved as the site-wide draft key
  // "@theme" and go live with Publish. The Worker (src/features/styles.js) validates and serves them.
  feature('styles', (core) => {
    const F = core.S.features && core.S.features.styles;
    if (!F || !Array.isArray(F.groups) || !F.groups.length) return;
    if (!['editor', 'admin'].includes(core.S.user.role)) return;
    const { esc } = core;
    const doc = core.d;
    const html = doc.documentElement;

    core.addIcons({
      palette: '<path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.8 1.8-1.7 0-.5-.2-.9-.5-1.2-.3-.4-.5-.7-.5-1.2 0-.9.7-1.6 1.6-1.6h2.1A4.5 4.5 0 0 0 21 10.8C21 6.5 17 3 12 3z"/><circle cx="7.5" cy="11" r="1.2"/><circle cx="10.5" cy="7" r="1.2"/><circle cx="15.5" cy="7.5" r="1.2"/>',
      warn: '<path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    });

    /* ---- settings, the site's original values, and the saved theme ---- */
    const settings = [];
    const groupOf = {};
    for (const g of F.groups) for (const s of g.settings) { settings.push(s); groupOf[s.prop] = g.id; }
    const byProp = new Map(settings.map((s) => [s.prop, s]));
    const fonts = F.fonts || [];
    const fontByName = (n) => fonts.find((f) => f.name === n) || null;
    const raw = F.raw || {};

    // The Worker serves the saved theme as <style id="editlayer-theme">. While editing, the editor takes
    // over: read the site's own values without it, then apply the theme as inline custom properties.
    doc.getElementById('editlayer-theme')?.remove();
    const cs0 = getComputedStyle(html);
    const orig = {};
    for (const s of settings) orig[s.prop] = cs0.getPropertyValue(s.prop).trim();
    for (const p of F.contrast || []) for (const v of [p.text, p.on]) if (v.startsWith('--') && !(v in orig)) orig[v] = cs0.getPropertyValue(v).trim();

    const theme = { props: {}, fonts: {} };
    for (const [p, v] of Object.entries((F.theme && F.theme.props) || {})) if (byProp.has(p) && byProp.get(p).type !== 'font') theme.props[p] = String(v);
    for (const [p, v] of Object.entries((F.theme && F.theme.fonts) || {})) if (byProp.get(p)?.type === 'font' && fontByName(v)) theme.fonts[p] = v;

    const current = (prop) => (byProp.get(prop).type === 'font' ? theme.fonts[prop] : theme.props[prop]) ?? null;
    const effective = (prop) => current(prop) ?? orig[prop];
    function apply(prop) {
      const s = byProp.get(prop);
      const v = s.type === 'font' ? fontByName(theme.fonts[prop])?.css : theme.props[prop];
      if (v == null) html.style.removeProperty(prop); else html.style.setProperty(prop, v);
    }

    /* ---- fonts: load a chosen Google font into the page so the change shows straight away ---- */
    const famsIn = (href) => { try { return new URL(href).searchParams.getAll('family').map((f) => f.split(':')[0].replace(/\+/g, ' ').toLowerCase()); } catch { return []; } };
    function ensureFont(f) {
      if (!f || !f.href) return;
      const loaded = new Set([...doc.querySelectorAll('link[href*="fonts.googleapis.com/css"]')].flatMap((l) => famsIn(l.href)));
      if (loaded.has(f.name.toLowerCase())) return;
      const l = doc.createElement('link');
      l.rel = 'stylesheet';
      l.href = f.href;
      l.setAttribute('data-editlayer-font', '');
      doc.head.append(l);
    }
    // A font the page loads with only some weights (e.g. 400;500;600) is loaded again with its full
    // range when a weight outside them is picked, so every step of the weight sliders shows.
    function rangesIn(href) {
      const out = new Map();
      try {
        for (const fam of new URL(href).searchParams.getAll('family').flatMap((f) => f.split('|'))) {
          const [n, spec = ''] = fam.split(':');
          const r = [];
          if (spec.includes('@')) {
            const [axes, values] = spec.split('@');
            const i = axes.split(',').indexOf('wght');
            for (const t of values.split(';')) { const [a, b = a] = (i < 0 ? '400' : (t.split(',')[i] || '')).split('..').map(Number); if (Number.isFinite(a) && Number.isFinite(b)) r.push([Math.min(a, b), Math.max(a, b)]); }
          } else {
            for (const v of spec.split(',')) { const w = parseInt(v, 10); if (w >= 100 && w <= 900) r.push([w, w]); }
          }
          if (!r.length) r.push([400, 400]);
          const key = n.replace(/\+/g, ' ').trim().toLowerCase();
          out.set(key, [...(out.get(key) || []), ...r]);
        }
      } catch { /* not a URL */ }
      return out;
    }
    function ensureWeights() {
      const want = Object.values(theme.props).filter((v) => /^[1-9]00$/.test(v)).map(Number);
      if (!want.length) return;
      const ranges = new Map();
      for (const l of doc.querySelectorAll('link[href*="fonts.googleapis.com/css"]')) for (const [k, r] of rangesIn(l.href)) ranges.set(k, [...(ranges.get(k) || []), ...r]);
      for (const f of fonts) {
        const r = f.href && ranges.get(f.name.toLowerCase());
        if (r && want.some((w) => w >= f.min && w <= f.max && !r.some(([a, b]) => w >= a && w <= b))) {
          const l = doc.createElement('link');
          l.rel = 'stylesheet';
          l.href = f.href;
          l.setAttribute('data-editlayer-font', '');
          doc.head.append(l);
        }
      }
    }
    const firstFamily = (stack) => String(stack || '').split(',')[0].replace(/["']/g, '').trim();

    settings.forEach((s) => apply(s.prop));
    Object.values(theme.fonts).forEach((n) => ensureFont(fontByName(n)));
    ensureWeights();

    /* ---- colours ---- */
    const HEXC = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
    const N = '(?:\\d{1,3}(?:\\.\\d{1,4})?|\\.\\d{1,4})';
    const SEP = '\\s*[,\\s]\\s*';
    const ALPHA = `(?:\\s*[,/]\\s*${N}%?)?`;
    const RGBC = new RegExp(`^rgba?\\(\\s*${N}%?${SEP}${N}%?${SEP}${N}%?${ALPHA}\\s*\\)$`, 'i');
    const HSLC = new RegExp(`^hsla?\\(\\s*${N}(?:deg)?${SEP}${N}%${SEP}${N}%${ALPHA}\\s*\\)$`, 'i');
    const isColor = (v) => v.length <= 64 && (HEXC.test(v) || RGBC.test(v) || HSLC.test(v)) && CSS.supports('color', v);
    const ctx2d = doc.createElement('canvas').getContext('2d');
    /** [r, g, b, a] for any CSS colour, or null. */
    function rgba(color) {
      if (!color || !CSS.supports('color', color)) return null;
      ctx2d.fillStyle = '#000';
      ctx2d.fillStyle = color;
      const v = ctx2d.fillStyle;
      if (v[0] === '#') return [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16)).concat(1);
      const m = v.match(/[\d.]+/g);
      return m ? [+m[0], +m[1], +m[2], m[3] === undefined ? 1 : +m[3]] : null;
    }
    const hex = (c) => `#${c.slice(0, 3).map((x) => Math.round(x).toString(16).padStart(2, '0')).join('')}`;
    const sameColor = (a, b) => { const x = rgba(a); const y = rgba(b); return Boolean(x && y && x.every((v, i) => Math.abs(v - y[i]) < 0.01)); };
    function lum([r, g, b]) {
      const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    }
    function ratio(textColor, bgColor) {
      const t = rgba(textColor); const b = rgba(bgColor);
      if (!t || !b || b[3] < 1) return null;
      const mix = t.slice(0, 3).map((v, i) => v * t[3] + b[i] * (1 - t[3]));
      const [l1, l2] = [lum(mix), lum(b)].sort((x, y) => y - x);
      return (l1 + 0.05) / (l2 + 0.05);
    }
    const side = (v, live) => (v.startsWith('--') ? (live ? getComputedStyle(html).getPropertyValue(v).trim() : orig[v]) : v);
    const pairs = (F.contrast || []).map((p) => ({ ...p, before: ratio(side(p.text, false), side(p.on, false)) }));
    function failing() {
      return pairs.filter((p) => {
        const r = ratio(side(p.text, true), side(p.on, true));
        if (r === null || r >= p.min) return false;
        // Pairs the site didn't list are guesses: only warn when a change made them worse than before.
        return !F.auto || (p.before !== null && p.before >= p.min);
      });
    }

    /* ---- changing values ---- */
    function sameAsOriginal(s, v) {
      if (raw[s.prop] && /^var\(/.test(raw[s.prop])) return false; // follows another setting: keep explicit choices
      const o = orig[s.prop];
      if (s.type === 'color') return sameColor(v, o);
      if (s.type === 'length' || s.type === 'weight') return parseFloat(v) === parseFloat(o) && String(v).replace(/[\d.]/g, '') === String(o).replace(/[\d.]/g, '');
      return String(v) === String(o);
    }
    function set(prop, value) {
      const s = byProp.get(prop);
      const bag = s.type === 'font' ? theme.fonts : theme.props;
      if (value == null || value === '' || (s.type !== 'font' && sameAsOriginal(s, value))) delete bag[prop];
      else bag[prop] = String(value);
      apply(prop);
      if (s.type === 'font') ensureFont(fontByName(value));
      if (s.type === 'weight') ensureWeights();
      save();
    }
    function save() {
      core.setExtra('@theme', { props: { ...theme.props }, fonts: { ...theme.fonts } });
      refresh();
    }
    const changed = (gid) => settings.some((s) => (!gid || groupOf[s.prop] === gid) && current(s.prop) !== null);
    function reset(gid) {
      for (const s of settings) {
        if (gid && groupOf[s.prop] !== gid) continue;
        delete theme.props[s.prop];
        delete theme.fonts[s.prop];
        apply(s.prop);
      }
      save();
      draw();
    }

    /* ---- the panel ---- */
    const WEIGHTS = { 100: 'Thin', 200: 'Extra light', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semi-bold', 700: 'Bold', 800: 'Extra bold', 900: 'Black' };
    const wname = (v) => WEIGHTS[Math.round(+v / 100) * 100] || String(v);
    let pb = null;
    let uid = 0;

    function control(s) {
      const id = `sty-${++uid}`;
      const v = effective(s.prop);
      const hint = s.hint ? `<small>${esc(s.hint)}</small>` : '';
      if (s.type === 'color') {
        const c = rgba(v);
        return `<div class="sty-color" data-prop="${esc(s.prop)}">
          <span class="sty-sw" style="--c:${esc(v)}"><input type="color" id="${id}" value="${esc(c ? hex(c) : '#000000')}" aria-label="${esc(`${s.label}: pick a colour`)}"></span>
          <label class="sty-name" for="${id}-x">${esc(s.label)}${hint}</label>
          <input type="text" class="sty-hex" id="${id}-x" value="${esc(v)}" spellcheck="false" autocomplete="off" aria-label="${esc(`${s.label}: colour code`)}">
          <span class="sty-flag" title="Hard to read with another colour">${core.icon('warn')}</span></div>`;
      }
      if (s.type === 'font') {
        const follows = /^var\((--[\w-]+)\)$/.exec(raw[s.prop] || '');
        const leader = follows && byProp.get(follows[1]);
        const first = leader && leader.type === 'font' ? `Same as ${leader.label.toLowerCase()}` : `Original${firstFamily(orig[s.prop]) ? ` (${firstFamily(orig[s.prop])})` : ''}`;
        const cur = current(s.prop) || '';
        const opt = (f) => `<option value="${esc(f.name)}" ${f.name === cur ? 'selected' : ''}>${esc(f.name)}</option>`;
        const groups = [['This site’s fonts', fonts.filter((f) => f.site)], ['Clean and modern', fonts.filter((f) => !f.site && f.category !== 'serif')], ['Classic, with serifs', fonts.filter((f) => !f.site && f.category === 'serif')]];
        return `<div class="field sty-font" data-prop="${esc(s.prop)}"><label for="${id}">${esc(s.label)}${hint}</label>
          <select id="${id}"><option value="">${esc(first)}</option>${groups.filter(([, l]) => l.length).map(([label, l]) => `<optgroup label="${esc(label)}">${l.map(opt).join('')}</optgroup>`).join('')}</select>
          <div class="sty-sample" style="font-family:${esc(fontByName(cur)?.css || orig[s.prop] || 'inherit')}">The quick brown fox jumps over the lazy dog</div></div>`;
      }
      if (s.type === 'weight' || s.type === 'length') {
        const isW = s.type === 'weight';
        const n = parseFloat(v);
        const val = Number.isFinite(n) ? n : (isW ? 400 : s.min);
        const min = isW ? s.min : s.min;
        const max = isW ? s.max : s.max;
        const step = isW ? 100 : s.step;
        const text = isW ? wname(val) : '';
        return `<div class="sty-range" data-prop="${esc(s.prop)}"><label for="${id}">${esc(s.label)}${hint}<output>${esc(text)}</output></label>
          <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${val}" ${isW ? `aria-valuetext="${esc(text)}"` : ''}>
          ${s.ends ? `<div class="sty-ends"><span>${esc(s.ends[0] || '')}</span><span>${esc(s.ends[1] || '')}</span></div>` : ''}</div>`;
      }
      if (s.type === 'choice') {
        const cur = current(s.prop);
        const hasNull = s.options.some((o) => o.value === null);
        const on = (o) => (cur === null ? (o.value === null || (!hasNull && sameAsChoice(o.value, orig[s.prop]))) : o.value === cur);
        return `<fieldset class="sty-seg" data-prop="${esc(s.prop)}"><legend>${esc(s.label)}${hint}</legend><div>${s.options.map((o) => `<label><input type="radio" name="${id}" value="${esc(o.value ?? '')}" ${on(o) ? 'checked' : ''}><span>${esc(o.label)}</span></label>`).join('')}</div></fieldset>`;
      }
      if (s.type === 'toggle') {
        return `<label class="sty-switch" data-prop="${esc(s.prop)}"><input type="checkbox" ${effective(s.prop) === s.on ? 'checked' : ''}><span class="sty-knob" aria-hidden="true"></span><span>${esc(s.label)}${hint}</span></label>`;
      }
      return '';
    }
    const sameAsChoice = (a, b) => (parseFloat(a) === parseFloat(b) && Number.isFinite(parseFloat(a))) || String(a) === String(b);

    function body() {
      uid = 0;
      return `<p>Change the look of the whole site. You see each change right away. It’s saved as a draft and goes live on every page when you publish.</p>
        ${F.groups.map((g) => `<section class="sty-g" data-g="${esc(g.id)}">
          <div class="sty-gh"><h3>${esc(g.label)}</h3><button type="button" class="sty-reset" data-reset="${esc(g.id)}" aria-label="${esc(`Reset ${g.label.toLowerCase()} to the original`)}">Reset</button></div>
          ${g.id === 'colours' || g.settings.some((s) => s.type === 'color') ? '<div class="sty-warn" data-warn hidden></div>' : ''}
          <div class="sty-gb">${g.settings.map(control).join('')}</div></section>`).join('')}
        <div class="sty-foot"><button type="button" class="btn danger" data-reset-all>Reset all to the original</button></div>`;
    }

    function refresh() {
      if (!pb || !pb.isConnected) return;
      for (const b of pb.querySelectorAll('[data-reset]')) b.disabled = !changed(b.dataset.reset);
      const all = pb.querySelector('[data-reset-all]');
      if (all) all.disabled = !changed();
      const bad = failing();
      const flagged = new Set(bad.flatMap((p) => [p.text, p.on]));
      pb.querySelectorAll('.sty-color').forEach((r) => r.classList.toggle('bad', flagged.has(r.dataset.prop)));
      const w = pb.querySelector('[data-warn]');
      if (w) {
        w.hidden = !bad.length;
        w.innerHTML = bad.length ? `${core.icon('warn')}<div>${bad.map((p) => `<p><b>${esc(p.label)}</b> is hard to read. Make one of the two colours darker or lighter.</p>`).join('')}</div>` : '';
      }
    }

    function draw() {
      if (!pb || !pb.isConnected) return;
      const top = pb.scrollTop;
      pb.innerHTML = body();
      pb.scrollTop = top;
      refresh();
    }

    function bind() {
      pb.addEventListener('input', (e) => {
        const t = e.target;
        const row = t.closest('[data-prop]');
        if (!row) return;
        const s = byProp.get(row.dataset.prop);
        if (s.type === 'color') {
          const txt = row.querySelector('.sty-hex');
          if (t.type === 'color') {
            const old = rgba(effective(s.prop));
            const c = rgba(t.value);
            const v = old && old[3] < 1 ? `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${+old[3].toFixed(3)})` : t.value;
            txt.value = v;
            txt.classList.remove('invalid');
            set(s.prop, v);
            row.querySelector('.sty-sw').style.setProperty('--c', v);
          } else {
            const v = t.value.trim();
            const ok = isColor(v);
            t.classList.toggle('invalid', !ok && v !== '');
            if (ok) { row.querySelector('input[type=color]').value = hex(rgba(v)); row.querySelector('.sty-sw').style.setProperty('--c', v); set(s.prop, v); }
          }
        } else if (s.type === 'weight') {
          const out = row.querySelector('output');
          out.textContent = wname(t.value);
          t.setAttribute('aria-valuetext', wname(t.value));
          set(s.prop, String(t.value));
        } else if (s.type === 'length') {
          set(s.prop, `${t.value}${s.unit}`);
        }
      });
      pb.addEventListener('change', (e) => {
        const t = e.target;
        const row = t.closest('[data-prop]');
        if (!row) return;
        const s = byProp.get(row.dataset.prop);
        if (s.type === 'font') {
          set(s.prop, t.value || null);
          const sample = row.querySelector('.sty-sample');
          if (sample) sample.style.fontFamily = fontByName(t.value)?.css || orig[s.prop] || 'inherit';
        } else if (s.type === 'choice') {
          set(s.prop, t.value === '' ? null : t.value);
        } else if (s.type === 'toggle') {
          set(s.prop, t.checked ? s.on : s.off);
        } else if (s.type === 'color' && t.classList.contains('sty-hex') && !isColor(t.value.trim())) {
          t.value = effective(s.prop);
          t.classList.remove('invalid');
        }
      });
      pb.addEventListener('click', (e) => {
        const r = e.target.closest('[data-reset]');
        if (r) { reset(r.dataset.reset); core.toast('Put back to the original. Publish to make it live.'); return; }
        if (e.target.closest('[data-reset-all]') && confirm('Put every site style back to the original? Visitors keep seeing the current look until you publish.')) {
          reset(null);
          core.toast('All site styles are back to the original. Publish to make it live.');
        }
      });
    }

    function peek(on) {
      const panel = core.R.panel;
      panel.classList.toggle('sty-peek', on);
      const b = panel.querySelector('[data-peek]');
      if (!b) return;
      const label = on ? 'Show the settings again' : 'Shrink this panel to look at the page';
      b.innerHTML = core.icon(on ? 'up' : 'down');
      b.title = label;
      b.setAttribute('aria-label', label);
      b.setAttribute('aria-expanded', String(!on));
    }

    core.addPanel('styles', () => {
      pb = core.openPanel('Site styles', body());
      pb.classList.add('sty');
      const close = core.R.panel.querySelector('.ph [data-act="close"]');
      close.insertAdjacentHTML('beforebegin', '<button class="ib sty-peekbtn" type="button" data-peek></button>');
      core.R.panel.querySelector('[data-peek]').addEventListener('click', () => peek(!core.R.panel.classList.contains('sty-peek')));
      peek(false);
      bind();
      refresh();
    });
    core.addBarButton({ id: 'styles', icon: 'palette', title: 'Site styles (colours, fonts, corners)', panel: 'styles', order: 40 });
  });
