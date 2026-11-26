### New pages

Editors can add pages without a developer. Open **Pages** in the editor bar:

| Button | What it does |
|---|---|
| **New page** | Asks for a page title and a web address. The address is made from the title, and you can change it. Use lowercase words joined by hyphens, like `summer-workshops`. The form says straight away if the address is free, or why it can't be used: another page has it, it forwards to another page, or it's kept for the website itself. Then choose **Start from**: **A copy of a page** (everything on that page, ready to change) or **A simple page** (the top of the page you pick as the layout, plus one text section with prompts such as "Add a heading"). If the site's menu can take new links, an **Add it to the menu** box is shown too. |
| **Duplicate this page** | The same form, already set to copy the page you're on. |
| **Delete this page** | Only shown on pages made in the editor, and only to editors and admins. It asks for confirmation and can't be undone. Pages that came with the site can't be deleted here. |

A new page starts as a **draft**: only signed-in editors can open it, and visitors get the normal "page not found" until you **Publish** it. After that it behaves like any other page: autosave, undo, page settings, history. Published new pages are added to `sitemap.xml` automatically. The Pages list shows their titles and marks unpublished ones **Not published**.

### Preview on phone, tablet and computer

The **Preview** button in the editor bar saves your changes, then shows the page, unpublished changes included, at phone (390 px), tablet (768 px) and computer (1280 px) widths, scaled to fit the screen. **Reload** refreshes it. **Esc** or the close button returns to editing. Links clicked inside the preview open other pages in preview too.

### How new pages work (developers)

- Table `cms_pages(path, template, title, created_at, created_by)` (migration `0013_pages.sql`; apply it with `wrangler d1 migrations apply <db>`). `template` is a static page whose HTML is the new page's shell: head, header, footer.
- The page's own content is stored like any page's: region rows for its path in `cms_regions`, title and description in `#meta`.
- When a URL has no static file, the Worker serves the template's HTML with status 200 and applies the new page's regions. In that shell:
  - the canonical link and `og:url` point at the new address, and the title is the new page's;
  - `aria-current` is removed from the menu, and so is the template's JSON-LD;
  - the template's description is dropped until the page has its own (set it in **Page settings**);
  - `data-cms-v` is removed from page regions, so rebuilding the template page never shows the "developer changed this page" banner on new pages.
- Visitors only see a page once its main content is published.
- Addresses are one level deep (`/x/`). They may not clash with a static page, a `_redirects` rule, another new page, `/_cms` or a reserved word. A request for `/x` redirects to `/x/`.
- If a static page is later added at the same address, the static page wins.
- Each "page not found" for a one-level address costs one D1 read.
- Deleting a page removes its rows from `cms_regions` and `cms_pages`. Published versions stay in `cms_revisions`.

Options (`createCms({ pages: { … } })`, all optional):

| Option | Default | Meaning |
|---|---|---|
| `layout` | the page being edited | Static page offered first as the layout for "A simple page" (for example `"/services/"`). |
| `textSection` | built from the layout's own section and container classes | HTML for the simple page's text section. Mark the element that should hold the heading and text with `data-text`. For example: `'<section class="sec"><div class="wrap prose" data-text></div></section>'`. |
| `reserved` | `[]` | Extra one-level addresses editors may not use, for example `["blog", "news"]` if another feature serves them. |

Editor events, for other features:

- `core.emit('nav:available')`: a menu feature returns `true` if it can add links. Only then does the form show **Add it to the menu**.
- `core.emit('nav:add', { label, href })`: the listener adds the link through `core.mutate` or `core.setExtra`, and may return a promise. Pages waits for it, saves, and then opens the new page.
- `page:created { path, title }` and `page:deleted { path }` are emitted for anything else that wants to react, for example removing a deleted page from the menu.

Worker API (`/_cms/api/…`):

| Request | Who | Does |
|---|---|---|
| `GET cms-pages` | author and up | List pages made in the editor |
| `GET cms-pages/check?path=` | author and up | Check an address |
| `POST cms-pages {title, path, mode: "copy" or "simple", from, regions}` | author and up | Create a page. `regions` holds the starting HTML for the template's page regions; anything else is ignored, and everything is cleaned like any saved edit. |
| `DELETE cms-pages {path}` | editor and up | Delete a page made in the editor |
