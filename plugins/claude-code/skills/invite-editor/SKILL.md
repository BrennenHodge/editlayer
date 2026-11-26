---
name: invite-editor
description: Create an Editlayer editor account for someone and get their one-time invite link, or a new link for an existing editor (also how a forgotten password is reset). Use when the user says invite, add an editor, give my client access, reset a CMS password.
argument-hint: "<email> [--name \"Name\"] [--admin]"
---

# Invite someone to edit an Editlayer site

From the site folder:

```
node "${CLAUDE_PLUGIN_ROOT}/engine/cli/editlayer.mjs" user add $ARGUMENTS
```

- `--admin` lets them invite others; without it they are an editor (edits and publishes).
- Authors (edit, then send for review) are invited from the editor's **Editors** panel.
- `user link <email>` makes a new link for an existing editor (resets their password); `user list`,
  `user remove <email>`. Add `--local` for the `wrangler dev` database.

The link works once, for 7 days. Give it to the user to send; don't email it yourself unless asked.
