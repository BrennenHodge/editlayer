# Editlayer connector (hub)

One public MCP server with OAuth sign-in, so ChatGPT, Claude and other assistants can list a single "Editlayer"
app while every website keeps its own data. A Cloudflare Worker with a D1 database.

How a person connects:

1. They add the connector in their assistant (or pick it in the app directory). The assistant registers itself
   (dynamic client registration, or a client ID metadata document) and opens `/authorize` with PKCE.
2. They type their website's address. The hub checks `<site>/_cms/connect/info` and sends them to
   `<site>/_cms/connect`, where they sign in to their own site as usual. Only an admin can approve, choosing
   drafts only or drafts and publishing.
3. The site redirects back to `/callback` with a one-time code. The hub swaps it, with its own PKCE verifier,
   for a connection key over a direct server-to-server call (`/_cms/connect/token`), and stores the key
   AES-GCM encrypted. They can add more websites, then return to the assistant with an authorization code.
4. Every tool call to `/mcp` is forwarded to the right site's `/_cms/mcp` with that key. The site enforces
   roles, the strict sanitizer, history and rate limits. Page content passes through and is never stored.

The tools are the site's own (`engine/src/features/mcp/tools.js`), each with an optional `site` argument, plus
`list_sites` and `disconnect_site`.

## Run locally

```
cd hub
# .dev.vars (gitignored):  HUB_KEY=<32 random bytes, base64>  ALLOW_HTTP_SITES=1
npx wrangler d1 migrations apply vibecms-hub --local
npx wrangler dev --port 8798 --ip 127.0.0.1 --local-upstream 127.0.0.1:8798   # else it answers as mcp.editlayer.co
```

A local Editlayer site on `http://127.0.0.1:<port>` accepts a connector on localhost automatically. End-to-end
test (35 checks, including the attacks the design blocks): see the header of `test/e2e.mjs`.

## Production

Live at `https://mcp.editlayer.co` (Worker `vibecms-hub`, D1 `vibecms-hub`, custom domain on the editlayer.co zone;
the workers.dev address is off so there is one public origin). `https://mcp.editlayer.co` is in `OFFICIAL_HUBS` in
`engine/src/features/connect.js`, so every Editlayer site accepts it.

- Deploy: `npx wrangler d1 migrations apply vibecms-hub --remote`, then `npx wrangler deploy`.
- `HUB_KEY` is set as a secret (32 random bytes, base64). Never reuse the local one, and never rotate it without a
  plan: it decrypts every stored site key, so a new one disconnects every site.
- For ChatGPT's domain check: `npx wrangler secret put OPENAI_APPS_CHALLENGE` with the token OpenAI shows.

## Endpoints

| Path | What |
|---|---|
| `/.well-known/oauth-protected-resource` | RFC 9728 metadata, `resource` = `<origin>/mcp` |
| `/.well-known/oauth-authorization-server` | RFC 8414 metadata (S256, DCR, CIMD, iss parameter) |
| `/register` | Dynamic client registration (public clients, https or loopback redirects) |
| `/authorize`, `/authorize/site`, `/callback`, `/authorize/finish`, `/authorize/cancel` | Sign-in pages |
| `/token` | `authorization_code` (PKCE) and `refresh_token` (rotating) |
| `/revoke` | RFC 7009 token revocation |
| `/mcp` | Streamable HTTP MCP endpoint (Bearer) |
| `/.well-known/openai-apps-challenge` | ChatGPT domain verification (from the `OPENAI_APPS_CHALLENGE` secret) |
