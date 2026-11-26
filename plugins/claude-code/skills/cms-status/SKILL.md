---
name: cms-status
description: Show what editors have changed on an Editlayer site (drafts, published edits, and edits whose page the developer has since rebuilt). Run before rebuilding or redesigning pages of a site that uses Editlayer, so editors' work isn't lost or shadowed.
---

# What editors changed

From the site folder:

```
node "${CLAUDE_PLUGIN_ROOT}/engine/cli/editlayer.mjs" status
```

Each line: state (draft/live), page, region, when, who, and "source changed since this was edited" when the built
page's region no longer matches the version the editor started from.

Before changing a region that has live edits, tell the user: the editor's version keeps showing until someone picks
"use the developer's version" in the editor's banner. To fold editors' text back into the source, read it with the
site's MCP endpoint (`get_page`, see the connect-ai skill) or from the live page, and edit the source to match.
