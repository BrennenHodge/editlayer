# Vibe CMS

The click-to-edit CMS for websites built with AI. Site owners open their own site, click any text and type, swap
photos, add sections and publish. Or they ask ChatGPT, Claude or Grok to do it, through the MCP server built into
every Vibe CMS site.

## What's here

| Folder | What it is |
|---|---|
| `engine/` | The CMS: Cloudflare Worker (`src/`), editor (`client/`, built into `src/client-assets.js`), CLI (`cli/vibecms.mjs`), D1 migrations, docs. |
| `plugins/claude-code/` | The Claude Code plugin: skills `vibe-cms`, `invite-editor`, `connect-ai`, `cms-status`, plus a bundled copy of the engine (`node scripts/sync-plugin.mjs`). |
| `.claude-plugin/marketplace.json` | Makes this repo a Claude Code plugin marketplace. |
| `plugins/chatgpt/`, `plugins/grok/` | How ChatGPT and Grok connect today (per-site MCP URL), and what an app-directory listing needs. |
| `site/` | The marketing site, live at https://cms.dbvantage.com (Worker `vibecms`, D1 `vibecms-cms`, R2 `vibecms-cms-media`). It runs on Vibe CMS itself. Redeploy: `python build.py`, then `npx wrangler deploy` in `site/`. |
| `scripts/` | `sync-plugin.mjs` (engine → plugin), `make-brand.mjs` (OG image, icons). |

## Everyday commands

```powershell
node scripts/sync-plugin.mjs            # after changing engine/: rebuild the editor and copy it into the plugin
cd site; python build.py                # rebuild the marketing site (PWA + Vibe CMS annotate included)
npx wrangler dev --port 8792            # in site/: run it locally with the CMS (local D1/R2)
node ../engine/cli/vibecms.mjs update --local --port 8792   # in site/: refresh its vendored engine
```

Local test admin for the site: `site/.dev-test-user.json` (gitignored, local only).

## Installing the plugin (once the repo is on GitHub)

```
/plugin marketplace add dbvantage/vibe-cms
/plugin install vibe-cms@vibe-cms
```

To try it before pushing: `/plugin marketplace add C:\Users\brenn\VibeCMS`.
