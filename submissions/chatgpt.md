# ChatGPT plugin (platform.openai.com/plugins)

The package is `editlayer-chatgpt.zip`, built from `chatgpt/` (plugin.json, mcp.json, assets/logo.png). It carries
the listing copy, the 5 positive and 3 negative test cases, category Productivity and the release notes. Rebuild
it after editing `chatgpt/` (not with Compress-Archive, which writes backslashes into the ZIP's paths):

```
python -c "import os,zipfile;s='submissions/chatgpt';z=zipfile.ZipFile('submissions/editlayer-chatgpt.zip','w',zipfile.ZIP_DEFLATED);[z.write(os.path.join(d,f),os.path.relpath(os.path.join(d,f),s).replace(os.sep,'/')) for d,_,fs in os.walk(s) for f in fs];z.close()"
```

## Steps

1. **Verify the organization** (Settings > Organization > Verification). Only an owner, or someone with
   "Apps Management Write", can submit. The directory shows the verified developer name; `developerName` in the
   package is "dbVantage".
2. **Upload:** Plugins > Upload new or existing plugin > choose the developer identity > Upload plugin >
   `editlayer-chatgpt.zip`. Fix anything the Metadata & Skills tab flags.
3. **Connect the MCP server** (MCPs tab > Connect): URL `https://mcp.editlayer.co/mcp`, authentication OAuth.
   There's no client secret: the connector uses dynamic client registration (public clients with PKCE).
4. **Domain verification:** OpenAI shows a token. Send it to me (or run
   `npx wrangler secret put OPENAI_APPS_CHALLENGE` in `hub/` and paste it). It's served at
   `https://mcp.editlayer.co/.well-known/openai-apps-challenge`. Then run the scan.
5. **Review details** (Metadata & Skills > Review information > Review details): paste from
   `reviewer-account.local.md`, plus these instructions:

   > Editlayer edits websites that use it. Use the demo website demo.editlayer.co (a fictional café). When the
   > plugin asks which website, type demo.editlayer.co and press Continue. Sign in with the email and password
   > above (no MFA or emailed codes). Choose "Save drafts and publish" so every test case works (test case 5
   > publishes), then Allow. Run the test cases in order. Page edits on the demo reset every night at 04:40 UTC.

6. **Demo video:** add its URL in the review section (`demo_recording_url`). See `demo-video-script.md`.
7. **Run the test cases yourself** with the test account before submitting; OpenAI rejects submissions whose
   results don't match the expected behavior.
8. **Submit for review** and accept the attestations. After approval, press Publish (it doesn't list
   automatically).

## Notes

- Screenshots for the listing, if the dashboard asks: `screenshots/` (desktop and phone).
- `commerce` is false. No prices, plans or upgrades are mentioned in the listing.
- Changing the connector's tools later doesn't need a new ZIP: OpenAI rescans the server daily. Changing the
  address (scheme, host or port) would need a new plugin, which is why it lives on its own domain.
