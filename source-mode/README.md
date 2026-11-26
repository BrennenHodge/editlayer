# Vibe CMS source mode (Phase 0)

Click-to-edit for sites on any host. The editor clicks text on their live site and types; Vibe CMS finds that text
in the site's source code, writes the change there, and commits it. The site's normal deploy (Railway, Vercel,
Netlify, Cloudflare, anything that deploys on push) puts it live. Plan and results: [../PLAN-any-site.md](../PLAN-any-site.md).

Phase 0 runs locally against a test repository with no remotes. It never pushes and never commits to `main`.

## Files

| File | What it does |
|---|---|
| `client/vibe.js` | The one script tag a site adds. Sign-in hand-off, freezing the rendered page, click-to-edit, drafts, publish, deploy status. |
| `src/text.js` | What a reader sees: entities and JS escapes decoded, whitespace collapsed, with a map back to the raw source. |
| `src/find.js` | Find: every place a text appears as page text (JSX text, string literals, HTML/Markdown text), whole matches first, then neighbour scoring. |
| `src/apply.js` | Change: writes new text at a found place, escaped for that kind of source, and checks the file still parses. |
| `src/service.js` | Drafts and publishing (one commit per publish). |
| `src/repo-local.js` | A repository on this computer (git CLI), with the Phase 0 safety rules. |
| `src/repo-github.js` | The same over the GitHub API. Written, not yet run. |
| `server.mjs` | The local service: serves `vibe.js`, the API, and a stand-in deployer that runs the site's build after each commit. |
| `test/find.test.mjs` | Unit tests (`npm test`). |
| `test/eval-site.mjs` | Runs the finder on every text of a built site and reports how often it finds one place, asks, or finds nothing. |
| `test/where.mjs` | Lists every place a text appears in a repository. |

## Try it on a local copy of a site

Use PowerShell, not Git Bash (Git Bash turns `BASE_PATH=/` into a Windows path).

1. Clone the site somewhere temporary, remove its remote, make a test branch:
   `git clone <site> <dir>`, `git -C <dir> remote remove origin`, `git -C <dir> checkout -b vibecms-test`.
2. Add `<script src="http://localhost:8790/vibe.js" async></script>` before `</head>` in the site's HTML template,
   commit it on the test branch, build the site and serve it (Lexar: `node scripts/sandbox-site.mjs <dir> 3310`).
3. Start the service:

   ```powershell
   node server.mjs --repo <dir> --branch vibecms-test --site http://localhost:3310 --build "<the site's build command>" --build-env "PORT=3000,BASE_PATH=/"
   ```

4. Open the sign-in link it prints (more at http://localhost:8790/link), click text, type, Enter, Publish.
