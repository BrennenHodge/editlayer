// Serves the sandbox copy of a site with its own server, for local testing.
//   node scripts/sandbox-site.mjs <repo dir> <port>
// Lexar: runs preview/server.mjs (the same server Railway runs) from the repository root.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [, , dir, port = '3310'] = process.argv;
process.chdir(path.resolve(dir));
process.env.PORT = port;
process.env.SITE_NOINDEX = '1';
await import(pathToFileURL(path.join(process.cwd(), 'preview', 'server.mjs')).href);
