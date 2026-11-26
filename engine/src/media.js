import { json, randomToken } from './util.js';

const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' };
const MAX_BYTES = 15 * 1024 * 1024;

const BY_EXT = Object.fromEntries(Object.entries(TYPES).map(([type, ext]) => [ext, type]));

/** The image type the file's first bytes show, whatever the browser claimed (null: not an image we take). */
export function sniffImage(b) {
  const at = (i, s) => [...s].every((c, j) => b[i + j] === c.charCodeAt(0));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && at(1, 'PNG\r\n')) return 'image/png';
  if (at(0, 'GIF87a') || at(0, 'GIF89a')) return 'image/gif';
  if (at(0, 'RIFF') && at(8, 'WEBP')) return 'image/webp';
  if (at(4, 'ftyp') && (at(8, 'avif') || at(8, 'avis'))) return 'image/avif';
  return null;
}

export async function upload(request, env, user) {
  if (Number(request.headers.get('content-length') || 0) > MAX_BYTES + 1024 * 1024) return json({ error: 'Images must be under 15 MB.' }, 413);
  const form = await request.formData();
  const file = form.get('file');
  if (!file || typeof file === 'string') return json({ error: 'No file received.' }, 400);
  if (!TYPES[file.type]) return json({ error: 'Use a JPG, PNG, WebP, GIF or AVIF image.' }, 415);
  if (file.size > MAX_BYTES) return json({ error: 'Images must be under 15 MB.' }, 413);
  // Trust the bytes, not the label: an HTML or SVG file renamed .png is refused.
  const type = sniffImage(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
  if (!type) return json({ error: 'That file doesn’t look like a JPG, PNG, WebP, GIF or AVIF image.' }, 415);
  const ext = TYPES[type];
  const id = randomToken(9).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10) || randomToken(6);
  const name = String(form.get('name') || file.name || 'image').replace(/[^\w.\- ]+/g, '').slice(0, 120);
  const fileName = `${id}.${ext}`;
  await env.CMS_MEDIA.put(`media/${fileName}`, file.stream(), {
    httpMetadata: { contentType: type, cacheControl: 'public, max-age=31536000, immutable' },
  });
  const width = parseInt(form.get('width'), 10) || null;
  const height = parseInt(form.get('height'), 10) || null;
  const alt = String(form.get('alt') || '').slice(0, 300);
  await env.CMS_DB.prepare('INSERT INTO cms_media (id, file, name, type, size, width, height, alt, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, fileName, name, type, file.size, width, height, alt, Date.now(), user.email).run();
  return json({ url: `/_cms/media/${fileName}`, width, height, name });
}

export async function list(env, origin) {
  const { results } = await env.CMS_DB.prepare('SELECT file, name, width, height, alt FROM cms_media ORDER BY created_at DESC LIMIT 500').all();
  let site = [];
  try {
    const res = await env.ASSETS.fetch(new Request(`${origin}/editlayer-images.json`));
    if (res.ok) site = await res.json();
  } catch { /* no manifest: only uploads are listed */ }
  return json({
    uploads: results.map((r) => ({ url: `/_cms/media/${r.file}`, name: r.name, width: r.width, height: r.height, alt: r.alt })),
    site,
  });
}

export async function serve(env, fileName) {
  if (!/^[a-z0-9]+\.(jpg|png|webp|gif|avif)$/i.test(fileName)) return new Response('Not found', { status: 404 });
  const obj = await env.CMS_MEDIA.get(`media/${fileName}`);
  if (!obj) return new Response('Not found', { status: 404 });
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  // The type always follows the file name (an image type), never what was stored with an older upload.
  headers.set('content-type', BY_EXT[fileName.split('.').pop().toLowerCase()]);
  headers.set('etag', obj.httpEtag);
  headers.set('x-content-type-options', 'nosniff');
  // Opened on its own, an upload is never a page that can run anything on this site.
  headers.set('content-security-policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
  return new Response(obj.body, { headers });
}
