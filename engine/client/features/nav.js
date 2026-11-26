  /* Menu editor: a "Menu" panel that lists every menu (<nav>) in the site-wide header (desktop menu
     with its dropdowns, the separate phone menu …). Rename links, change where they go, reorder, add
     and delete them, add the current page. Every change goes through core.mutate on the header
     region, so undo, autosave, drafts and publishing work as for any other edit. Other features add a
     link to every menu with core.emit('nav:add', { label, href }) (a listener returns true). */
  feature('nav', (core) => {
    if (core.S.user.role === 'author') return;  // the header is shared by every page: editors and admins only
    const { d, esc, icon } = core;
    core.addIcons({
      menu: '<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h10"/>',
      pencil: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    });

    const header = () => core.regionByKey('@header');
    const navsOf = (h) => (h ? [...h.querySelectorAll('nav')].filter((n) => !n.parentElement.closest('nav') && !core.locked(n)) : []);

    /* ------------------------------------------------------------ links and labels */
    function normPath(p) {
      if (p.endsWith('/index.html')) p = p.slice(0, -'index.html'.length);
      if (!p.endsWith('/') && !/\.[a-z0-9]+$/i.test(p)) p += '/';
      return p;
    }
    /** Comparable form of a link address (same as the Worker's linkKey). */
    function linkKey(href) {
      const raw = String(href || '').trim();
      if (!raw) return '';
      try {
        const u = new URL(raw, location.href);
        if (u.origin !== location.origin) return u.href;
        return normPath(u.pathname) + u.search + u.hash;
      } catch { return raw; }
    }
    const hrefOf = (a) => a.getAttribute('href') || '';
    const tidy = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    /** The words of a link, without decorations such as a number in its own <span>. */
    function getLabel(el) {
      const direct = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('');
      return tidy(direct) || tidy(el.textContent);
    }
    function setLabel(el, text) {
      const direct = [...el.childNodes].filter((n) => n.nodeType === 3 && /\S/.test(n.textContent));
      const put = (node) => {
        const lead = node.textContent.match(/^\s*/)[0];
        const trail = node.textContent.match(/\s*$/)[0];
        node.textContent = lead + text + trail;
      };
      if (direct.length) { put(direct[0]); direct.slice(1).forEach((n) => n.remove()); return; }
      const all = [];
      const walker = d.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) if (/\S/.test(walker.currentNode.textContent)) all.push(walker.currentNode);
      if (!all.length) { el.append(text); return; }
      put(all[all.length - 1]);
    }
    const buttonish = (a) => /(^|[\s_-])(btn|button|cta)([\s_-]|$)/i.test(a.getAttribute('class') || '');

    /** Checks an address typed by an editor. Returns { href } or { error } in plain words. */
    function cleanHref(v) {
      let s = String(v || '').trim();
      if (!s) return { error: 'Choose a page or type where the link goes.' };
      if (/^(javascript|data|vbscript):/i.test(s.replace(/[\u0000- ]/g, ''))) return { error: 'That kind of link isn’t allowed.' };
      if (s.startsWith('//')) s = `https:${s}`;
      if (/^[/#?]/.test(s)) return { href: s };
      if (/^(https?:\/\/[^\s]+|mailto:[^\s]+|tel:[+\d][\d\s().-]*)$/i.test(s)) return { href: s.replace(/^tel:\s*/i, 'tel:').replace(/\s/g, s.startsWith('tel:') ? '' : '%20') };
      if (/^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}([/?#].*)?$/i.test(s)) return { href: `https://${s}` };
      if (/^[a-z0-9][a-z0-9-]*\/?$/i.test(s)) return { href: `/${s.replace(/\/?$/, '/')}` };
      return { error: 'Type a page on this site like /contact/, or a full web address starting with https://' };
    }

    /* ------------------------------------------------------------ reading a menu */
    /** A menu as a tree of nodes: { kind: 'link'|'label', a?, el, unit, depth, sub?, children? }.
        `unit` is what moves or gets deleted (the link, its <li>, or the whole dropdown group). */
    function build(container, depth, out = []) {
      for (const c of container.children) {
        if (core.locked(c) || /^(SCRIPT|STYLE|TEMPLATE|BUTTON|IMG|PICTURE|FORM|INPUT)$/i.test(c.tagName) || c.namespaceURI !== 'http://www.w3.org/1999/xhtml') continue;
        if (c.tagName === 'A') { if (c.hasAttribute('href')) out.push({ kind: 'link', a: c, el: c, unit: c, depth }); continue; }
        const links = c.querySelectorAll('a[href]');
        if (!links.length) {
          if (tidy(c.textContent) && !c.querySelector('input,select,textarea,button')) out.push({ kind: 'label', el: c, unit: c, depth });
          continue;
        }
        const head = [...c.children].find((k) => k.tagName === 'A' && k.hasAttribute('href'));
        const sub = head && [...c.children].find((k) => k !== head && k.querySelector('a[href]'));
        if (head && sub) {
          const node = { kind: 'link', a: head, el: head, unit: c, depth, sub, children: [] };
          build(sub, depth + 1, node.children);
          out.push(node);
        } else if (head && links.length === 1) {
          out.push({ kind: 'link', a: head, el: head, unit: c, depth });
        } else {
          build(c, depth, out); // a wrapper (div.wrap, ul …): its entries belong to this level
        }
      }
      return out;
    }
    function navName(nav, i, all) {
      const l = tidy(nav.getAttribute('aria-label'));
      const hint = `${l} ${nav.id} ${nav.getAttribute('class') || ''}`;
      if (/mobile|phone|small|drawer|offcanvas|\bmnav\b/i.test(hint)) return 'Mobile menu';
      if (/^(primary|main|site|header)( menu| navigation)?$/i.test(l)) return 'Main menu';
      if (l) return /menu|navigation/i.test(l) ? l : `${l} menu`;
      if (all.length === 1) return 'Menu';
      return i === 0 ? 'Main menu' : `Menu ${i + 1}`;
    }
    function readMenus() {
      const h = header();
      const navs = navsOf(h);
      return navs.map((nav, i) => ({ nav, i, name: navName(nav, i, navs), nodes: build(nav, 0) }));
    }
    const flat = (nodes) => nodes.flatMap((n) => [n, ...(n.children ? flat(n.children) : [])]);
    function nodeFor(menus, el) {
      for (const m of menus) for (const n of flat(m.nodes)) if (n.el === el || n.unit === el) return { menu: m, node: n };
      return null;
    }
    /** The same link in the other menus (same address), grouped by menu. If one has the same words,
        only that one; otherwise the links of the same kind (a plain link never matches a button such as
        "Start a project"). Dropdown headings are never deleted along with a plain link. */
    function twinsOf(menus, menu, node, { forDelete = false } = {}) {
      if (node.kind !== 'link') return [];
      const k = linkKey(hrefOf(node.a));
      if (!k) return [];
      const words = getLabel(node.a).toLowerCase();
      // Words of the other links in this menu with the same address: a link in another menu with those
      // words is their twin, not this link's ("Train" in both menus stays when "Training courses",
      // which also goes to /train/, is deleted from one).
      const taken = new Set(flat(menu.nodes).filter((n) => n !== node && n.kind === 'link' && linkKey(hrefOf(n.a)) === k).map((n) => getLabel(n.a).toLowerCase()));
      return menus.filter((m) => m !== menu).map((m) => {
        const all = flat(m.nodes).filter((n) => n.kind === 'link' && linkKey(hrefOf(n.a)) === k && !(forDelete && n.children));
        const same = all.filter((n) => getLabel(n.a).toLowerCase() === words);
        return { menu: m, nodes: same.length ? same : all.filter((n) => buttonish(n.a) === buttonish(node.a) && !taken.has(getLabel(n.a).toLowerCase())) };
      }).filter((g) => g.nodes.length);
    }
    /** Where new links go in a container: after its last ordinary link (so before buttons such as "Start a project"). */
    function slotIn(container) {
      const units = [...container.children].filter((c) => c.tagName === 'A' ? c.hasAttribute('href') : c.querySelector('a[href]'));
      const plain = units.filter((u) => !buttonish(u.tagName === 'A' ? u : u.querySelector('a[href]')));
      const last = plain[plain.length - 1];
      if (last) return { after: last, template: last };
      if (units[0]) return { before: units[0], template: units[0] };
      return { append: true, template: null };
    }
    /** The element that holds a menu's top-level links. */
    function topContainer(menu) {
      const links = menu.nodes.filter((n) => n.kind === 'link');
      const pick = links.filter((n) => !buttonish(n.a)).pop() || links.pop();
      return pick ? pick.unit.parentElement : menu.nav;
    }
    /** A new link built from a sibling's markup, so it gets the same classes and structure. */
    function makeUnit(template, label, href) {
      let unit;
      let a;
      if (!template) {
        unit = a = d.createElement('a');
      } else if (template.tagName === 'A') {
        unit = a = template.cloneNode(true);
      } else {
        const head = [...template.children].find((k) => k.tagName === 'A');
        const hasSub = head && [...template.children].some((k) => k !== head && k.querySelector('a[href]'));
        if (hasSub) { unit = template.cloneNode(false); a = head.cloneNode(true); unit.append(a); } else { unit = template.cloneNode(true); a = unit.querySelector('a[href]') || unit.querySelector('a'); }
      }
      [unit, ...unit.querySelectorAll('*')].forEach((n) => { n.removeAttribute('id'); n.removeAttribute('aria-current'); n.removeAttribute('aria-expanded'); n.removeAttribute('aria-controls'); });
      a.setAttribute('href', href);
      setLabel(a, label);
      return { unit, a };
    }
    function insertUnit(container, unit, slot = slotIn(container)) {
      if (slot.after) slot.after.after(unit);
      else if (slot.before) slot.before.before(unit);
      else container.append(unit);
    }
    /* Numbered links (a dropdown that shows 01, 02 … in a span) are renumbered after a change. */
    function numbers(container) {
      const list = [];
      for (const c of container.children) {
        const a = c.tagName === 'A' ? c : c.querySelector(':scope > a[href]');
        if (!a) continue;
        const n = a.firstElementChild;
        if (!n || !/^\d{1,3}$/.test(n.textContent.trim())) return null;
        list.push(n);
      }
      return list.length >= 2 && list.every((n, i) => Number(n.textContent.trim()) === i + 1) ? list : null;
    }
    function withNumbers(containers, fn) {
      const was = containers.map((c) => [c, numbers(c)]).filter(([, l]) => l);
      fn();
      for (const [c, old] of was) {
        if (!c.isConnected) continue;
        const width = old[0].textContent.trim().length;
        const list = [];
        for (const k of c.children) {
          const a = k.tagName === 'A' ? k : k.querySelector(':scope > a[href]');
          const n = a && a.firstElementChild;
          if (n && /^\d{1,3}$/.test(n.textContent.trim())) list.push(n);
        }
        list.forEach((n, i) => { n.textContent = String(i + 1).padStart(width, '0'); });
      }
    }

    /* ------------------------------------------------------------ changing menus */
    let told = false;
    function change(fn, msg, msgFn) {
      const h = header();
      if (!h) return false;
      core.mutate(h, fn);
      if (mo) mo.takeRecords(); // our own change: the panel redraws itself
      if (msgFn) msg = msgFn();
      if (msg) core.toast(msg);
      else if (!told) core.toast('Menu changed. Publish to show it on every page. Ctrl+Z undoes.');
      told = true;
      return true;
    }
    /** Adds a link to `container` (in menu `menu`) and, if asked, a matching link to the other menus. */
    function addLink(menus, menu, container, label, href, alsoOthers) {
      const added = [];
      withNumbers([container], () => {
        const slot = slotIn(container);
        const { unit } = makeUnit(slot.template, label, href);
        insertUnit(container, unit, slot);
        added.push(unit);
      });
      if (!alsoOthers) return added;
      const k = linkKey(href);
      const group = flat(menu.nodes).find((n) => n.sub === container);
      for (const m of menus) {
        if (m === menu || flat(m.nodes).some((n) => n.kind === 'link' && linkKey(hrefOf(n.a)) === k)) continue;
        let placed = false;
        if (group) {
          // Put it next to the other menu's copy of the nearest link in that dropdown (or its heading link).
          const near = [...group.children].reverse().filter((n) => n.kind === 'link').concat(group);
          for (const n of near) {
            const twin = flat(m.nodes).find((x) => x.kind === 'link' && !buttonish(x.a) && linkKey(hrefOf(x.a)) === linkKey(hrefOf(n.a)));
            if (!twin) continue;
            const target = twin.sub || twin.unit.parentElement;
            withNumbers([target], () => {
              const slot = twin.sub ? slotIn(twin.sub) : { after: twin.unit, template: twin.unit };
              const { unit } = makeUnit(slot.template, label, href);
              insertUnit(target, unit, slot);
              added.push(unit);
            });
            placed = true;
            break;
          }
        }
        if (!placed) {
          const c = topContainer(m);
          withNumbers([c], () => { const slot = slotIn(c); const { unit } = makeUnit(slot.template, label, href); insertUnit(c, unit, slot); added.push(unit); });
        }
      }
      return added;
    }

    // Other features (the page creator) ask whether menus can take a link (core.emit('nav:available')
    // → true here) and add a page to every menu: core.emit('nav:add', { label, href }).
    core.on('nav:available', () => readMenus().length > 0);
    core.on('nav:add', (data = {}) => {
      const label = tidy(data.label).slice(0, 80);
      const res = cleanHref(data.href);
      const menus = readMenus();
      if (!label || res.error || !menus.length) return false;
      const k = linkKey(res.href);
      const missing = menus.filter((m) => !flat(m.nodes).some((n) => n.kind === 'link' && linkKey(hrefOf(n.a)) === k));
      if (missing.length) {
        change(() => {
          for (const m of missing) {
            const c = topContainer(m);
            withNumbers([c], () => { const slot = slotIn(c); const { unit } = makeUnit(slot.template, label, res.href); insertUnit(c, unit, slot); });
          }
        }, `“${label}” added to the menu. Publish to show it on every page.`);
      }
      if (isOpen()) draw();
      return true;
    });

    // A page deleted in the editor: its links would lead nowhere, so they leave every menu (a dropdown
    // heading keeps its dropdown). core.emit('nav:count', href) says how many links point at a page.
    const linksTo = (href) => {
      const k = linkKey(href);
      return k ? readMenus().flatMap((m) => flat(m.nodes).filter((n) => n.kind === 'link' && !n.children && linkKey(hrefOf(n.a)) === k)) : [];
    };
    core.on('nav:count', (href) => linksTo(href).length);
    core.on('page:deleted', ({ path } = {}) => {
      const gone = linksTo(path);
      if (!gone.length) return 0;
      change(() => withNumbers([...new Set(gone.map((n) => n.unit.parentElement))], () => gone.forEach((n) => n.unit.remove())), '');
      if (isOpen()) draw();
      return gone.length;
    });

    /* ------------------------------------------------------------ the panel */
    let pb = null;
    let form = null;     // { kind: 'edit'|'del'|'add', el?, container?, preset? }
    let pages = [];
    let stale = false;
    const isOpen = () => Boolean(pb && pb.isConnected && core.R.panel.classList.contains('show'));
    let rows = [];       // index → { menu, node }
    let conts = [];      // index → { menu, el, group? }

    async function openMenuPanel() {
      pb = core.openPanel('Menu', '<p>Loading…</p>');
      form = null;
      const mine = pb;
      pb.addEventListener('click', onClick);
      pb.addEventListener('submit', onSubmit);
      pb.addEventListener('change', onChange);
      pb.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && form) { e.preventDefault(); e.stopPropagation(); closeForm(); return; }
        // Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y work here too (the page's shortcut ignores keys typed in the editor's
        // own panels), except in a text box, where they undo the typing.
        const k = e.key.toLowerCase();
        if (!(e.ctrlKey || e.metaKey) || (k !== 'z' && k !== 'y') || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
        e.preventDefault();
        const b = core.R.bar.querySelector(`[data-act="${k === 'y' || e.shiftKey ? 'redo' : 'undo'}"]`);
        if (b && !b.disabled) b.click();
      });
      pages = await core.sitePages();
      if (pb === mine) draw();
    }
    core.addPanel('nav', openMenuPanel);
    core.addBarButton({ id: 'nav', icon: 'menu', title: 'Menu', panel: 'nav', order: 45, when: () => navsOf(header()).length > 0 });

    function pageLabel(menus, path) {
      if (path === '/') return 'Home';
      const k = linkKey(path);
      for (const m of menus) for (const n of flat(m.nodes)) if (n.kind === 'link' && linkKey(hrefOf(n.a)) === k) return getLabel(n.a);
      return '';
    }
    function whereFields(menus, href) {
      const k = href ? linkKey(href) : '';
      const match = k ? pages.find((p) => linkKey(p.path) === k) : null;
      const other = Boolean(href) && !match;
      return `<div class="field"><label for="nv-p">Goes to</label><select id="nv-p" name="page">
          ${href ? '' : '<option value="" selected disabled>Choose a page…</option>'}
          ${pages.map((p) => { const l = pageLabel(menus, p.path); return `<option value="${esc(p.path)}" ${match === p ? 'selected' : ''}>${esc(l ? `${l} · ${p.path}` : p.path)}</option>`; }).join('')}
          <option value="__other" ${other ? 'selected' : ''}>Another address…</option></select></div>
        <div class="field" data-other ${other ? '' : 'hidden'}><label for="nv-u">Address</label>
          <input id="nv-u" name="url" type="text" inputmode="url" autocomplete="off" spellcheck="false" value="${other ? esc(href) : ''}" placeholder="/page/ or https://…">
          <p class="muted nv-hint">A page on this site (/contact/), a part of a page (/about-us/#history) or a full web address.</p></div>`;
    }
    function twinChecks(groups, verb) {
      return groups.map((g) => `<label class="nv-check"><input type="checkbox" name="twin" value="${g.menu.i}" checked>
        <span>Also ${verb} it ${verb === 'delete' ? 'from' : 'in'} the ${esc(lower(g.menu.name))}
        <small>${g.nodes.map((n) => `“${esc(getLabel(n.a))}”`).join(', ')}</small></span></label>`).join('');
    }
    const lower = (name) => (/^[A-Z][a-z]/.test(name) ? name.charAt(0).toLowerCase() + name.slice(1) : name);
    function contLabel(c) {
      return c.group ? `the “${getLabel(c.group.a)}” dropdown` : `the ${lower(c.menu.name)}`;
    }
    const ib = (name, title, a, r, cls = '', off = false) => `<button type="button" class="ib ${cls}" data-a="${a}" data-r="${r}" title="${esc(title)}" aria-label="${esc(title)}"${off ? ' disabled' : ''}>${icon(name)}</button>`;
    function rowHtml(menus, menu, node) {
      const r = rows.push({ menu, node }) - 1;
      const sibs = node.unit;
      const up = Boolean(sibs.previousElementSibling);
      const down = Boolean(sibs.nextElementSibling);
      const name = node.kind === 'link' ? getLabel(node.a) || '(no words)' : getLabel(node.el);
      const sub = node.kind === 'link' ? hrefOf(node.a) : 'Heading';
      const here = node.kind === 'link' && linkKey(hrefOf(node.a)) === linkKey(core.S.path);
      const editing = Boolean(form && form.el === node.el && form.kind === 'edit');
      const deleting = Boolean(form && form.el === node.el && form.kind === 'del');
      let h = `<li class="nv-item${node.kind === 'label' ? ' nv-label' : ''}${editing || deleting ? ' nv-open' : ''}">
        <div class="nv-row"><button type="button" class="nv-main" data-a="edit" data-r="${r}" aria-expanded="${editing}" aria-label="Change ${esc(name)}">
          <b>${esc(name)}${here ? ' <span class="pill cur">This page</span>' : ''}</b><span>${esc(sub)}</span></button>
          <span class="nv-acts">${ib('up', `Move ${name} up`, 'up', r, '', !up)}${ib('down', `Move ${name} down`, 'down', r, '', !down)}${ib('trash', `Delete ${name}`, 'del', r, 'danger')}</span></div>`;
      if (editing) {
        h += `<form class="nv-form" data-f="edit" data-r="${r}">
          <div class="field"><label for="nv-l">${node.kind === 'link' ? 'Link text' : 'Heading text'}</label><input id="nv-l" name="label" type="text" maxlength="80" required value="${esc(name)}"></div>
          ${node.kind === 'link' ? whereFields(menus, hrefOf(node.a)) : ''}
          ${twinChecks(twinsOf(menus, menu, node), 'change')}
          <p class="nv-err" role="alert" hidden></p>
          <div class="row end"><button type="button" class="btn" data-a="cancel">Cancel</button><button type="submit" class="btn primary">Save</button></div></form>`;
      }
      if (deleting) {
        const n = node.children ? node.children.filter((c) => c.kind === 'link').length : 0;
        h += `<form class="nv-form nv-del" data-f="del" data-r="${r}">
          <p>Delete “${esc(name)}”${n ? ` and the ${n} link${n === 1 ? '' : 's'} in its dropdown` : ''}? You can undo with Ctrl+Z.</p>
          ${twinChecks(twinsOf(menus, menu, node, { forDelete: true }), 'delete')}
          <div class="row end"><button type="button" class="btn" data-a="cancel">Cancel</button><button type="submit" class="btn danger nv-danger">Delete</button></div></form>`;
      }
      if (node.children) {
        const c = conts.push({ menu, el: node.sub, group: node }) - 1;
        h += `<ul class="nv-tree nv-subtree" aria-label="${esc(name)} dropdown">${node.children.map((x) => rowHtml(menus, menu, x)).join('')}</ul>
          ${addArea(menus, c, `Add a link to this dropdown`)}`;
      }
      return `${h}</li>`;
    }
    function addArea(menus, c, text) {
      const open = form && form.kind === 'add' && form.container === conts[c].el;
      if (!open) return `<button type="button" class="btn nv-add${conts[c].group ? ' nv-add-sub' : ''}" data-a="add" data-c="${c}">${icon('plus')}${esc(text)}</button>`;
      const others = menus.filter((m) => m !== conts[c].menu);
      const preset = form.preset || {};
      return `<form class="nv-form" data-f="add" data-c="${c}"><p class="nv-ft">New link in ${esc(contLabel(conts[c]))}</p>
        <div class="field"><label for="nv-l">Link text</label><input id="nv-l" name="label" type="text" maxlength="80" required value="${esc(preset.label || '')}" placeholder="What the link says"></div>
        ${whereFields(menus, preset.href || '')}
        ${others.length ? `<label class="nv-check"><input type="checkbox" name="others" checked><span>Also add it to the ${esc(others.map((m) => lower(m.name)).join(' and the '))}</span></label>` : ''}
        <p class="nv-err" role="alert" hidden></p>
        <div class="row end"><button type="button" class="btn" data-a="cancel">Cancel</button><button type="submit" class="btn primary">Add link</button></div></form>`;
    }
    /** A starting label for "Add this page": the last part of its address in words ("/process-development/" → "Process development"). */
    function pageTitle() {
      let slug = core.S.path.replace(/\/+$/, '').split('/').pop() || '';
      try { slug = decodeURIComponent(slug); } catch { /* keep as written */ }
      slug = slug.replace(/\.html?$/i, '');
      const words = tidy(slug.replace(/[-_]+/g, ' '));
      return words ? words.charAt(0).toUpperCase() + words.slice(1) : '';
    }
    /** True when a menu shown on the page no longer fits on one line (too many or too long links): its
        top-level links wrap onto a second line, run past the edge of the header, or run into something
        beside the menu (a button, the logo). Measured on the links themselves: hidden dropdowns are
        positioned outside the menu and must not count. */
    function tooWide(menu) {
      const { nav } = menu;
      if (!nav.getClientRects().length || getComputedStyle(nav).display === 'none') return false;
      const shown = (el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
      const rects = menu.nodes.map((n) => n.unit).filter(shown).map((u) => u.getBoundingClientRect()).filter((r) => r.width && r.height);
      if (rects.length < 2) return false;
      // Rows of links. Every link on a row of its own is a menu laid out as a column (a phone menu): fine.
      const minH = Math.min(...rects.map((r) => r.height));
      const rows = [];
      for (const t of rects.map((r) => r.top).sort((a, b) => a - b)) if (!rows.length || t - rows[rows.length - 1] > minH / 2) rows.push(t);
      if (rows.length > 1 && rows.length < rects.length) return true;
      const left = Math.min(...rects.map((r) => r.left));
      const right = Math.max(...rects.map((r) => r.right));
      const box = nav.parentElement;
      const br = box ? box.getBoundingClientRect() : { left: 0, right: innerWidth };
      if (right > Math.min(innerWidth, br.right) + 1 || left < Math.max(0, br.left) - 1) return true;
      const top = Math.min(...rects.map((r) => r.top));
      const bottom = Math.max(...rects.map((r) => r.bottom));
      return Boolean(box) && [...box.children].some((s) => {
        if (s === nav || !shown(s) || /^(absolute|fixed)$/.test(getComputedStyle(s).position)) return false;
        const r = s.getBoundingClientRect();
        return r.width && r.height && r.left < right - 1 && r.right > left + 1 && r.top < bottom - 1 && r.bottom > top + 1;
      });
    }

    function draw() {
      if (!isOpen()) return;
      stale = false;
      const menus = readMenus();
      if (form && form.el && !form.el.isConnected) form = null;
      if (form && form.container && !form.container.isConnected) form = null;
      rows = [];
      conts = [];
      const here = linkKey(core.S.path);
      const listed = menus.some((m) => flat(m.nodes).some((n) => n.kind === 'link' && linkKey(hrefOf(n.a)) === here));
      const phone = menus.find((m) => m.name === 'Mobile menu');
      const sections = menus.map((m) => {
        const c = conts.push({ menu: m, el: topContainer(m) }) - 1;
        return `<section class="nv-menu" aria-label="${esc(m.name)}"><p class="h3">${esc(m.name)}</p>
          ${m === phone ? '<p class="muted nv-sub">What visitors see on phones and small screens, behind the menu button.</p>' : ''}
          ${tooWide(m) ? '<p class="note nv-warn">This menu no longer fits on one line at this screen width. Shorten a link or move one into a dropdown.</p>' : ''}
          <ul class="nv-tree">${m.nodes.map((n) => rowHtml(menus, m, n)).join('') || '<li class="muted nv-empty">No links yet.</li>'}</ul>
          ${addArea(menus, c, 'Add a link')}</section>`;
      }).join('');
      const scroll = pb.scrollTop;
      pb.innerHTML = `<p>The menus at the top of every page. Click a link to rename it or change where it goes. Changes are saved as a draft and appear on every page when you publish.</p>
        ${!listed && core.S.path !== '/' && !(form && form.kind === 'add' && form.preset) ? `<div class="note nv-note"><span>This page isn’t in the menu.</span><button type="button" class="btn" data-a="add-page">${icon('plus')}Add this page to the menu</button></div>` : ''}
        ${sections}
        <p class="muted">You can also click any menu text on the page and type over it.${phone ? ' On a phone-sized screen, tap the menu button on the page to show the mobile menu.' : ''}</p>`;
      pb.scrollTop = scroll;
    }
    function focusForm() {
      const f = pb.querySelector('.nv-form');
      if (!f) return;
      f.scrollIntoView({ block: 'nearest' });
      const input = f.querySelector('input[type=text]:not([hidden])') || f.querySelector('button[type=submit]');
      if (input) { input.focus(); if (input.select && input.value) input.select(); }
    }
    function closeForm(focusEl) {
      const el = form && (form.el || null);
      form = null;
      draw();
      const target = focusEl || el;
      if (target) {
        const i = rows.findIndex((r) => r.node.el === target);
        pb.querySelector(`.nv-main[data-r="${i}"]`)?.focus();
      }
    }
    function showError(f, msg) {
      const p = f.querySelector('.nv-err');
      p.textContent = msg;
      p.hidden = false;
    }
    function readWhere(f) {
      const page = f.elements.page ? f.elements.page.value : '';
      if (page === '__other') return cleanHref(f.elements.url.value);
      if (!page) return { error: 'Choose a page or type where the link goes.' };
      return { href: page };
    }

    function onChange(e) {
      if (e.target.name === 'page') {
        const f = e.target.form;
        const other = f.querySelector('[data-other]');
        other.hidden = e.target.value !== '__other';
        if (!other.hidden) f.elements.url.focus();
      }
    }
    function onClick(e) {
      const b = e.target.closest('[data-a]');
      if (!b) return;
      const a = b.dataset.a;
      const row = b.dataset.r != null ? rows[+b.dataset.r] : null;
      if (a === 'cancel') { closeForm(); return; }
      if (a === 'edit' && row) {
        form = form && form.kind === 'edit' && form.el === row.node.el ? null : { kind: 'edit', el: row.node.el };
        draw();
        if (form) focusForm(); else closeForm(row.node.el);
        return;
      }
      if (a === 'del' && row) { form = { kind: 'del', el: row.node.el }; draw(); focusForm(); return; }
      if (a === 'add') { form = { kind: 'add', container: conts[+b.dataset.c].el }; draw(); focusForm(); return; }
      if (a === 'add-page') {
        const menus = readMenus();
        if (!menus.length) return;
        form = { kind: 'add', container: topContainer(menus[0]), preset: { label: pageTitle(), href: core.S.path } };
        draw();
        focusForm();
        return;
      }
      if ((a === 'up' || a === 'down') && row) {
        const unit = row.node.unit;
        const other = a === 'up' ? unit.previousElementSibling : unit.nextElementSibling;
        if (!other) return;
        change(() => withNumbers([unit.parentElement], () => (a === 'up' ? other.before(unit) : other.after(unit))));
        draw();
        const i = rows.findIndex((r) => r.node.unit === unit);
        const next = pb.querySelector(`[data-a="${a}"][data-r="${i}"]`);
        (next && !next.disabled ? next : pb.querySelector(`.nv-main[data-r="${i}"]`))?.focus();
      }
    }
    function onSubmit(e) {
      e.preventDefault();
      const f = e.target;
      const menus = readMenus();
      const kind = f.dataset.f;
      if (kind === 'edit' || kind === 'del') {
        const row = rows[+f.dataset.r];
        if (!row || !row.node.el.isConnected) { closeForm(); return; }
        const found = nodeFor(menus, row.node.el);
        if (!found) { closeForm(); return; }
        const { menu, node } = found;
        const chosen = new Set(new FormData(f).getAll('twin').map(Number));
        if (kind === 'del') {
          const twins = twinsOf(menus, menu, node, { forDelete: true }).filter((g) => chosen.has(g.menu.i)).flatMap((g) => g.nodes);
          const name = getLabel(node.el);
          change(() => withNumbers([node.unit.parentElement, ...twins.map((t) => t.unit.parentElement)], () => {
            node.unit.remove();
            twins.forEach((t) => t.unit.remove());
          }), `“${name}” deleted${twins.length ? ' from both menus' : ''}. Ctrl+Z undoes.`);
          form = null;
          draw();
          return;
        }
        const label = tidy(f.elements.label.value).slice(0, 80);
        if (!label) { showError(f, 'Type the words for the link.'); return; }
        let href = null;
        if (node.kind === 'link') {
          const w = readWhere(f);
          if (w.error) { showError(f, w.error); return; }
          href = w.href;
        }
        const twins = twinsOf(menus, menu, node).filter((g) => chosen.has(g.menu.i)).flatMap((g) => g.nodes);
        const oldLabel = getLabel(node.el);
        const oldHref = node.kind === 'link' ? hrefOf(node.a) : null;
        if (label === oldLabel && (href == null || href === oldHref) && !twins.some((t) => getLabel(t.a) !== label)) { closeForm(node.el); return; }
        change(() => {
          if (label !== oldLabel) setLabel(node.el, label);
          if (href != null && href !== oldHref) node.a.setAttribute('href', href);
          for (const t of twins) {
            if (label !== oldLabel && getLabel(t.a) !== label) setLabel(t.a, label);
            if (href != null && href !== oldHref) t.a.setAttribute('href', href);
          }
        });
        closeForm(node.el);
        return;
      }
      if (kind === 'add') {
        const c = conts[+f.dataset.c];
        if (!c || !c.el.isConnected) { closeForm(); return; }
        const label = tidy(f.elements.label.value).slice(0, 80);
        if (!label) { showError(f, 'Type the words for the link.'); return; }
        const w = readWhere(f);
        if (w.error) { showError(f, w.error); return; }
        const menu = menus.find((m) => m.nav === c.menu.nav) || c.menu;
        const others = Boolean(f.elements.others && f.elements.others.checked);
        let added = [];
        change(() => { added = addLink(menus, menu, c.el, label, w.href, others); }, null, () => `“${label}” added${added.length > 1 ? ' to the menus' : ''}. Publish to show it on every page.`);
        form = null;
        draw();
        const first = added[0] && (added[0].tagName === 'A' ? added[0] : added[0].querySelector('a'));
        const i = rows.findIndex((r) => r.node.el === first);
        pb.querySelector(`.nv-main[data-r="${i}"]`)?.focus();
      }
    }

    // Keep the panel in step with the page: undo/redo, typing in the menu on the page.
    let mo = null;
    let pending = 0;
    function watch() {
      const h = header();
      if (!h || mo) return;
      mo = new MutationObserver(() => {
        if (!isOpen()) return;
        if (form) { stale = true; return; }
        cancelAnimationFrame(pending);
        pending = requestAnimationFrame(() => { if (!form) draw(); });
      });
      mo.observe(h, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['href'] });
    }
    watch();
    core.on('saved', () => { if (stale && isOpen() && !form) draw(); });

    /* ------------------------------------------------------------ menus on the page while editing */
    // The site's script (removed in edit mode) normally opens the phone menu. Clicking the menu button
    // shows or hides it here without changing the saved page (a style outside the header).
    const shown = new Set();
    let styleEl = null;
    function syncShown() {
      if (!styleEl) { styleEl = d.createElement('style'); styleEl.id = 'editlayer-nav-shown'; }
      if (!styleEl.isConnected) d.head.append(styleEl);
      styleEl.textContent = [...shown].map((id) => `#${CSS.escape(id)}{display:block!important}`).join('\n');
    }
    function toggleTarget(btn) {
      const h = header();
      const id = btn.getAttribute('aria-controls');
      const target = id && d.getElementById(id);
      return h && target && h.contains(target) && h.contains(btn) ? target : null;
    }
    /** "mobile menu" for the phone menu (as in navName), plain "menu" for any other panel a button opens. */
    function toggleName(btn) {
      const t = toggleTarget(btn);
      const hint = t ? `${t.getAttribute('aria-label') || ''} ${t.id} ${t.getAttribute('class') || ''}` : '';
      return /mobile|phone|small|drawer|offcanvas|\bmnav\b/i.test(hint) ? 'mobile menu' : 'menu';
    }
    function isToggle(btn) {
      const t = toggleTarget(btn);
      return Boolean(t && (shown.has(t.id) || t.hidden || getComputedStyle(t).display === 'none'));
    }
    function toggleShown(btn) {
      const t = toggleTarget(btn);
      if (!t) return;
      if (shown.has(t.id)) shown.delete(t.id); else shown.add(t.id);
      syncShown();
      core.redrawToolbar();
    }
    core.addClassifier((node) => {
      const b = node.closest && node.closest('button[aria-controls]');
      if (!b || tidy(b.textContent) || !isToggle(b)) return null;
      return { type: 'navtoggle', el: b, label: 'Menu button' };
    });
    core.addToolAction({
      act: 'nav-toggle', icon: 'menu', order: 10,
      text: (s) => `${shown.has(s.el.getAttribute('aria-controls')) ? 'Hide' : 'Show'} ${toggleName(s.el)}`,
      title: (s) => `Show or hide the ${toggleName(s.el)} while editing (visitors aren’t affected)`,
      when: (s) => s.type === 'navtoggle',
      run: (s) => toggleShown(s.el),
    });
    core.addToolAction({
      act: 'nav-panel', icon: 'pencil', text: 'Edit menu', order: 11,
      title: 'Open the Menu panel',
      when: (s) => s.type === 'navtoggle',
      run: () => { if (!isOpen()) core.togglePanel('nav'); },
    });
    addEventListener('click', (e) => {
      if (e.composedPath().includes(core.host)) return;
      const t = e.target && (e.target.nodeType === 1 ? e.target : e.target.parentElement);
      const b = t && t.closest && t.closest('button[aria-controls]');
      if (b && !tidy(b.textContent) && isToggle(b)) toggleShown(b);
    }, true);

    // Changing a header link's address with the link button also offers to change the same link in the other menus.
    core.on('pop:link', (formEl, { link }) => {
      const h = header();
      if (!formEl || !link || !h || !h.contains(link)) return;
      const menus = readMenus();
      const found = nodeFor(menus, link);
      if (!found) return;
      const groups = twinsOf(menus, found.menu, found.node);
      if (!groups.length) return;
      const twinEls = groups.flatMap((g) => g.nodes.map((n) => n.a));
      const oldHref = hrefOf(link);
      formEl.querySelector('.row')?.insertAdjacentHTML('beforebegin', `<label class="nv-check nv-pop"><input type="checkbox" name="nv-twins" checked><span>Also change it in the ${esc(groups.map((g) => lower(g.menu.name)).join(' and the '))}</span></label>`);
      formEl.addEventListener('submit', (e) => {
        if (e.submitter && e.submitter.value === 'remove') return;
        if (!formEl.querySelector('[name="nv-twins"]')?.checked) return;
        setTimeout(() => {
          const nh = hrefOf(link);
          if (!nh || nh === oldHref || !link.isConnected) return;
          const setTwins = () => twinEls.forEach((t) => { if (t.isConnected) t.setAttribute('href', nh); });
          // Still typing in the link: the change joins the link's own undo step (recorded when editing ends).
          if (core.editing && h.contains(core.editing)) { setTwins(); core.markDirty(h); } else core.mutate(h, setTwins);
        }, 0);
      });
    });
  });
