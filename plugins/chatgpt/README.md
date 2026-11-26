# Vibe CMS for ChatGPT

ChatGPT apps are MCP servers. Every Vibe CMS site already is one: `https://<site>/_cms/mcp`
(engine/src/features/mcp.js), so a site owner can edit their site from a ChatGPT conversation today.

## Works now: per-site app (developer mode)

1. Make a key: `vibecms connect ChatGPT` (drafts only) or `vibecms connect ChatGPT --publish`, or in the editor:
   **Editors > AI assistants > Connect an assistant**.
2. ChatGPT: Settings > Apps > Advanced settings > Developer mode on > **Create app**. Name "Vibe CMS: <site>",
   MCP server URL = the printed URL, Authentication = No authentication.
3. In a chat: + > the app > "What pages does my site have?" / "Change the phone number in the footer to …".

Tools exposed: `list_pages`, `get_page`, `replace_text`, `update_region`, `set_page_settings`, `list_drafts`,
`publish`, `discard_drafts`, `get_history`. All carry MCP tool annotations (`readOnlyHint`, `destructiveHint`),
which ChatGPT uses to decide when to ask the user to confirm.

## For the ChatGPT app directory (not built yet)

A public listing is one app for every customer, so it needs a hosted hub instead of per-site URLs:

- `mcp.vibecms.<domain>`: one MCP server with **OAuth 2.1** (authorization code + PKCE, dynamic client
  registration, `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server`).
  The user signs in with their Vibe CMS account and picks which site(s) the app may edit; the hub forwards tool
  calls to that site's `/_cms/mcp` with a site key it holds.
- Same tool list, plus a `choose_site` tool when the account has several sites.
- Optional UI: an Apps SDK component (an MCP resource with `text/html+skybridge`) that shows the edited page
  region as a before/after preview with a Publish button.
- Submission needs: privacy policy and terms URLs, app icon, screenshots, test account, and a support email.

The same hub serves the Claude connectors directory (remote MCP + OAuth) and Grok, so it is built once.
