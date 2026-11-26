// AI connections: a Model Context Protocol (MCP) endpoint, so ChatGPT, Claude, Grok or any MCP client can
// read and edit this site in plain conversation ("change the opening hours on the contact page").
//
//   POST /_cms/mcp/<key>            key in the URL (for apps that only take a URL: ChatGPT, claude.ai)
//   POST /_cms/mcp                  key in "Authorization: Bearer <key>"
//
// Stateless Streamable HTTP: every POST carries one JSON-RPC message (or a batch) and gets JSON back.
// Keys are made by admins in the Editors panel ("AI assistants") or with `vibecms connect <name>`.
// What an assistant changes is saved as a draft, exactly like an editor's change: people see it in the
// editor, and nothing goes live until someone publishes (or the key has the editor role and the
// assistant is asked to publish).
//
// Security model. Whoever holds a key can do what its role allows, so keys are long random secrets stored
// only as hashes, and stop working when the admin who made them is no longer an admin. The AI on the other
// end can be steered by text it read elsewhere (prompt injection), so everything it saves goes through the
// strict sanitizer (no scripts, no new outside iframes, forms, styles or links), it can never publish
// without the editor role, every change is attributed to the connection, and each key is rate limited.
import { json, randomToken, sha256Hex, normalizePath, hasRole } from '../util.js';
import { loadForPage, saveDrafts, publish, discard, draftPaths, history, regionsIn } from '../content.js';
import { TOOLS, UNTRUSTED } from './mcp/tools.js';

export { regionsIn, TOOLS, UNTRUSTED };

const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const MAX_REGION = 60_000;
const MAX_BODY = 2 * 1024 * 1024;   // one JSON-RPC request
const MAX_BATCH = 20;               // messages in one batch
// Tool calls per key: 300 in 10 minutes, of which 120 may change something. A person chatting never gets
// near this; a runaway or hijacked agent is slowed down.
const RATE = { windowMs: 10 * 60 * 1000, calls: 300, writes: 120 };
const READ_ONLY = new Set(['list_pages', 'get_page', 'list_drafts', 'get_history']);
const fail = (status, message) => Object.assign(new Error(message), { status });

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, GET, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization, mcp-protocol-version, mcp-session-id',
  'access-control-expose-headers': 'mcp-session-id',
};

/* --------------------------------------------------------------------------------------- access keys */

async function tokenUser(env, key) {
  if (!key || key.length < 20 || key.length > 200) return null;
  // A key made in the editor works only while the admin who made it is still an admin: removing a person
  // (or taking away their admin role) also turns off every key they made. Keys from `vibecms connect`
  // (created_by 'cli') come from someone with access to the database itself.
  const row = await env.CMS_DB.prepare(
    `SELECT t.id, t.name, t.role, t.created_by FROM cms_ai_tokens t
     WHERE t.token_hash = ? AND (t.created_by = 'cli' OR EXISTS (SELECT 1 FROM cms_users u WHERE u.email = t.created_by AND u.role = 'admin'))`
  ).bind(await sha256Hex(key)).first();
  if (!row) return null;
  await env.CMS_DB.prepare('UPDATE cms_ai_tokens SET last_used = ? WHERE id = ?').bind(Date.now(), row.id).run();
  // Changes are attributed to the connection, so history shows "ChatGPT (AI)" rather than a person.
  return { id: -row.id, tokenId: row.id, email: `${row.name} (AI)`, name: `${row.name} (AI)`, role: row.role, ai: true };
}

/** Counts a tool call against the key's limit. Throws 429 when it's used up. No table (migration 0020): no limit. */
async function rateLimit(env, user, write) {
  const now = Date.now();
  let row;
  try {
    row = await env.CMS_DB.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(is_write), 0) AS w, MIN(at) AS first FROM cms_ai_usage WHERE token_id = ? AND at > ?')
      .bind(user.tokenId, now - RATE.windowMs).first();
  } catch { return; }
  if (row && (row.n >= RATE.calls || (write && row.w >= RATE.writes))) {
    const mins = Math.max(1, Math.ceil(((row.first || now) + RATE.windowMs - now) / 60000));
    throw fail(429, `This connection has made too many changes in a short time. Wait ${mins} minute${mins === 1 ? '' : 's'} and try again.`);
  }
  await env.CMS_DB.batch([
    env.CMS_DB.prepare('DELETE FROM cms_ai_usage WHERE token_id = ? AND at < ?').bind(user.tokenId, now - 24 * 3600 * 1000),
    env.CMS_DB.prepare('INSERT INTO cms_ai_usage (token_id, at, is_write) VALUES (?, ?, ?)').bind(user.tokenId, now, write ? 1 : 0),
  ]).catch(() => {});
}

export async function createToken(env, { name, role, createdBy }) {
  const key = `vcms_${randomToken(24)}`;
  await env.CMS_DB.prepare('INSERT INTO cms_ai_tokens (name, token_hash, role, created_by, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(String(name).slice(0, 60), await sha256Hex(key), role === 'editor' ? 'editor' : 'author', createdBy || null, Date.now()).run();
  return key;
}

/* ------------------------------------------------------------------------------------- page reading */

async function staticHtml(env, origin, path) {
  const res = await env.ASSETS.fetch(new Request(new URL(path, origin)));
  if (!res.ok || !(res.headers.get('content-type') || '').includes('text/html')) return null;
  return res.text();
}

const textOf = (html) => html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&rsquo;/g, '’').replace(/&quot;/g, '"')
  .replace(/\s+/g, ' ').trim();

/** The page as an editor sees it: each editable region with its current HTML (draft, else live, else the developer's). */
async function readPage(env, origin, path) {
  const src = await staticHtml(env, origin, path);
  const rows = await loadForPage(env, path, true);
  if (!src && !rows.size) throw fail(404, `There is no page at ${path}. Call list_pages to see the pages.`);
  const regions = [];
  for (const r of src ? regionsIn(src) : []) {
    const row = rows.get(r.key);
    regions.push({ key: r.key, sharedAcrossPages: r.key.startsWith('@'), state: row ? row.state : 'unedited', base: r.base, html: row ? row.html : r.html });
  }
  // Regions only in the database (pages made in the editor).
  for (const [key, row] of rows) {
    if (key.startsWith('#') || regions.some((r) => r.key === key) || key.startsWith('@')) continue;
    regions.push({ key, sharedAcrossPages: false, state: row.state, base: row.base, html: row.html });
  }
  let meta = {};
  const metaRow = rows.get('#meta');
  if (metaRow) { try { meta = JSON.parse(metaRow.html) || {}; } catch { meta = {}; } }
  if (src) {
    meta.title = meta.title || textOf(/<title>([\s\S]*?)<\/title>/i.exec(src)?.[1] || '');
    meta.description = meta.description || (/<meta\s+name="description"\s+content="([^"]*)"/i.exec(src)?.[1] || '');
  }
  return { path, meta, regions };
}

async function listPaths(env, origin) {
  let paths = [];
  try {
    const res = await env.ASSETS.fetch(new Request(new URL('/sitemap.xml', origin)));
    if (res.ok) paths = [...(await res.text()).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => { try { return normalizePath(new URL(m[1]).pathname); } catch { return null; } }).filter(Boolean);
  } catch { /* no sitemap */ }
  if (!paths.includes('/')) paths.unshift('/');
  return [...new Set(paths)];
}

/* ------------------------------------------------------------------------------------------ tools */

const pagePath = (v) => {
  let p = String(v || '/').trim();
  try { if (/^https?:/i.test(p)) p = new URL(p).pathname; } catch { /* keep */ }
  if (!p.startsWith('/')) p = `/${p}`;
  p = normalizePath(p.split(/[?#]/)[0]);
  if (!/^\/(?![/\\])[^\s<>"'`\\]*$/.test(p) || p.length > 300) throw fail(400, 'That page address isn’t valid.');
  return p;
};

function canChange(user, key) {
  if (key.startsWith('@') && !hasRole(user, 'editor')) throw fail(403, `"${key}" is shared by every page, so only a connection with the editor role can change it. Ask an admin to give this connection the editor role, or make the change in the editor.`);
}

/** Saves one region as a draft through the strict sanitizer. Returns notes on anything it removed. */
async function saveRegion(ctx, path, region, html) {
  canChange(ctx.user, region.key);
  const removed = [];
  // `region.html` is what the region holds now: embeds and form targets already in it may stay.
  await saveDrafts(ctx.env, path, { [region.key]: { html, base: region.base } }, ctx.user, {},
    { previous: async () => region.html, embedHosts: ctx.opts.embeds, removed });
  if (removed.length) console.log(`vibecms mcp: ${ctx.user.name} on ${path} ${region.key}: removed ${removed.join('; ')}`);
  return removed;
}

const removedNote = (removed) => (removed.length
  ? { removed, removedNote: 'These were taken out because AI connections can’t add them. Tell the person; an editor can add them in the editor if they are wanted.' }
  : {});

const previewUrl = (ctx, path) => `${ctx.url.origin}${path}?edit`;

const TOOL_RUN = {
  async list_pages(ctx) {
    const [paths, drafts] = await Promise.all([listPaths(ctx.env, ctx.url.origin), draftPaths(ctx.env)]);
    const set = new Set(drafts);
    for (const d of drafts) if (d !== '*' && !paths.includes(d)) paths.push(d);
    return {
      site: ctx.opts.siteName, url: ctx.url.origin, role: ctx.user.role,
      siteWideDraft: set.has('*'),
      pages: paths.map((p) => ({ path: p, url: ctx.url.origin + p, hasDraft: set.has(p) })),
    };
  },

  async get_page(ctx, a) {
    const page = await readPage(ctx.env, ctx.url.origin, pagePath(a.path));
    const text = a.format === 'text';
    return {
      path: page.path, url: ctx.url.origin + page.path, meta: page.meta,
      regions: page.regions.map((r) => ({
        key: r.key, sharedAcrossPages: r.sharedAcrossPages, state: r.state,
        ...(text ? { text: textOf(r.html).slice(0, MAX_REGION) } : { html: r.html.length > MAX_REGION ? `${r.html.slice(0, MAX_REGION)}<!-- cut: region is longer than ${MAX_REGION} characters -->` : r.html }),
      })),
      note: 'Regions with sharedAcrossPages=true (header, footer, shared sections) appear on every page that uses them.',
      security: UNTRUSTED,
    };
  },

  async replace_text(ctx, a) {
    const path = pagePath(a.path);
    const find = String(a.find ?? '');
    if (!find.trim()) throw fail(400, '"find" is empty.');
    const page = await readPage(ctx.env, ctx.url.origin, path);
    const pool = page.regions.filter((r) => (a.region ? r.key === a.region : true));
    if (a.region && !pool.length) throw fail(404, `No region "${a.region}" on ${path}. Regions: ${page.regions.map((r) => r.key).join(', ')}.`);
    // Page content first, then shared parts.
    pool.sort((x, y) => Number(x.sharedAcrossPages) - Number(y.sharedAcrossPages));
    const hits = pool.map((r) => ({ r, n: r.html.split(find).length - 1 })).filter((h) => h.n > 0);
    if (!hits.length) throw fail(404, 'That text isn’t on the page exactly as written. Call get_page and copy it character for character (the page may use HTML entities such as &amp; or curly quotes).');
    const total = hits.reduce((s, h) => s + h.n, 0);
    if (total > 1 && !a.all) throw fail(409, `That text appears ${total} times. Make "find" longer so it is unique, or set all=true.`);
    const targets = a.all ? hits : [hits[0]];
    // Check every region before saving any, so a refusal never leaves half the change behind as a draft.
    const blocked = targets.filter(({ r }) => r.key.startsWith('@') && !hasRole(ctx.user, 'editor'));
    if (blocked.length) {
      const own = targets.filter((h) => !blocked.includes(h)).map(({ r }) => r.key);
      throw fail(403, `Nothing was changed. The text is also in ${blocked.map(({ r }) => `"${r.key}"`).join(' and ')}, which every page shares, and only a connection with the editor role can change shared parts.`
        + (own.length ? ` To change it on this page only, call replace_text again with region "${own[0]}".` : '')
        + ' Otherwise tell the person to make that change in the editor, or ask an admin to give this connection the editor role.');
    }
    const replacement = String(a.replace ?? '');
    if (replacement.length > 200_000) throw fail(413, 'That is too large to save.');
    const changed = [];
    const removed = [];
    for (const { r, n } of targets) {
      for (const x of await saveRegion(ctx, path, r, r.html.split(find).join(replacement))) if (!removed.includes(x)) removed.push(x);
      changed.push({ region: r.key, replaced: n });
    }
    return { saved: 'draft', path, changed, ...removedNote(removed), reviewAt: previewUrl(ctx, path), next: 'Show the person what changed. It is a draft until published.' };
  },

  async update_region(ctx, a) {
    const path = pagePath(a.path);
    const page = await readPage(ctx.env, ctx.url.origin, path);
    const region = page.regions.find((r) => r.key === a.region);
    if (!region) throw fail(404, `No region "${a.region}" on ${path}. Regions: ${page.regions.map((r) => r.key).join(', ')}.`);
    const html = String(a.html ?? '');
    if (!html.trim()) throw fail(400, 'The new HTML is empty. To remove content, keep at least one element.');
    if (html.length > 1_000_000) throw fail(413, 'That is too large to save.');
    const removed = await saveRegion(ctx, path, region, html);
    return { saved: 'draft', path, region: region.key, removedUnsafeMarkup: removed.length > 0, ...removedNote(removed), reviewAt: previewUrl(ctx, path) };
  },

  async set_page_settings(ctx, a) {
    const path = pagePath(a.path);
    const page = await readPage(ctx.env, ctx.url.origin, path);
    const meta = { title: a.title ?? page.meta.title, description: a.description ?? page.meta.description, shareTitle: a.share_title ?? page.meta.shareTitle ?? '' };
    await saveDrafts(ctx.env, path, { '#meta': { meta } }, ctx.user);
    const warn = [];
    if (meta.title && (meta.title.length < 30 || meta.title.length > 65)) warn.push(`Title is ${meta.title.length} characters; 50–60 reads best in Google.`);
    if (meta.description && (meta.description.length < 110 || meta.description.length > 170)) warn.push(`Description is ${meta.description.length} characters; 140–160 is best.`);
    return { saved: 'draft', path, meta, warnings: warn };
  },

  async list_drafts(ctx) {
    const drafts = await draftPaths(ctx.env);
    return { drafts: drafts.map((p) => (p === '*' ? { part: 'site-wide (header, footer, shared sections, styles)' } : { path: p, review: previewUrl(ctx, p) })) };
  },

  async publish(ctx, a) {
    if (!hasRole(ctx.user, 'editor')) throw fail(403, 'This connection can save drafts but not publish. Ask the person to open the page with ?edit and press Publish, or have an admin give this connection the editor role.');
    const paths = a.all ? [...new Set([...(await draftPaths(ctx.env)), '*'])] : [pagePath(a.path), '*'];
    const n = await publish(ctx.env, paths, ctx.user);
    return { published: n, live: n ? (a.all ? ctx.url.origin : ctx.url.origin + paths[0]) : null, note: n ? 'Live now. Earlier versions can be restored from the History panel in the editor.' : 'There was nothing to publish.' };
  },

  async discard_drafts(ctx, a) {
    const path = pagePath(a.path);
    await discard(ctx.env, [path]);
    return { discarded: path };
  },

  async get_history(ctx, a) {
    const versions = await history(ctx.env, pagePath(a.path));
    return { versions: versions.map((v) => ({ at: new Date(v.at).toISOString(), by: v.by, parts: v.parts })) };
  },
};

/* ------------------------------------------------------------------------------------- JSON-RPC */

const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

async function handleMessage(ctx, msg) {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return rpcError(msg && msg.id, -32600, 'Invalid request');
  const isNotification = msg.id === undefined || msg.id === null;
  if (isNotification) return null;
  const { id, method } = msg;
  const params = msg.params && typeof msg.params === 'object' ? msg.params : {};
  switch (method) {
    case 'initialize': {
      const asked = params.protocolVersion;
      return {
        jsonrpc: '2.0', id,
        result: {
          protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'vibecms', title: `Vibe CMS: ${ctx.opts.siteName}`, version: '0.2.0' },
          instructions: `You are connected to the website "${ctx.opts.siteName}" (${ctx.url.origin}) through Vibe CMS. `
            + 'Call list_pages, then get_page before editing. Prefer replace_text for small changes; keep the site\'s existing HTML structure and classes. '
            + 'Every change is a draft until published; tell the person, link the review address, and ask before calling publish. '
            + UNTRUSTED,
        },
      };
    }
    case 'ping': return { jsonrpc: '2.0', id, result: {} };
    case 'tools/list': return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
    case 'tools/call': {
      const run = Object.hasOwn(TOOL_RUN, params.name) ? TOOL_RUN[params.name] : null;
      if (!run) return rpcError(id, -32602, `Unknown tool: ${String(params.name).slice(0, 60)}`);
      const args = params.arguments && typeof params.arguments === 'object' && !Array.isArray(params.arguments) ? params.arguments : {};
      try {
        await rateLimit(ctx.env, ctx.user, !READ_ONLY.has(params.name));
        const data = await run(ctx, args);
        return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data } };
      } catch (e) {
        if (!e || !e.status) console.error('vibecms mcp tool failed', e && e.stack || e);
        return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: e && e.status ? e.message : 'Something went wrong on the website. Try again.' }], isError: true } };
      }
    }
    case 'resources/list': return { jsonrpc: '2.0', id, result: { resources: [] } };
    case 'prompts/list': return { jsonrpc: '2.0', id, result: { prompts: [] } };
    default: return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

async function mcpRoute(rctx) {
  const { request, env, url, opts, params } = rctx;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const auth = request.headers.get('authorization') || '';
  const key = params[0] || (/^Bearer\s+(\S+)$/i.exec(auth)?.[1]) || '';
  const user = await tokenUser(env, key);
  if (!user) {
    return json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'This AI connection key is missing or was turned off. An admin can make a new one in the editor: Editors > AI assistants.' } }, 401,
      { ...CORS, 'www-authenticate': 'Bearer realm="vibecms"' });
  }
  if (request.method === 'GET') {
    // No server-to-client stream: this server only answers requests.
    return new Response('This is a Vibe CMS MCP endpoint. Add its URL to ChatGPT, Claude or another MCP client.', { status: 405, headers: { ...CORS, allow: 'POST, OPTIONS', 'content-type': 'text/plain; charset=utf-8' } });
  }
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: CORS });
  let body;
  if (Number(request.headers.get('content-length') || 0) > MAX_BODY) return json(rpcError(null, -32600, 'Request too large'), 413, CORS);
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) return json(rpcError(null, -32600, 'Request too large'), 413, CORS);
    body = JSON.parse(text);
  } catch { return json(rpcError(null, -32700, 'Parse error'), 400, CORS); }
  const ctx = { env, url, opts, user };
  if (Array.isArray(body)) {
    if (body.length > MAX_BATCH) return json(rpcError(null, -32600, `Send at most ${MAX_BATCH} messages at once`), 400, CORS);
    // One after another, so a batch can't run many changes against the database at the same moment.
    const out = [];
    for (const m of body) { const r = await handleMessage(ctx, m); if (r) out.push(r); }
    return out.length ? json(out, 200, CORS) : new Response(null, { status: 202, headers: CORS });
  }
  const out = await handleMessage(ctx, body);
  return out ? json(out, 200, CORS) : new Response(null, { status: 202, headers: CORS });
}

/* --------------------------------------------------------------------------------- feature */

export default {
  name: 'mcp',
  routes: [{ path: /^\/_cms\/mcp(?:\/(vcms_[A-Za-z0-9_-]{20,}))?\/?$/, handler: mcpRoute }],
  api: [
    {
      method: 'GET', route: 'ai-tokens', role: 'admin',
      handler: async (ctx) => {
        const { results } = await ctx.env.CMS_DB.prepare('SELECT id, name, role, created_by, created_at, last_used FROM cms_ai_tokens ORDER BY created_at DESC').all();
        return json({ tokens: results, endpoint: `${ctx.url.origin}/_cms/mcp` });
      },
    },
    {
      method: 'POST', route: 'ai-tokens', role: 'admin',
      handler: async (ctx) => {
        const name = String(ctx.body.name || '').trim().slice(0, 60);
        if (!name) throw fail(400, 'Give the connection a name, such as "ChatGPT".');
        const key = await createToken(ctx.env, { name, role: ctx.body.role, createdBy: ctx.user.email });
        return json({ key, url: `${ctx.url.origin}/_cms/mcp/${key}` });
      },
    },
    {
      method: 'DELETE', route: 'ai-tokens', role: 'admin',
      handler: async (ctx) => {
        await ctx.env.CMS_DB.prepare('DELETE FROM cms_ai_tokens WHERE id = ?').bind(Number(ctx.body.id)).run();
        return json({ ok: true });
      },
    },
  ],
  render: (ctx) => {
    if (ctx.editing && hasRole(ctx.user, 'admin')) ctx.share({ enabled: true });
  },
};
