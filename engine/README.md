# Editlayer

Click-to-edit layer for static websites on Cloudflare Workers. Editors browse the real site, press **Edit page**,
click any word to type over it, click a picture to replace it, and publish. Fonts, spacing and layout never change
because they edit the page itself, not a form.

Every site is also an MCP server, so ChatGPT, Claude and Grok can edit it too (see "AI assistants" below).

## What editors can do

| On the page | How |
|---|---|
| Change text | Click it and type. Enter starts a new paragraph or list item; Shift+Enter is a line break. Paste is always plain text. |
| Bold, italic, links | Toolbar above the text (Ctrl+B, Ctrl+I, Ctrl+K). Headings and buttons stay plain on purpose. |
| Change a link or button target | Click the button text, then the link icon. Site pages are suggested. |
| Replace an image | Click it, then **Replace**: upload (resized and converted to WebP in the browser) or pick from the library. Alt text in the same dialog. |
| Cards, list items, rows, paragraphs | Toolbar: duplicate, move up/down, delete, or select the container. |
| Sections | Bar at the top-right of each section: move, duplicate, hide (kept as a faded draft), delete, or add a section copied from any page. |
| Page title and description | **Page settings**, with a Google preview and length guidance. |
| Undo | Ctrl+Z / Ctrl+Shift+Z, or the bar buttons. |
| Drafts and publishing | Changes autosave as a draft only editors see. **Publish** makes them live for this page and the site-wide footer. |
| History | Every publish is kept. Restore any version (as a draft), discard drafts, or reset a page to the developer's version. |
| Editors | Admins invite people from the **Editors** panel and send them the one-time link (7 days). |

## Features

Each feature is a plug-in (`client/features/<name>.js`, `src/features/<name>.js`; see
[docs/features.md](docs/features.md) to write one). Editor guides and site options:

- [Site styles](docs/guide/styles.md)
- [Whole-section tools](docs/guide/sections.md)
- [Menu editor and editable header](docs/guide/nav.md)
- [New pages and device preview](docs/guide/pages.md)
- [Form inbox](docs/guide/forms.md)
- [Documents, video, focal point and backgrounds](docs/guide/media.md)
- [Approval, preview links, scheduling and emailed invites](docs/guide/review.md)
- [Writing help and find & replace](docs/guide/writing.md)
- [Checks before publishing and editing items as a form](docs/guide/quality.md)

Site setup for a full install: run `npx wrangler d1 migrations apply <db> --remote` after updating the package;
add `"triggers": { "crons": ["*/5 * * * *"] }` (scheduled publishing, form clean-up) and `"ai": { "binding": "CMS_AI" }`
(writing help) to the site's wrangler.jsonc; optional secrets `RESEND_API_KEY` (emailed invites and form alerts) and
`TURNSTILE_SECRET`. Forms are switched off per site with `forms: false`.

## How it works

- **Regions.** `editlayer annotate` marks each built page's `<main>` as `data-cms="main"` and the shared
  `<footer>` (and `<header>`, when it's identical on every page) as `data-cms="@footer"`. Each gets `data-cms-v`,
  a hash of the developer's version. A shared region that differs per page (a header that marks the current menu
  item) is left alone, so editing it can't break other pages.
- **Storage.** Edited regions are stored whole, as sanitized HTML, in D1 (`cms_regions`: page path, key,
  draft/live). Site-wide regions use path `*`. Images go to R2 and are served at `/_cms/media/<id>.webp`.
- **Serving.** The Worker fetches the static page and swaps in edited regions with `HTMLRewriter` as it streams.
  Pages nobody edited pass through untouched. If the CMS errors, the static page is served instead.
- **Edit mode** (`?edit`, signed in): drafts applied, the site's own scripts removed (so menus and filters
  don't fight the editor, and what's saved is the clean markup), `<details>` opened, editor loaded in a shadow
  root so site CSS and editor CSS never mix.
- **Developer changes.** If a page is rebuilt with different content in a region editors have also edited, the
  editor's version keeps showing and the editor shows a banner: keep the edited version, or use the
  developer's. `editlayer status` lists these.
- **Security.** PBKDF2 passwords, a `__Host-` HttpOnly session cookie (30 days), lockout after 8 failed sign-ins,
  a custom header plus a same-origin check on every write, and sanitized HTML. See "Security" below.

## Add it to a site

Requirements: a static site deployed as a Cloudflare Worker with static assets (`wrangler.jsonc` in the site
folder), pages that use `<main>`, and a `sitemap.xml` (used for the page list). With the Claude Code plugin, ask
Claude Code to "make this site editable" (skill `editlayer:editlayer`); by hand:

```powershell
cd <site folder>
node <path to engine>\cli\editlayer.mjs init --name "Business Name" --accent "#hex"
```

`init` creates the D1 database `<worker>-cms` and the R2 bucket `<worker>-cms-media`, copies the engine into
`./_editlayer` (so the site deploys on its own), writes `cms.worker.js`, updates `wrangler.jsonc` (Worker entry,
bindings, `run_worker_first`, a zone route next to each custom domain so POSTs aren't caught by a wildcard Worker),
adds CMS files to `.assetsignore`, applies the migrations, and marks the pages.

Then:

1. Run `node _editlayer/cli/editlayer.mjs annotate <build output dir>` at the end of the site's build.
2. Mark anything JavaScript rewrites at runtime with `data-cms-lock`.
3. Deploy as usual (`npx wrangler deploy`).
4. Create the first admin and send them the link:
   `node _editlayer/cli/editlayer.mjs user add name@example.com --name "Name" --admin`

## Sign-in

`createCms({ login })`: `"password"`, `"link"` (editors type their email and get a one-time sign-in link, 15 minutes;
invite links sign straight in) or `"both"`. Links need email: `email: { from: 'Site <signin@your-verified-domain>' }`
plus the `RESEND_API_KEY` secret. Without email the site falls back to passwords, so nobody is locked out.
Link secrets are stored hashed (`cms_login_links`, migration 0019), work once, and an address gets at most 3 per
15 minutes. Opening a link shows a "Sign in" button rather than signing in on GET, so mail scanners can't use it up.

## AI assistants (MCP)

Every site serves a stateless Streamable HTTP MCP server at `/_cms/mcp` (`src/features/mcp.js`). Admins create a
key per assistant in **Editors > AI assistants**, or `editlayer connect <name> [--publish]`. The key goes in the URL
(`/_cms/mcp/vcms_…`, for ChatGPT and claude.ai, which take a URL only) or in `Authorization: Bearer`. Only a SHA-256
hash of each key is stored (`cms_ai_tokens`, migration 0018).

Tools: `list_pages`, `get_page`, `replace_text`, `update_region`, `set_page_settings`, `list_drafts`, `publish`,
`discard_drafts`, `get_history`. Changes are drafts attributed to "<name> (AI)". A key has the author role (drafts
only) unless made with `--publish` (editor role: may publish and change site-wide regions).

## Security

Who can change what, and what keeps a hijacked account or a prompt-injected AI from abusing the site:

- **Saved HTML is sanitized on the server** (`src/sanitize.js`): no scripts, event handlers, `javascript:` URLs,
  `<object>`/`<embed>`/`<base>`/`<meta>`/MathML, SVG animation or SVG `<style>`, and no `id`/`name` values that would
  shadow the editor or `document` methods. Editors and admins keep everything else.
- **Authors and every AI connection get the strict level** on top: no iframe except YouTube, Vimeo and Google Maps
  players (add hosts with `createCms({ embeds: ['calendly.com'] })`), no form that sends to another site, no new
  `<style>` or `<link>`. What the region already had (the developer's own Formspree form, an existing embed) is
  kept. Save responses list what was removed (`removed`), and the MCP tools pass that on to the AI.
- **AI connections**: keys are hashed, stop working when the admin who made them is removed or loses the admin role
  (`editlayer connect` keys excepted), are rate limited (300 tool calls / 10 minutes, 120 of them changes; table
  `cms_ai_usage`, migration 0020), and can't publish or touch site-wide parts without the editor role. The server
  tells the AI that page content is data, never instructions. Requests over 2 MB or batches over 20 are refused.
- **The editor page** (`?edit`) is served with a Content-Security-Policy that only runs the editor and scripts the
  developer marked `data-cms-keep`, so injected markup couldn't run even if it got past the sanitizer.
- **Sessions** use a `__Host-` cookie on https (a sibling subdomain can't set or overwrite it), HttpOnly,
  SameSite=Lax. Every API write needs the `x-editlayer: 1` header and a same-origin `Origin`, which blocks CSRF.
  API bodies over 8 MB or with more than 300 regions are refused.
- **Uploads**: images are checked by their first bytes (an HTML file renamed `.png` is refused) and served with
  `nosniff` and a sandbox CSP; documents have their own content checks (`src/features/media/files.js`).
- Authors can only restore the page's own parts from history, never site-wide ones.

Regression tests: `test/security/` (see its README). Run them before releasing an engine change.

## Commands

Run from the site folder (or add `--site <dir>`). Add `--local` (and `--port N`) to use the `wrangler dev` database.

| Command | Does |
|---|---|
| `editlayer init [--name N] [--accent #hex]` | Add Editlayer to a site |
| `editlayer update` | Copy this engine version into `./_editlayer` and apply new migrations |
| `editlayer annotate [dir]` | Mark regions in built HTML and list site images for the picker |
| `editlayer user add <email> [--name N] [--admin]` | Create an editor and print their invite link |
| `editlayer user link <email>` | New invite link (also how a forgotten password is reset) |
| `editlayer user list` / `user remove <email>` | Manage editors |
| `editlayer connect <name> [--publish]` | AI connection: prints its MCP URL |
| `editlayer connect list` / `connect remove <name>` | Manage AI connections |
| `editlayer status` | Every edited region, draft or live, and which ones the developer has since changed |

## Working on Editlayer itself

- Browser code is in `client/` (`editor.js`, `ui.css`, `editor.css`, `launcher.js`). After changing it run
  `node scripts/build-client.mjs`, which embeds it into `src/client-assets.js`. Then redeploy each site that uses it.
- Worker code is in `src/`; schema in `migrations/` (add new numbered files, never edit applied ones).
- After any change here, run `node scripts/sync-plugin.mjs` (repo root) so the Claude Code plugin ships it.
- Local test: the marketing site in `../site` runs on this engine: `npx wrangler dev --port 8792` in `site/`,
  then `editlayer user add editor@example.test --admin --local --port 8792` and open the printed link.

## Not yet

- Background images set in the site's stylesheet aren't clickable (inline ones, such as section photos, are).
- Folding editors' changes back into the site's source files (`editlayer status` shows what changed).
