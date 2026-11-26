# Store submissions

Everything needed to list Editlayer in three places. Copy is ready to paste; nothing here contains a secret except
`reviewer-account.local.md`, which is git-ignored.

| What | Where | File |
|---|---|---|
| Claude Code plugin | claude.ai/directory/manage | [claude-directory.md](claude-directory.md) |
| Claude connector (remote MCP) | claude.ai/directory/manage | [claude-directory.md](claude-directory.md) |
| ChatGPT plugin | platform.openai.com/plugins | [chatgpt.md](chatgpt.md), `editlayer-chatgpt.zip` |

## Ready and checked (2026-11-26)

- Connector live at `https://mcp.editlayer.co/mcp`: OAuth 2.1 with PKCE, dynamic client registration and client ID
  metadata documents; 11 tools, each with a title and explicit `readOnlyHint`, `destructiveHint` and
  `openWorldHint`. The end-to-end test (`hub/test/e2e.mjs`, 35 checks) passes against production and the demo site.
- Demo site for reviewers: https://demo.editlayer.co (Juniper Café, the `demo/` folder). Reviewer account with a
  password, admin role, no MFA, no emailed codes: see `reviewer-account.local.md`. Page edits reset every night at
  04:40 UTC.
- Privacy https://editlayer.co/privacy/, terms https://editlayer.co/terms/, support https://editlayer.co/support/,
  docs https://editlayer.co/ai/ and https://editlayer.co/developers/.
- Listing copy, 5 positive and 3 negative test cases (`chatgpt/plugin.json`), logo (`chatgpt/assets/logo.png`) and
  screenshots (`screenshots/`).

## Left for you

1. Read the privacy policy and terms (drafted by Claude) and change anything you don't agree with. Both stores
   check that the policy matches what the connector does.
2. OpenAI: verify your organization (it asks for ID), then follow [chatgpt.md](chatgpt.md). Send me the domain
   verification token it shows and I'll put it on the connector.
3. Record the demo video ([demo-video-script.md](demo-video-script.md), about 2 minutes) and upload it somewhere
   reviewers can open without signing in (an unlisted YouTube video works).
4. Submission forms end with policy acknowledgements. Those are yours to accept.
