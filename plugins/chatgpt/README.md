# Editlayer for ChatGPT

ChatGPT plugins (formerly apps) are MCP servers. Editlayer has one hosted connector for every customer:

    https://mcp.editlayer.co/mcp

It is the `hub/` Worker: OAuth 2.1 (authorization code + PKCE, dynamic client registration, client ID metadata
documents, `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server`). The user types
their website's address, signs in to their own site, and an admin approves drafts only or drafts and publishing.
The hub then forwards tool calls to that site's `/_cms/mcp` with a key it stores encrypted.

## Add it today (custom MCP server)

1. chatgpt.com/plugins > **+** > **Add custom MCP server**.
2. Connection URL `https://mcp.editlayer.co/mcp`, authentication **OAuth**. Confirm the warning, then
   **Create as a plugin** and install it.
3. Sign in to your site when asked and approve. In a chat type **@Editlayer**: "What pages does my site have?" /
   "Change the phone number in the footer to …".

A single site also has its own private address, for clients without sign-in: `editlayer connect ChatGPT`
(drafts only) or `--publish`, or **Editors > AI assistants** in the editor. Add it the same way with no
authentication.

## Tools

`list_sites`, `list_pages`, `get_page`, `replace_text`, `update_region`, `set_page_settings`, `list_drafts`,
`publish`, `discard_drafts`, `get_history`, `disconnect_site`. Each site tool takes an optional `site`. Every tool
has a title and explicit `readOnlyHint`, `destructiveHint` and `openWorldHint` annotations, which ChatGPT uses to
decide when to ask the user to confirm.

## Directory submission (platform.openai.com/plugins)

Still to do, in this order:

- Verify the OpenAI organization (the owner does this; it needs ID).
- Domain check: put the token OpenAI shows in the `OPENAI_APPS_CHALLENGE` secret on the hub
  (`npx wrangler secret put OPENAI_APPS_CHALLENGE` in `hub/`); it is served at
  `/.well-known/openai-apps-challenge`.
- A demo site with a password test account (no MFA) for reviewers, 5 positive and 3 negative test cases, a demo
  video, icon and screenshots.
- Privacy https://editlayer.co/privacy/, terms https://editlayer.co/terms/, support https://editlayer.co/support/.

The same hub serves the Claude connectors directory (remote MCP + OAuth), so it is built once.
