### Writing help and find & replace (feature `writing`)

**What editors can do**

| On the page | How |
|---|---|
| Fix or improve a piece of text | Click into the text, then press **Rewrite** in the toolbar (the sparkle icon on phones). Pick **Fix spelling and grammar**, **Make it shorter**, **Make it clearer**, **Make it friendlier** or **Make it more formal**. The suggestion appears first. Press **Use it** to replace the text, **Try again** for another version, or **Other options**. Ctrl+Z undoes it in one step. |
| Rewrite only some words | Select the words first, then press Rewrite. Only those words change. A selection that cuts into a word takes the whole word. Text with links or bold words can only be rewritten a selection at a time, so the links and bold are kept. The editor explains this if you try. |
| Find and replace across the whole site | **Find** (magnifier) in the bottom bar. Type the words, type the replacement, tick the options if you need them (match capital letters exactly, whole words only, include page titles and descriptions), then **Find on all pages**. Results are grouped by page, with a count and a short highlighted snippet of each match. The footer and other site-wide parts are listed once. Untick any page you want to leave alone, then **Replace**. |
| After replacing | Every change is saved as a draft, so visitors see nothing yet. The panel lists what changed on each page (with **Open** to check a page) and offers **Publish all pages**, **Undo replace** (puts everything back wherever nobody has edited it since) and **New search**. On the page you're on, Ctrl+Z also works. |

Notes for editors: without "Match capital letters exactly", capitals follow each match ("Bakery" → "Café", "bakery" → "café"). Leaving "Replace with" empty deletes the matches, after a confirmation. Writing help keeps facts, names and numbers. If the numbers, an email address or a web address in a suggestion differ from your text, it says so. Always read the suggestion before using it.

**Site setup**

1. Find and replace needs nothing extra.
2. Writing help needs the Workers AI binding in `wrangler.jsonc`:
   ```jsonc
   "ai": { "binding": "CMS_AI" }
   ```
   Without it the Rewrite button is hidden and the API answers "Writing help isn't set up on this site." Workers AI usage is billed to the Cloudflare account. `wrangler dev` also calls the real service when the binding is present, so local dev needs `wrangler login`.
3. Apply the migration `0017_writing.sql` (table `cms_writing_usage`, used for the hourly limit): `npx wrangler d1 migrations apply <worker>-cms --remote`.

**Options** (`createCms({ writing: { ... } })`)

| Option | Default | Meaning |
|---|---|---|
| `model` | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | Workers AI text model (`@cf/...`) |
| `perHour` | `60` | Rewrites per editor per hour (1–1000) |
| `maxChars` | `2000` | Longest text that can be rewritten at once (100–4000) |

**How it works**

- `POST /_cms/api/writing/rewrite {text, mode, again?, context: {kind, page}}` needs at least the author role and the usual `x-vibecms` header and same-origin check. It validates the option and the text length, applies the hourly limit, then calls the model. It returns `{text, changed, warnings}`. The suggestion is put into the page as plain text through `core.mutate`, never as HTML.
- Find and replace runs in the editor. The current page is searched and changed in the live page, through `core.mutate` and the page-settings draft key `#meta`. Other pages are loaded as `path?edit` (so drafts are included and hidden sections are kept) and saved with the normal `PUT draft {path, regions: {key: {html, base}}}`. Only text inside `[data-cms]` regions is searched. Text inside `[data-cms-lock]`, scripts, styles, textareas and SVG is skipped, as are HTML attributes. Site-wide regions (`@footer`, shared sections) are changed once.
