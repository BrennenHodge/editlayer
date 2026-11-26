---
name: connect-ai
description: Connect ChatGPT, Claude (claude.ai or Claude Code) or Grok to an Editlayer website so the owner can edit pages by asking ("change the hours on the contact page"). Use when the user wants an AI assistant, ChatGPT app, Claude connector, Grok tool or MCP server for their Editlayer site.
argument-hint: "<assistant name> [--publish]"
---

# Connect an AI assistant to an Editlayer site

Each Editlayer site serves an MCP server (Streamable HTTP, stateless) at `https://<site>/_cms/mcp`. A connection key
decides what the assistant may do:

- default (author role): read pages and save **drafts**; a person publishes from the editor.
- `--publish` (editor role): it may also publish when asked. Shared parts (header, footer) need this role.

Tools: `list_pages`, `get_page`, `replace_text`, `update_region`, `set_page_settings`, `list_drafts`, `publish`,
`discard_drafts`, `get_history`.

## Make the key

From the site folder (`$ARGUMENTS` is the assistant's name, e.g. ChatGPT):

```
node "${CLAUDE_PLUGIN_ROOT}/engine/cli/editlayer.mjs" connect $ARGUMENTS
```

It prints a private URL with the key in it (`/_cms/mcp/vcms_…`). It is shown once and works like a password: don't
paste it into files that get committed. `connect list` shows connections, `connect remove <name>` turns one off.
Admins can do the same in the editor: **Editors > AI assistants**.

## Add it to the assistant

- **ChatGPT and Claude, easiest**: no key needed. Add the Editlayer connector, `https://mcp.editlayer.co/mcp`, and sign in to the site
  when asked (an admin approves drafts only, or drafts and publishing). ChatGPT: chatgpt.com/plugins > + > Add
  custom MCP server, paste the address, OAuth; then type @Editlayer in a chat. Claude: Settings > Connectors > Add
  custom connector.
- **ChatGPT with a private URL**: chatgpt.com/plugins > + > Add custom MCP server, paste the URL, no authentication.
- **Claude (claude.ai / desktop)**: Settings > Connectors > Add custom connector, paste the URL.
- **Claude Code**: `claude mcp add --transport http <site-name> <url>`
- **Grok**: through the xAI API as a remote MCP tool (`server_url` = the URL). Grok's consumer app has no custom
  connectors yet.
- Any other MCP client: Streamable HTTP, or POST JSON-RPC with `Authorization: Bearer <key>` to `/_cms/mcp`.

Test it right away: ask the assistant to list the site's pages.
