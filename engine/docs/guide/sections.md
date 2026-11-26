### Whole-section tools (feature: `sections`)

Every section of a page has a bar at its top-right corner. On a phone it appears when you tap something in the section. Besides move, duplicate, hide, add and delete, the bar now has:

| On the section bar | What it does |
|---|---|
| Grip handle (first button) | Drag the section up or down. A "Move here" line shows where it will land, and the page scrolls when you drag near the top or bottom edge. Esc cancels. One Ctrl+Z puts it back. Works with a mouse or a finger. |
| + Add a section | Opens **Add a section** with three tabs. **Ready-made**: blocks designed for the site, each with a live preview. **Shared**: sections that are edited once and used on many pages. **From a page**: copy any section from any page. The new section goes below the one you picked. |
| Gear: Section settings | **Background**: the site's own choices, or **Photo**, which adds a dark tint so text stays readable; pick which part of the photo stays in view. **Spacing**: Compact, Normal or Roomy. **Alignment**: Left or Centre. **Image side**: Left or Right, for two-column sections with a picture; on phones the left column shows first. **Show on**: All devices, Phones only, or Larger screens only. Editors still see every section while editing; device-limited ones get a dashed outline and a label on the bar. |
| Share this section (in Settings) | Turns the section into a **shared section** with a name, for example "Contact band". Edits to its words, pictures and settings then appear on every page that uses it. When you share, Editlayer finds identical copies on other pages and offers to link them; those pages get a draft, and you can publish them all at once. The bar reads "Shared section · <name>". In Settings you can **Rename** it or **Stop sharing** (this page keeps its own copy). Duplicating a shared section makes a normal copy. Deleting it removes it from this page only. |

All changes are drafts until published, and work with undo and History like any other edit.

**Site setup**
- Options in `createCms({ sections: { … } })`:
  - `backgrounds: [{ label, class }]`: the site's own background classes. Use `class: ""` for the plain one. Without it, editors see "As designed" and "Photo".
  - `photoClass`: class(es) added with a photo background so text turns light, for example `"dark"`. Without it, a small built-in rule makes the text white.
- Ready-made blocks come from `/editlayer-blocks.html` in the site root. Every top-level child of its `<main>` that has `data-block="Name"` (and optionally `data-block-note="What it's for"`) is one block. Build it with the site's normal head and CSS so blocks look right. Use placeholder prompts, never invented facts. Visitors get the site's 404 page there; only signed-in editors can open it. Keep it out of the sitemap. The Worker also removes it from `/sitemap.xml` as a safety net.

**How it works**
- Settings are attributes or classes on the section element (`data-cms-space`, `data-cms-align`, `data-cms-show`, `data-cms-bg` + `data-cms-focus`), saved with the page. Visitors get a small style block only on pages whose served HTML uses them. Photo backgrounds are rebuilt by the Worker from checked attributes: same-site image paths only.
- A shared section is `data-cms="@s-<id>"` inside the page region, stored site-wide (path `*`). The page keeps the element as a fallback copy, and the Worker swaps in the stored version when it serves the page. Names and the section's own settings live in the `@sections` data key. `GET /_cms/api/sections` (any signed-in user) lists shared sections with the pages that use them.
