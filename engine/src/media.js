import { json, randomToken } from './util.js';

const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' };
const MAX_BYTES = 15 * 1024 * 1024;

export async function upload(request, env, user) {
  const form = await request.formData();
  const file = form.get('file');
  if (!file || typeof file === 'string') return json({ error: 'No file received.' }, 400);
  const ext = TYPES[file.type];
  if (!ext) return json({ error: 'Use a JPG, PNG, WebP, GIF or AVIF image.' }, 415);
  if (file.size > MAX_BYTES) return json({ error: 'Images must be under 15 MB.' }, 413);
  const id = randomToken(9).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10) || randomToken(6);
  const name = String(form.get('name') || file.name || 'image').replace(/[^\w.\- ]+/g, '').slice(0, 120);
  const fileName = `${id}.${ext}`;
  await env.CMS_MEDIA.put(`media/${fileName}`, file.stream(), {
    httpMetadata: { contentType: file.type, cacheControl: 'public, max-age=31536000, immutable' },
  });
  const width = parseInt(form.get('width'), 10) || null;
  const height = parseInt(form.get('height'), 10) || null;
  const alt = String(form.get('alt') || '').slice(0, 300);
  await env.CMS_DB.prepare('INSERT INTO cms_media (id, file, name, type, size, width, height, alt, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, fileName, name, file.type, file.size, width, height, alt, Date.now(), user.email).run();
  return json({ url: `/_cms/media/${fileName}`, width, height, name });
}

export async function list(env, origin) {
  const { results } = await env.CMS_DB.prepare('SELECT file, name, width, height, alt FROM cms_media ORDER BY created_at DESC LIMIT 500').all();
  let site = [];
  try {
    const res = await env.ASSETS.fetch(new Request(`${origin}/vibecms-images.json`));
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
  headers.set('etag', obj.httpEtag);
  headers.set('x-content-type-options', 'nosniff');
  return new Response(obj.body, { headers });
}
