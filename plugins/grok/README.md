# Vibe CMS for Grok

xAI's API supports remote MCP servers as tools. Point it at a site's Vibe CMS endpoint:

```json
{
  "model": "grok-4",
  "tools": [{ "type": "mcp", "server_label": "vibecms", "server_url": "https://<site>/_cms/mcp/vcms_<key>" }],
  "input": "List the pages on my website, then fix the typo 'recieve' on the contact page."
}
```

Make the key with `vibecms connect Grok` (add `--publish` to allow publishing). The key can also go in an
`Authorization: Bearer` header instead of the URL, with the URL `https://<site>/_cms/mcp`.

The Grok consumer app doesn't take custom connectors yet. When xAI opens an app directory, the hosted OAuth hub
described in ../chatgpt/README.md is what gets listed.
