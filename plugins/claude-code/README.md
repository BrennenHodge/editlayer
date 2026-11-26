# Vibe CMS for Claude Code

Vibe CMS turns a static website you built with Claude Code into one its owner can edit on the live page. They open
their own site, press **Edit page**, click any text and type over it, replace photos, add and reorder sections, edit
menus and page settings, save drafts and publish. The site's HTML and CSS stay the source of the design, so edits
can't break the layout.

The site runs on Cloudflare Workers. Edits are stored in Cloudflare D1, images in R2, both in the site owner's own
Cloudflare account. Every Vibe CMS site also has an MCP endpoint, so ChatGPT, Claude and Grok can read and edit pages
when the owner connects them.

## Skills

| Skill | What it does |
|---|---|
| `vibe-cms` | Adds Vibe CMS to the site in the current project: checks the site fits, sets up the Worker, D1 database and R2 bucket, marks the pages, and walks through deploying and creating the owner's account. |
| `invite-editor` | Creates an editor account and prints a one-time invite link (also resets a forgotten password). |
| `connect-ai` | Makes an MCP connection key so ChatGPT, Claude or Grok can edit the site (drafts only, or with publishing). |
| `cms-status` | Lists what editors have changed, so a developer rebuilding pages doesn't overwrite their work. |

## Install

```
/plugin marketplace add BrennenHodge/vibe-cms
/plugin install vibe-cms@vibe-cms
```

Then ask Claude Code to "make this site editable" in a project that contains a static site.

## Requirements

- A static HTML site (hand-written or the output of a static build) with a `<main>` element on each page and a
  `sitemap.xml`.
- A Cloudflare account. You sign in once with `npx wrangler login`; Claude Code asks before it deploys anything.
- Node.js 20 or later.

## Data and privacy

The plugin runs locally and talks only to your own Cloudflare account through Wrangler. It sends nothing to
dbVantage. Site content, editor accounts and images stay in the D1 database and R2 bucket it creates in your
account. Privacy policy: https://cms.dbvantage.com/privacy/

## Support

Documentation: https://cms.dbvantage.com/developers/ · Support: https://cms.dbvantage.com/support/

## License

Commercial software, all rights reserved. See [LICENSE](LICENSE).
