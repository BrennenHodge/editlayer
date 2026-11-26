# Vibe CMS on any site: plan

Status: Phase 0, local part done (2026-11-25): the full loop works on a local copy of Lexar. Code in
[source-mode/](source-mode/README.md); results under "Phase 0 results" below. Nothing was pushed to GitHub and
nothing touched Railway or lexarinsulation.com.

## Goal

A developer (or a business owner) built a site with Claude Code, Lovable, Replit, Bolt, v0 or by hand, and hosts it
anywhere: Cloudflare, Vercel, Netlify, Railway, Render, Replit, Lovable, GitHub Pages, shared hosting. They hand it to
a client. The client opens their own site, clicks a word, types, replaces a picture, publishes. No migration, no
rewrite of the site, no second copy of the content that drifts away from the code.

## What changes from today's engine

Today the engine stores edits as HTML in D1 and a Cloudflare Worker swaps them into each page as it is served. That
needs Cloudflare hosting, and it fails on React/Vue sites, because the app redraws the page from its code and throws
the edit away (see the Lexar notes below).

The change: **write the edit back into the site's source code and let the site's normal deploy publish it.** The
click-to-edit editor stays the same for the client. Underneath, "Publish" becomes a commit to the site's repository,
and every host that deploys on push (Vercel, Netlify, Cloudflare, Railway, Render, Fly, GitHub Pages and others) is
supported with no host-specific code.

Why this over a separate content store with keys (what I suggested earlier for React sites): keys mean refactoring
every site to read from the store, and they create a second source of truth. Writing back to source needs no
refactor, the developer's next `git pull` has the client's changes, Claude Code sees them, SEO is whatever the site
already does, and the client's site never depends on Vibe CMS to load.

The existing HTML-region mode stays as the option for sites with no repository (see "Sites without git").

## Evidence: Lexar

I measured the built Lexar site (`~/Lexar/Lexar Website/artifacts/lexar-website`, React + Vite, prerendered,
hosted on Railway): every visible text piece on the built pages, searched for verbatim in `src/`.
Script: [tools/textmap.mjs](tools/textmap.mjs) (`node tools/textmap.mjs <built html dir> <source dir>`; run it on
any site to see how well source mode fits it).

| Pages | Found once in source | Found in several places | Only in JSON data | Not found verbatim |
|---|---|---|---|---|
| 18 marketing pages | 70% of characters | 29% | 0% | 1% |
| 15 dealer state pages (generated from data) | 42% | 43% | 4% | 11% |

So on a typical vibe-coded marketing site essentially all text exists as a literal in the source. Most of it can be
located with a plain text search. The "several places" share is mostly short shared strings (button labels, nav,
the same sentence on several pages) and needs a way to pick the right one (below). The misses are text built by code
(`{count} stocking dealers`) or from data (dealer addresses), which source editing can't change; the editor should
say so.

## Every kind of site

| Kind | Typical source | Text lives in | Plan |
|---|---|---|---|
| Plain HTML in git | Claude Code static sites | `.html` files | Source mode. Or today's region mode on Cloudflare for instant publish |
| Static site generators | Astro, Eleventy, Hugo, Jekyll | `.astro`, `.md` front matter and body, templates | Source mode |
| React/Vue/Svelte SPA | Lovable, Bolt, Replit, v0 | `.tsx`/`.vue`/`.svelte`, content arrays in `.ts` | Source mode |
| Prerendered SPA | Lexar | same | Source mode |
| Server-rendered | Next.js, Nuxt, SvelteKit, Remix | same | Source mode |
| Text from a database or API | Supabase rows (common in Lovable), Shopify, dealers JSON | the data source | Phase 4: data adapters. Until then, show "this comes from data" |
| No repository | FTP/cPanel uploads, files edited on the host | files on the server | Region mode through an edge proxy, or write files over SFTP (Phase 3) |
| Already has a CMS | WordPress, Webflow, Squarespace, Wix | their CMS | Out of scope |

## How it works

Three steps for every edit: **find** where the text lives, **change** the source, **deliver** it.

### 1. Getting the editor onto any site

- **One script tag**, added by the developer or by Claude Code:
  `<script src="https://cdn.vibecms.app/v1.js" data-site="SITE_ID" async></script>`.
  For visitors it does nothing but check for an edit hand-off and exit (a few hundred bytes, no requests).
- **Sign-in without third-party cookies.** The editor signs in at the Vibe CMS app, which sends them to
  `client-site.com/#vibe=<one-time code>`. The script swaps the code for a short-lived token kept in the site's own
  storage and calls the Vibe CMS API with it (CORS). This works on any host and doesn't need the site to allow
  framing (Lexar sends `X-Frame-Options: DENY`, so an iframe-based editor would fail).
- **Freezing the page.** Today edit mode strips the site's scripts on the server. On an arbitrary host we can't, so
  the script lets the app render, then replaces the page with a copy of the rendered DOM. The copy has no event
  listeners, so React/Vue stop controlling it and the page holds still while it is edited. From there the existing
  editor (`client/editor.js` and the features) runs nearly unchanged. Links in edit mode load the next page
  normally with the hand-off token. The page list comes from `sitemap.xml`, or from crawling the site's own links.

### 2. Find: from a clicked word to a place in the source

In order, cheapest first:

1. **Text search.** The editor sends the page path, the old text, the new text and the neighbouring texts in the same
   section. The service searches the repository (via the Git provider, with a cached copy) for the old text as a
   literal, with whitespace and HTML entities normalized. One match: done.
2. **Several matches: score by neighbours.** The right file is the one that also contains the section's other
   texts. That settles most duplicates without any setup. When the same string is really shared (a "Request a
   quote" button used on every page), ask: "This text appears in 6 places. Change it everywhere, or only here?"
3. **Exact locations from a build plugin (optional, Phase 2).** `@vibecms/vite`, `@vibecms/next`, `@vibecms/astro`
   add a short `data-v` id to elements whose text comes from a literal, with a source map kept on the service (not
   shipped publicly). Removes all guessing. Developers who want zero setup skip it.
4. **AI fallback.** When nothing deterministic works (text assembled from parts, odd patterns), a Claude agent in a
   sandbox gets the repository, the page, the old and new text, makes the change, runs the build to check it, and
   returns a diff. Used rarely, shown to the editor as "this change was applied by the assistant", and limited per
   site so costs stay predictable.

Text that isn't anywhere in the source (built by code or from data) is marked in the editor as not editable here,
with a note for the developer.

### 3. Change: editing the source safely

- **Text:** a plain string replace at the exact location found, inside a JSX text node, a string literal (props,
  content arrays such as `features = [{ title: "…" }]`), Markdown, front matter or HTML. Escaping follows the file
  type (JSX `{`/`}`, quotes inside string literals, HTML entities).
- **Bold, italic, links:** change the children of the parent element when they are all literal markup (the common
  case). Otherwise AI fallback.
- **Link targets, image `src` and `alt`, page title and description:** attribute or literal edits; the page title
  and description are usually in one SEO file (Lexar: `src/seo.ts`), found by the same search.
- **Cards, list items, sections (duplicate, move, delete):** an AST edit when the siblings are literal JSX in one
  parent or items in one array, which covers most marketing pages. Otherwise AI fallback. Phase 2.
- **Images:** resized and converted to WebP in the browser as today, then committed into the repository's public
  folder (`public/`, `static/` or next to the HTML, detected per framework), so the site never depends on Vibe CMS
  for images. Very large media (video) can stay in R2 with a URL committed.
- Every change is re-read after editing (parse the file again) and the batch is rejected if a file no longer parses.

### 4. Deliver: publish = commit, the host deploys

- **Drafts** are change sets stored in the Vibe CMS database, not commits. In edit mode the editor shows them over
  the frozen page, so the editor sees their unpublished changes everywhere.
- **Publish** writes one commit per publish to the default branch, authored by the Vibe CMS app, with the editor's
  name in the message: `Content: home hero and 2 more (Vibe CMS, Jane Doe)`.
  With approval turned on (the existing review feature), publish opens a pull request instead and the approver
  merges it. Scheduled publishing merges at the set time.
- **Deploy status:** Vercel, Netlify, Cloudflare and Railway report deployments back to the commit on GitHub, so one
  integration shows "Publishing... live in about 90 seconds" and then "Live" for every host. Hosts that don't report
  get a "Deploy hook URL" field (Netlify, Vercel, Cloudflare Pages, Render all have them) or simply a timer.
- **History** is the commits Vibe CMS made. Restoring a version reverts the commit (as a new commit).
- **Developer changes** no longer conflict: the developer pulls and keeps working. If the developer changed a file
  after a draft was started, the change set is re-applied by finding the text again; if the text is gone, the
  editor sees "the developer changed this part" (today's banner, same idea).
- Setup adds a note to the site's `CLAUDE.md` / `AGENTS.md`: "Content is edited in Vibe CMS and committed to main.
  Pull before changing page text."

### Sites without git (Phase 3)

- **On Cloudflare:** today's engine, unchanged.
- **On any host:** the same engine running as an edge proxy in front of the site (DNS through Cloudflare; Cloudflare
  for SaaS custom hostnames on the Vibe CMS account), fetching pages from the real host instead of from static
  assets. Only for plain HTML pages, since it has the same React problem as today.
- **Shared hosting:** write the edited HTML files back over SFTP, the git-less version of "publish".

### The service

- Hosted and multi-tenant, built on what exists: a Cloudflare Worker with D1 and R2. New: sites, a GitHub App
  (repository access per site, chosen by the developer), change sets, deploy status, the find/change service, the
  AI fallback sandbox.
- GitLab and Bitbucket in Phase 3. Lovable, Replit and Bolt projects connect through their GitHub sync.
- Self-hosting is possible later (the developer runs the Worker on their own Cloudflare account), not first.

## How a developer adds it to a client's site

After this is built:

1. Sign up at Vibe CMS, **Add a site**, enter the domain.
2. **Connect the repository**: install the Vibe CMS GitHub App on the client's repo only.
3. **Add the script tag** to the site's main HTML template (`index.html`, the root layout in Next.js, the base
   layout in Astro). In Claude Code: "add Vibe CMS to this site" runs a skill that does steps 2 to 4 and checks the
   result. Optional: add the build plugin for exact locations.
4. **Deploy as usual.** Nothing about the hosting changes.
5. **Invite the client** from the dashboard. They get an email, sign in, and land on their own site with **Edit
   page** showing.
6. The client edits and publishes. The developer gets commits and keeps working in the same repo.

Developers with several clients see all their sites in one dashboard (an agency account), which is also the natural
billing unit.

Today, before any of this: the engine's README path (Cloudflare Workers static sites only, `vibecms init`,
`annotate` in the build, `user add`).

## Platform notes to check in Phase 0

These decide whether "commit, the host deploys" holds everywhere. Verify, don't assume:

- **Lovable:** two-way GitHub sync exists; does a commit to main republish the Lovable-hosted site, or does someone
  have to press Publish in Lovable? If the latter, Lovable-hosted sites need a different publish step.
- **Replit Deployments:** same question; Replit deploys are usually started from Replit.
- **Railway (Lexar):** deploys from GitHub `LexarInsulation/lexar-website` `main`, so commits should deploy; confirm it
  reports deployment status to GitHub.
- **Bolt, v0:** export to GitHub, then hosted on Netlify/Vercel; should be standard.

## What carries over from the current engine

| Feature | In source mode |
|---|---|
| Text, toolbar, undo, autosave | Carries over; saves become change-set entries |
| Images, media library, alt text | Carries over; uploads are committed into the repo |
| Cards, items, sections | Phase 2 (AST edits, AI fallback) |
| Page settings (title, description) | Carries over through the SEO file search |
| Menu editor | Phase 2 (nav arrays are usually literal) |
| New pages | Phase 4 (AI: "a new page like this one") |
| Site styles | Edits CSS variables or the Tailwind theme file; Phase 2 |
| Approval, preview links, scheduling | Pull requests and scheduled merges |
| Writing help, find & replace, checks before publishing | Carry over unchanged |
| Form inbox | Works as a hosted endpoint the site's forms can post to; separate from source mode |
| History | Git commits |

## Phases

**Phase 0: prove it (1 to 2 weeks).** On Lexar and on one Lovable project: script tag, sign-in hand-off, frozen
page, text search with neighbour scoring, commit through a GitHub App, deploy status. Done when changing a Lexar
heading in the browser ends with Railway deploying it, without touching Railway, and the same works on the Lovable
project. Answer the platform questions above.

Phase 0 decisions (2026-11-25):
- Starts after the current engine build (the "Vibe CMS product launch" session) is finished.
- Lexar only; Lovable comes after Phase 0 works.
- Commits go to a `vibecms-test` branch of `LexarInsulation/lexar-website`, never `main` (main deploys the live
  lexarinsulation.com). A separate Railway environment deploys that branch to its own URL.
- Repository access: a fine-grained GitHub token for that repo only (Contents read/write, Metadata read, Commit
  statuses and Deployments read), saved by Brennen as `GITHUB_TOKEN` in `C:\Users\brenn\VibeCMS\.env`. The GitHub
  App comes in Phase 1.
- Brennen, 2026-11-25: make no changes to lexarinsulation.com. Phase 0 so far ran entirely on a local copy.

### Phase 0 results (local, 2026-11-25)

Built in [source-mode/](source-mode/README.md), separate from `engine/`. Tested on a local clone of the Lexar repo in
the session scratchpad: branch `vibecms-test`, git remote removed, pushes blocked by a hook, analytics IDs blanked so
test visits never reach Lexar's Google Analytics. Served by Lexar's own `preview/server.mjs` (the server Railway runs)
on localhost:3310.

What worked, in the browser:
- Sign-in hand-off through the URL, the page frozen after React rendered it, the editor bar on desktop and phone.
- Hero paragraph: found automatically (`home.tsx:35`). Hero button "Request a Quote": in 17 places, the editor was
  asked, and the right one (`home.tsx:45`) was ranked first. Card text: found automatically (`home.tsx:85`).
- Publish made one commit per publish with a two-line diff (indentation, line endings and everything else
  untouched), the stand-in deploy rebuilt the site, the editor showed "Live", and the served prerendered HTML had the
  new text (so search engines see it too).
- A failed build showed in the editor as "Build failed", with the change still committed.

Finder accuracy on every text of every built Lexar page (`node source-mode/test/eval-site.mjs`):

| Texts | Found automatically | Editor asked | Not in the source |
|---|---|---|---|
| Marketing pages, page content (1,054) | 91% | 8% | 1% |
| Marketing pages, menus and footer (884) | 82% (37% as copies changed together) | 18% | 0% |
| Dealer state pages, page content (785) | 78% | 5% | 17% (built from dealer data) |

Lessons:
- Match whole strings first: a text node on the page is nearly always one whole JSX text or string literal.
- Read JS escapes (`\u00a0`) in code; Lexar uses them for non-breaking spaces.
- A menu label repeated in one file (desktop menu, phone menu, footer) should change together; the editor says so.
- Git Bash rewrites `/` in command arguments into a Windows path; run the service from PowerShell.
- Selecting everything and typing makes the browser replace the text node; the editor handles it.

Still to do for Phase 0: the GitHub part (`source-mode/src/repo-github.js` is written but has not run), which needs
the token and your go-ahead for the test Railway environment; deploy status from GitHub; neighbours should use the
original text of drafts already made on the page (an edited paragraph currently stops helping its neighbours);
mixed text (a paragraph with bold or a link inside) edits one piece at a time.

**Phase 1: the product for text and images.** Hosted service, dashboard, sites, editors and invites, drafts,
publish, history, images committed to the repo, page settings, the setup skill for Claude Code. GitHub only.

**Phase 2: structure and precision.** Build plugins (Vite, Next, Astro), cards, items, sections, nav, styles, the AI
fallback, approval as pull requests.

**Phase 3: everything else.** Edge proxy for plain HTML on any host, SFTP publishing, GitLab and Bitbucket.

**Phase 4: data and pages.** Adapters for content that lives in data (Supabase tables, JSON files, maybe Shopify),
new pages through the AI.

## Decisions for you

1. **Hosted service first, or a kit developers install?** Recommended: hosted. The GitHub App, AI fallback and
   deploy tracking all live on a server anyway, and it's a recurring business.
2. **Publish to main, or always through a pull request?** Recommended: main by default, pull request when approval is
   on.
3. **Images in the repo or on a Vibe CMS CDN?** Recommended: repo by default, so the client's site stands alone.
4. **Is the AI fallback included or metered?** It's the one cost that grows with use.
5. **Does today's Cloudflare region mode stay a product of its own** (instant publish, no git), or become the
   Phase 3 fallback only?

## Risks

- **Publish isn't instant.** Every publish waits for a build (30 seconds to a few minutes). Mitigation: clear progress
  in the editor; drafts already preview instantly.
- **Freezing the page can break layouts** that depend on JavaScript after load (carousels, animated reveals,
  content loaded after scroll). Mitigation: open `<details>`, force reveal classes and give the developer
  `data-cms-lock` as today; test on the five or six common Lovable templates.
- **The client's commit breaks the build.** Mitigation: re-parse every edited file before committing, and with the
  build plugin or AI sandbox, run the build first. A failed deploy shows in the editor with one-click revert.
- **Repository access is a big ask from a client.** Mitigation: the GitHub App is installed on one repository only,
  by the developer, and can only write commits that Vibe CMS made (audit list in the dashboard).
