# Security tests

Run these before releasing an engine change. Never point them at a live site: they create and delete content.

## 1. End-to-end (`integration.mjs`, 41 checks)

Roles, CSRF, size limits, the strict sanitizer for authors and AI connections, MCP keys, rate limits, upload
checks and security headers, against a real Worker.

1. Make a throwaway copy of a site that uses Vibe CMS, with this engine in `_vibecms/` and a `cms.worker.js` like:
   `createCms({ siteName: 'Security test', login: 'password', forms: {}, embeds: ['calendly.com'] })`.
   Its home page needs regions `main` and `@footer`. Give it its own D1 database name in `wrangler.jsonc`.
2. `npx wrangler d1 migrations apply <db> --local`
3. `node <this folder>/seed.mjs > seed.sql` and `npx wrangler d1 execute <db> --local --file seed.sql`
4. `npx wrangler dev --port 8797`, then `node integration.mjs` (or `BASE=http://localhost:NNNN node integration.mjs`).

Re-run step 3 before each run: the tests use up the invite links and change roles.

## 2. Sanitizer against XSS payloads (`payloads.mjs`, 53 payloads)

Classic XSS plus parser-confusion ("mutation XSS") payloads, run through the real Workers HTML parser, then loaded in
a real browser to see whether any script fires.

```
node payloads.mjs                                                     # writes payloads.json
node sanitize-run.mjs <miniflare package dir> ../../src payloads.json  # writes payloads.out.json
node browser-bench.cjs payloads.out.json                               # must print FIRED: []
```

`sanitize-run.mjs` takes an optional fourth argument, sanitizer options as JSON, for example
`'{"strict":true,"report":true}'`. `browser-bench.cjs` needs Playwright (`PLAYWRIGHT=<path to playwright>` if it isn't
installed here) and uses Microsoft Edge. Running it on `payloads.json` itself shows how many fire unsanitized (18).
