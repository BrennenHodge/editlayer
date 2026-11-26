### Menu editor and editable header (feature: nav)

**What editors can do**
- The site header is now editable on every page, like the footer: click any menu text and type. Changes are saved as a draft and appear on every page when you publish.
- **Menu** button (bottom bar) opens the Menu panel. It lists every menu in the header: the main menu with its dropdowns, and the mobile menu that phone visitors open with the menu button.
  - Click a link to rename it or change where it goes. "Goes to" lists the site's pages; pick "Another address…" for part of a page (/about-us/#history), another website (https://…), email (mailto:) or phone (tel:).
  - Move links up or down, delete them, add a link to a menu or to a dropdown. New links copy the look of their neighbours, and numbered dropdowns (01, 02 …) renumber themselves.
  - If the same link is also in the other menu, renaming, changing or deleting it asks "Also change it in the mobile menu" (ticked by default) and shows what that link currently says. Adding a link offers "Also add it to the mobile menu".
  - "Add this page to the menu" appears when the page you're on isn't in any menu.
  - "This page" marks the link for the page you're on. A warning appears if the main menu no longer fits on one line.
  - Undo with Ctrl+Z or the Undo button; every menu change is one undo step.
- Dropdowns open when you hover over them while editing, and stay open while you type in one of their links. On a phone-sized screen, tap the menu button on the page to show the mobile menu and edit it directly; tap again to hide it. Visitors aren't affected.

**How "current page" works (aria-current)**
- `vibecms annotate` now makes a header (or footer) site-wide even when pages differ only by `aria-current="page"` on a menu link. The region's hash ignores that mark, and each page records its current link on the region: `<header data-cms="@header" data-cms-v="…" data-cms-current="/services/">`. Pages with no current link get `data-cms-current=""`. Static files keep their own aria-current, so pages nobody edited are served exactly as built.
- When a page is rendered (visitors, previews, edit mode), the Worker sets `aria-current="page"` on the recorded link and removes it from every other link in that region. An edited header therefore always marks the right link, even though it was saved from another page. Each recorded address marks the first link with that address (listed twice, the first two), matching what the build produced (a dropdown's own copy of the parent link is not marked).
- Only `aria-current="page"` on `<a href>` is handled. Sites that never use it get no `data-cms-current` and behave as before. Headers that differ in any other way between pages stay developer-only, as before.

**Site setup**
- Nothing new for most sites: re-run `vibecms annotate` after the build (add it to the end of the site's build). The header must be the first `<header>` before `<main>`, with its menus in `<nav>` elements. Name them with aria-label: "Primary"/"Main" becomes "Main menu"; anything mentioning mobile/phone becomes "Mobile menu".
- A mobile-menu toggle that is a `<button aria-controls="id">` pointing at a hidden element inside the header is recognised automatically in edit mode.
- Pages the CMS creates itself (page creator) should carry `data-cms-current="<their own path>"` (or "") on the header, so they get the same treatment.

**For other features**
- `core.emit('nav:add', { label, href })` adds a link to every menu that doesn't already have one with that address. Each goes at the end of the top level, before buttons such as "Start a project", copying a neighbour's markup, as one undoable change. The listener returns `true` when handled and `false` for an invalid label/address or when the site has no header menus.

**Options**
- None. No tables, bindings or secrets.

**README edits suggested**
- In "How it works › Regions", replace "A shared region that differs per page (a header that marks the current menu item) is left alone…" with: "A header whose pages differ only by which menu link is marked current (aria-current) is still site-wide; the current link is recorded per page in data-cms-current and re-applied when the page is served."
