# Writing an Editlayer feature

Everything beyond core editing (text, images, items, sections, drafts, publish, history, editors) is a
feature: a pair of files that plug into the editor and the Worker without editing core files.

```
client/features/<name>.js        editor code (runs inside the editor's closure)
client/features/<name>.ui.css    optional: styles for the editor UI (inside the shadow root)
client/features/<name>.page.css  optional: styles applied to the page itself while editing
src/features/<name>.js           optional: Worker code
migrations/<NNNN>_<name>.sql     optional: new tables (never edit an applied migration)
```

`node scripts/build-client.mjs` concatenates the client files into `editor.js`/`editor.css` (embedded in
`src/client-assets.js`) and regenerates `src/features/index.js`, which imports every Worker feature.
A feature that throws while starting is logged and skipped; the rest of the editor keeps working.

## Editor side

```js
feature('styles', (core) => {
  core.addBarButton({ id: 'styles', icon: 'palette', title: 'Site styles', panel: 'styles' });
  core.addPanel('styles', () => { const pb = core.openPanel('Site styles', '…'); /* … */ });
});
```

The function runs once, after the editor UI exists and before the first draw. `core` has:

| Area | Members |
|---|---|
| State | `S` (server state: `path`, `user {email,name,role}`, `site`, `regions`, `hasDraft`, `meta`, `features[name]` = whatever the Worker feature `share()`d), `d` (document), `R` (UI elements in the shadow root: `bar`, `panel`, `pop`, `scrim`, `toast`, `sbar`, `tbar`, `sel`, `hover`, `sec`, `tag`, `banner`), `root` (shadow root), `host` |
| Helpers | `esc(s)`, `icon(name)`, `addIcons({name: '<path …/>'})` (24×24 stroke icons), `btn(icon, title, act, cls)`, `api(method, route, body)` (→ `/_cms/api/<route>`, JSON or FormData, throws `Error(message)`), `toast(msg, isError)`, `when(ms)` (short date), `val(v, ...args)` (call if function) |
| Events | `on(event, fn)` returns an unsubscribe, `emit(event, ...args)`. Core events: `ready`, `saved {keys, extras}`, `published {all, count}`, `bar (barEl)`, `sbar (barEl, section)`, `pop:link (formEl, {el, link})`, `panel:pages (pb, pages)`, `panel:settings (pb)`, `panel:history (pb, versions)`, `panel:users (pb, {users, link})`, `section:label (section)` → return a string to rename the section bar label |
| Structure | `keyOf(region)`, `regionOf(node)` (innermost `[data-cms]`), `regionByKey(key)`, `pageRegionOf(node)` (the page region, skipping nested site-wide regions such as shared sections), `isGlobal(region)` (key starts with `@`), `locked(el)`, `sectionFor(node)`, `itemFor(el)`, `textBlockFor(node)`, `classify(node)`, `label(target)`, `isRich(el)`, `linkOf(el)` |
| Changing the page | `mutate(region, fn)`: run `fn`, and if the region's HTML changed record one undo step and autosave. Always change region content through `mutate` (or `markDirty` after typing). `markDirty(region)`, `regionHtml(region)` (clean HTML as saved), `stripJunk(node)`, `notePageTags(node)` (call on inserted HTML that has custom elements), `openDetails()` |
| Data keys | `setExtra(key, payload)` saves a feature data key (for example `@theme`) with the next autosave as `regions[key] = payload`; the Worker feature's `keys[key]` serializer validates it |
| Editing state | `sel` / `editing` / `status` / `dirty` (getters), `select(target)`, `startEdit(el, evt)`, `finishEdit()`, `save()`, `setStatus(s)`, `queueDraw()`, `publishNow({all, skipChecks})` |
| UI | `openPanel(title, bodyHtml)` → panel body element, `closePanel()`, `togglePanel(name)`, `addPanel(name, fn)`, `showPop(anchorEl, formHtml, onSubmit(formData, submitterValue))`, `closePop()`, `positionBar(el, rect, 'above'|'inside')`, `modal({title, body, foot, onClose})` → `{el, close}`, `pickImage({current, alt, maxW, title, withAlt})` → `Promise<{url,w,h,alt}|null>`, `openImage(img)`, `sitePages()` → `[{path, draft}]`, `clearPagesCache()` |
| Extending | `addClassifier(node => target|null)` (checked before the built-in image/text/item rules; a target is `{type, el, label?}`), `addToolAction({act, icon, text?, title, when(sel, {item, editing}), run(sel, {item, region, el}), order})` (element toolbar), `addSectionAction({act, icon, title, when(section), run(section, region), order, sep, cls, html?})` (section bar; built-ins: `sec-up` 20, `sec-down` 30, `sec-dup` 40, `sec-hide` 50, `sec-add` 60, `sec-del` 90 — passing an existing `act` replaces its fields, e.g. `run`), `addBarButton({id, icon, title, panel? or run?, adminOnly, when, order})` (one button per feature, please: the bar must fit a phone), `setPublishButton({text, title, icon, run})`, `beforePublish(async ({all}) => false to stop)`, `redrawSectionBar()`, `redrawToolbar()` |

UI conventions (see `client/ui.css`): panels use `.pb` content with `<p>`, `.field` (label + input),
`.row.end` button rows, `.btn`, `.btn.primary`, `.btn.danger`, `.ib` icon buttons, `.list > li` with
`.grow > b + span`, `.pill`, `.note`, `.muted`, `.h3`. The accent colour is `var(--a)`, text on it
`var(--on-a)`. Write for non-technical staff: plain words, no jargon, say what happens and how to undo.

## Worker side

```js
export default {
  name: 'forms',
  keys: { '@theme': (value, { env, path, user }) => JSON.stringify(clean(value)) },  // data draft keys
  api: [{ method: 'GET', route: 'submissions', role: 'editor', handler: async (ctx) => json({…}) }],
  routes: [{ method: 'POST', path: /^\/_cms\/form\/([a-z0-9-]+)$/, handler: async (ctx) => … }],
  assets: { '/sitemap.xml': async (ctx, res) => res },  // transform a static file's response
  source: async (ctx) => null,       // HTML Response for ctx.path when there's no static page
  pages: async ({ env }) => [],      // extra paths for the editor's page list
  render: (ctx) => {},               // add HTML rewriting while a page is served
  scheduled: async ({ env, opts }) => {},  // runs on the Worker's cron trigger
  alwaysRender: false,               // true if render() must run even on untouched pages
};
```

- **api**: matched against the path after `/_cms/api/`. `route` is a string or a RegExp (groups in
  `ctx.params`). `role` is the minimum role: `author` < `editor` < `admin` (default `editor`). The
  session, the `x-editlayer: 1` header and the same-origin check are already enforced. `raw: true` skips
  JSON body parsing (file uploads). ctx: `{request, env, url, opts, user, body, params, pagePath(v), renderPath(path, mode)}`.
  Throw an error with a `status` property to return `{error}` with that status.
- **routes**: any other `/_cms/...` URL (public form posts, share-preview links). No session check:
  call `await ctx.getUser()`. ctx: `{request, env, url, opts, params, sameOrigin, getUser, renderPath, waitUntil}`.
  `renderPath(path, { drafts: true })` renders any page with drafts applied (no session needed).
- **render(ctx)**: ctx `{env, url, opts, user, path, rows (Map key→row), editing, preview, request,
  on(selector, handlers), onAfter(selector, handlers), head(html), bodyEnd(html), share(data)}`. `on`
  adds HTMLRewriter handlers to the pass that swaps edited regions in; `onAfter` runs on its output
  (use it to touch content inside swapped-in regions). `share(data)` puts data in `S.features[name]`
  for the editor (edit mode only). Pages nobody edited skip rendering entirely unless a feature sets
  `alwaysRender` (costs a little on every page view; avoid if you can).
- **keys**: feature data stored like regions (draft → publish → history). Keys starting with `@` are
  site-wide (stored under path `*`, published with any page). Return the string to store; throw to
  reject. Rows are in `ctx.rows` at render time with `row.html` = that string.
- **source**: called only when the static file is missing (404). Return a 200 HTML Response to serve
  a page the CMS made; it is then rendered like any other page.
- Bindings: `env.CMS_DB` (D1), `env.CMS_MEDIA` (R2), `env.ASSETS`. Optional bindings a feature uses
  (`env.CMS_AI`, `env.RESEND_API_KEY` …) must be optional: degrade gracefully when absent.
- Helpers: `import { json, randomToken, sha256Hex, normalizePath, escapeHtml } from '../util.js'`,
  `import { getUser } from '../auth.js'`, `import { saveDrafts, publish, loadForPage, draftPaths } from '../content.js'`,
  `import { sanitize } from '../sanitize.js'`, `import { hasRole, ROLE_LEVEL } from '../util.js'`. Never import `../worker.js` or
  `../render.js` from a feature (circular import).

## Site options

`createCms({ siteName, accent, ... })` options reach features as `ctx.opts`. Name a feature's options
after the feature (`opts.styles`, `opts.forms`, `opts.sections`, …) and document them in the README.
