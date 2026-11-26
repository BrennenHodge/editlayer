# Claude directory (claude.ai/directory/manage)

Two separate submissions from the same page: the Claude Code plugin, and the connector for claude.ai and the
desktop app. Field names on the form may differ slightly; the copy below covers what it asks for.

## 1. Claude Code plugin

- **Repository / marketplace:** https://github.com/BrennenHodge/editlayer (marketplace file
  `.claude-plugin/marketplace.json`, plugin folder `plugins/claude-code`)
- **Plugin name:** `editlayer` (install: `/plugin marketplace add BrennenHodge/editlayer`, then
  `/plugin install editlayer@editlayer`)
- **Category:** Development
- **Short description:** Add a click-to-edit layer to any static site: your client edits text, photos and sections
  right on the live page.
- **Description:**
  Editlayer makes a static website editable without rebuilding it. Ask Claude Code to "make this site editable for
  my client" and the plugin adds a Cloudflare Worker in front of the site, creates its database and image storage
  in your own Cloudflare account, marks the editable parts of each page and makes an invite link. The site owner
  then opens their own site, clicks the words and types; photos, sections, menus, page titles, drafts, scheduled
  publishing and history are all on the page. Your HTML and CSS stay in charge of the design. Every site also gets
  an MCP endpoint so ChatGPT and Claude can edit it with the owner's approval.
- **Skills:** `editlayer` (set up a site), `invite-editor`, `connect-ai`, `cms-status`
- **What it needs:** a static site and a Cloudflare account (Wrangler signed in). It sends nothing to us; see the
  plugin README and https://editlayer.co/privacy/.
- **License:** proprietary (plugins/claude-code/LICENSE). **Support:** https://editlayer.co/support/

## 2. Connector (remote MCP server)

- **Name:** Editlayer
- **Server URL:** `https://mcp.editlayer.co/mcp` (Streamable HTTP)
- **Authentication:** OAuth 2.1, authorization code with PKCE (S256). Dynamic client registration at
  `/register` and client ID metadata documents are both supported. Metadata:
  `https://mcp.editlayer.co/.well-known/oauth-protected-resource` and
  `https://mcp.editlayer.co/.well-known/oauth-authorization-server`. Public clients; no client secret.
- **Tagline:** Edit your website by chat
- **Description:**
  Editlayer lets you change your own website by asking Claude. It works with websites that use Editlayer, the
  click-to-edit layer for sites built with AI tools. Connect once: type your website's address, sign in to your
  site as usual and choose what Claude may do there, save drafts only or save drafts and publish. Only an admin of
  the site can approve, and an admin can turn the connection off at any time. Then ask Claude to list your pages,
  change your opening hours, rewrite a section, improve a page's Google title and description, or show what's
  waiting and publish it. Every change is saved as a draft first, keeps your site's design and is recorded in the
  site's history. Page content passes through the connector to answer a request and is not stored.
- **Tools (11):** read-only: `list_sites`, `list_pages`, `get_page`, `list_drafts`, `get_history`. Changes:
  `replace_text`, `update_region`, `set_page_settings` (save drafts), `discard_drafts`, `publish`,
  `disconnect_site`, all marked `destructiveHint: true`; `publish` is also `openWorldHint: true` because it changes
  the public site. Every tool has a title.
- **Example prompts:**
  1. "What pages does my Juniper Café website have, and do any have unpublished changes?"
  2. "On my Juniper Café site, change the Saturday opening hours on the home page from 8am – 2pm to 9am – 3pm.
     Don't publish it yet."
  3. "Give the Menu page a better Google title and search description that mention sourdough and coffee."
  4. "Show me which pages have changes waiting, then publish the home page."
- **Test account:** see `reviewer-account.local.md` (website `demo.editlayer.co`, email and password, admin, no
  MFA). Sign-in steps for the reviewer:
  1. Add the connector with the server URL above.
  2. When asked for a website, type `demo.editlayer.co` and press Continue.
  3. Sign in with the test email and password.
  4. Choose **Save drafts and publish** to try every tool (or drafts only), then **Allow**.
  5. Try the example prompts. The demo site resets its page edits every night at 04:40 UTC.
- **Documentation:** https://editlayer.co/ai/ · **Privacy policy:** https://editlayer.co/privacy/ ·
  **Terms:** https://editlayer.co/terms/ · **Support:** https://editlayer.co/support/
- **Logo:** `chatgpt/assets/logo.png` (512 x 512 PNG) · **Screenshots:** `screenshots/` (no interactive UI, so
  optional)
