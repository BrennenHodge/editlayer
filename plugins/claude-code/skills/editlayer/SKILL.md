---
name: editlayer
description: Add Editlayer to the website in this project so its owner can edit it on the live page (click text and type, replace photos, add and move sections, menus, page settings, drafts, publish, history). Use when the user wants their client, staff or themselves to edit a site without coming back to Claude Code, asks for a CMS, an admin, a WYSIWYG or visual editor, "make the site editable", or wants ChatGPT/Claude/Grok to edit the site. Works on static HTML sites hosted (or about to be hosted) on Cloudflare Workers.
argument-hint: "[site folder]"
---

# Add Editlayer to a site

Editlayer edits the real page. Editors browse their live site, press **Edit page**, click any word to type over it,
click a picture to replace it, and publish. The developer's HTML and CSS stay the source of the design; edits are
stored in Cloudflare D1 and swapped into the static pages by a Worker as they stream. Nobody's edits can break the
layout, and an Editlayer error falls back to the static page.

The engine and CLI ship with this plugin:

```
node "${CLAUDE_PLUGIN_ROOT}/engine/cli/editlayer.mjs" <command>
```

Below, `editlayer` means that command. Run it from the site folder (the one that has, or will have, `wrangler.jsonc`),
or pass `--site <dir>`.

## 1. Check the site fits

- Static HTML output (hand-written, a build script, Astro/Eleventy/Hugo/Vite static output). Not a server-rendered
  app (Next.js SSR, Rails): say so and stop.
- Each page has a `<main>` element (the editable page content). A shared `<header>`/`<footer>` becomes editable
  site-wide automatically when it is identical on every page.
- A `sitemap.xml` in the output (the editor's page list). Add one to the build if it's missing.
- Root-absolute or relative asset URLs both work.
- Anything JavaScript rewrites at runtime (live counters, hours that change) gets `data-cms-lock` so editors
  don't save a snapshot of it.

## 2. Make it a Cloudflare Worker site (if it isn't yet)

The user needs a Cloudflare account and `npx wrangler login` once (they do the login themselves). Create
`wrangler.jsonc` next to the build output if it's missing:

```jsonc
{
  "name": "<short-worker-name>",
  "compatibility_date": "2026-11-01",
  "assets": { "directory": "<build output dir, e.g. dist or .>", "not_found_handling": "404-page" }
}
```

Add `"routes": [{ "pattern": "www.example.com", "custom_domain": true }]` when the user has a domain on
Cloudflare. Ask before choosing a domain or deploying anything.

## 3. Install

```
editlayer init --name "<Business Name>" --accent "<brand hex>"
```

This creates the D1 database `<worker>-cms` and the R2 bucket `<worker>-cms-media`, copies the engine into
`./_editlayer` (so the site deploys on its own from any machine or CI), writes `cms.worker.js`, updates
`wrangler.jsonc` (entry, bindings, `run_worker_first`, a zone route beside each custom domain), keeps CMS files out
of the public assets (`.assetsignore`), applies the database migrations and marks the pages.

Optional extras in `wrangler.jsonc`: `"triggers": { "crons": ["*/5 * * * *"] }` (scheduled publishing, form
clean-up) and `"ai": { "binding": "CMS_AI" }` (writing help). Secrets: `RESEND_API_KEY` (emailed invites and form
alerts), `TURNSTILE_SECRET` (form spam protection).

Tune `cms.worker.js` to the site (see `${CLAUDE_PLUGIN_ROOT}/engine/README.md` and `engine/docs/guide/*.md`):
`styles` (which CSS custom properties editors may change, contrast pairs, fonts), `sections` (background choices
using the site's own classes), `pages` (layout for new pages), `forms: false` to keep mailto forms.

## 4. Mark pages on every build

Add this as the last step of the site's build so new and changed pages are editable:

```
node _editlayer/cli/editlayer.mjs annotate <build output dir>
```

It is idempotent. Without a build step (hand-written HTML), run it once before each deploy.

## 5. Deploy and hand over

1. `npx wrangler deploy` (ask first: it publishes the site).
2. Create the owner's admin account and give the user the one-time link (7 days):
   `editlayer user add owner@example.com --name "Owner Name" --admin`
3. Tell them: open the site, sign in from the link, press **Edit page**. Admins invite more people from the
   **Editors** panel (roles: author, editor, admin).

## 6. Optional: let AI assistants edit the site

Every Editlayer site has an MCP endpoint at `/_cms/mcp`. Make a connection key with
`editlayer connect ChatGPT` (drafts only) or `editlayer connect ChatGPT --publish`, or have an admin use
**Editors > AI assistants** in the editor. The printed URL goes into ChatGPT (chatgpt.com/plugins > Add custom MCP server), Claude
(Settings > Connectors) or `claude mcp add --transport http <name> <url>`. For ChatGPT and Claude the hosted
connector, `https://mcp.editlayer.co/mcp`, needs no key: the site's admin signs in and approves. The `connect-ai` skill walks through it.

## Developer changes vs. editor changes

Editors' changes live in D1, not in the source files. Before rebuilding a region someone has edited, run
`editlayer status` (add `--local` for `wrangler dev`). If a rebuilt page differs from what was edited, the editor's
version keeps showing and the editor offers "keep mine" or "use the developer's version".

## Local testing

`npx wrangler dev --port 8791`, then `editlayer user add editor@example.test --admin --local` and open the printed
invite link with port 8791. Keep local test credentials in a gitignored file, never in chat.

## Updating

`editlayer update` copies this plugin's engine into `./_editlayer` and applies new migrations; then deploy.
