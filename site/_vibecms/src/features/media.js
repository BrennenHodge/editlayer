// Documents, video, focal points and background images: the Worker side.
//
// - POST /_cms/api/files      upload a document (PDF, Word, Excel, PowerPoint, text, CSV; 25 MB max)
// - GET  /_cms/api/files      the uploaded documents, newest first (for "Choose a file")
// - GET  /_cms/api/video-title?url=…   a YouTube or Vimeo video's title (for the embed's title)
// - GET  /_cms/files/<id>/<name>       serves a document (public)
//
// Videos, focal points and backgrounds change the page HTML in the editor, so they are saved,
// published and kept in history like any other edit. Nothing here runs on page views.
import { json } from '../util.js';
import { FILE_TYPES, MAX_FILE_BYTES, extOf, safeName, checkContents, NAME_RE, ID_RE } from './media/files.js';
import { parseVideo, videoTitle } from './media/video.js';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });

function newId() {
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return [...crypto.getRandomValues(new Uint8Array(10))].map((b) => abc[b % 36]).join('');
}

const fileUrl = (id, name) => `/_cms/files/${id}/${name}`;

async function upload(ctx) {
  const { request, env, user } = ctx;
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > MAX_FILE_BYTES + 64 * 1024) throw fail('Files must be 25 MB or smaller.', 413);
  let form;
  try { form = await request.formData(); } catch { throw fail('No file received.'); }
  const file = form.get('file');
  if (!file || typeof file === 'string') throw fail('No file received.');
  // Browsers send " CR LF in file names as %22 %0D %0A (multipart encoding): turn them back.
  const original = String(file.name || form.get('name') || '').replace(/%22/g, '"').replace(/%0[ad]/gi, ' ').slice(0, 200);
  const ext = extOf(original);
  if (!FILE_TYPES[ext]) throw fail('Use a PDF, Word (.docx), Excel (.xlsx), PowerPoint (.pptx), text (.txt) or CSV file.', 415);
  if (file.size > MAX_FILE_BYTES) throw fail('Files must be 25 MB or smaller.', 413);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const problem = checkContents(ext, bytes);
  if (problem) throw fail(problem, 415);

  const spec = FILE_TYPES[ext];
  const id = newId();
  const name = safeName(original, ext);
  await env.CMS_MEDIA.put(`files/${id}/${name}`, bytes, {
    httpMetadata: {
      contentType: spec.type,
      contentDisposition: `${spec.inline ? 'inline' : 'attachment'}; filename="${name}"`,
      cacheControl: 'public, max-age=31536000, immutable',
    },
  });
  const title = original.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 160) || name;
  const now = Date.now();
  try {
    await env.CMS_DB.prepare('INSERT INTO cms_files (id, name, title, ext, type, size, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, name, title, ext, spec.type, bytes.length, now, user.email).run();
  } catch (err) {
    console.error('vibecms media: saving the file record failed (is migration 0015 applied?)', err);
    await env.CMS_MEDIA.delete(`files/${id}/${name}`).catch(() => {});
    throw fail('Files can’t be uploaded yet. Ask your developer to update the site.', 503);
  }
  return json({ file: { id, url: fileUrl(id, name), name: title, ext, kind: spec.label, size: bytes.length, at: now, by: user.name || user.email } });
}

async function list({ env }) {
  let results = [];
  try {
    ({ results } = await env.CMS_DB.prepare('SELECT id, name, title, ext, size, created_at, created_by FROM cms_files ORDER BY created_at DESC LIMIT 500').all());
  } catch (err) {
    console.error('vibecms media: file list failed (is migration 0015 applied?)', err);
    throw fail('The file list isn’t available yet. Ask your developer to update the site.', 503);
  }
  return json({
    files: results.map((r) => ({
      id: r.id, url: fileUrl(r.id, r.name), name: r.title || r.name, ext: r.ext,
      kind: FILE_TYPES[r.ext]?.label || r.ext.toUpperCase(), size: r.size, at: r.created_at, by: r.created_by,
    })),
  });
}

async function serve(ctx) {
  const { request, env, params } = ctx;
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
  const id = params[0];
  let name;
  try { name = decodeURIComponent(params[1]); } catch { name = ''; }
  const notFound = () => new Response('This file isn’t available.', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
  if (!ID_RE.test(id)) return notFound();
  if (!NAME_RE.test(name)) name = '';
  const key = `files/${id}/${name}`;
  let range = request.method === 'GET' ? parseRange(request.headers.get('range')) : null;
  if (range && name) {
    const info = await env.CMS_MEDIA.head(key);
    if (info && 'offset' in range && range.offset >= info.size) {
      return new Response(null, { status: 416, headers: { 'content-range': `bytes */${info.size}` } });
    }
    if (info && 'suffix' in range && (range.suffix === 0 || range.suffix >= info.size)) range = null;
    if (info && range && range.length && range.offset + range.length > info.size) range = { offset: range.offset, length: info.size - range.offset };
  }
  const obj = name ? (request.method === 'HEAD' ? await env.CMS_MEDIA.head(key) : await env.CMS_MEDIA.get(key, range ? { range } : {})) : null;
  if (!obj) {
    // Right file, wrong or mangled name (a link pasted with the name changed): send them to the file.
    const row = await env.CMS_DB.prepare('SELECT name FROM cms_files WHERE id = ?').bind(id).first().catch(() => null);
    if (row && NAME_RE.test(row.name) && row.name !== name) {
      return new Response(null, { status: 301, headers: { location: fileUrl(id, row.name), 'cache-control': 'public, max-age=3600' } });
    }
    return notFound();
  }
  const ext = extOf(name);
  const spec = FILE_TYPES[ext];
  const headers = new Headers({
    'content-type': spec.type,
    'content-disposition': `${spec.inline ? 'inline' : 'attachment'}; filename="${name}"`,
    'cache-control': 'public, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
    'accept-ranges': 'bytes',
    etag: obj.httpEtag,
  });
  // Downloads never run as a page on this site. (PDFs are left alone: the browser's viewer needs them.)
  if (!spec.inline) headers.set('content-security-policy', "default-src 'none'; sandbox");
  if (request.method === 'HEAD') {
    headers.set('content-length', String(obj.size));
    return new Response(null, { headers });
  }
  if (range && obj.body) {
    // Large PDFs are read in parts by the browser's viewer.
    const size = obj.size;
    const offset = 'suffix' in range ? Math.max(0, size - range.suffix) : range.offset;
    const end = 'suffix' in range ? size - 1 : Math.min(size - 1, range.length ? range.offset + range.length - 1 : size - 1);
    headers.set('content-range', `bytes ${offset}-${end}/${size}`);
    headers.set('content-length', String(end - offset + 1));
    return new Response(obj.body, { status: 206, headers });
  }
  return new Response(obj.body, { headers });
}

/** One byte range ("bytes=0-99", "bytes=100-", "bytes=-500") as an R2 range, or null. */
function parseRange(value) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(value || '').trim());
  if (!m || (!m[1] && !m[2])) return null;
  if (!m[1]) return { suffix: Number(m[2]) };
  const offset = Number(m[1]);
  if (!m[2]) return { offset };
  const last = Number(m[2]);
  return last < offset ? null : { offset, length: last - offset + 1 };
}

async function title(ctx) {
  const v = parseVideo(ctx.url.searchParams.get('url'));
  if (!v) throw fail('Paste a link to a YouTube or Vimeo video.');
  return json({ kind: v.kind, id: v.id, title: await videoTitle(v) });
}

export default {
  name: 'media',
  api: [
    { method: 'POST', route: 'files', role: 'author', raw: true, handler: upload },
    { method: 'GET', route: 'files', role: 'author', handler: list },
    { method: 'GET', route: 'video-title', role: 'author', handler: title },
  ],
  routes: [
    { path: /^\/_cms\/files\/([^/]+)\/([^/]+)$/, handler: serve },
  ],
};
