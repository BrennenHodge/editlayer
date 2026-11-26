// YouTube and Vimeo links: recognise the video and look up its title (for the embed's title,
// which screen readers announce). The editor has the same parser; this one is the server's own.

/** { kind: 'youtube' | 'vimeo', id, hash? } or null. */
export function parseVideo(input) {
  let u;
  try { u = new URL(String(input || '').trim()); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.toLowerCase().replace(/^(www|m|music)\./, '');
  const parts = u.pathname.split('/').filter(Boolean);
  const yt = (id) => (/^[A-Za-z0-9_-]{11}$/.test(id || '') ? { kind: 'youtube', id } : null);
  if (host === 'youtu.be') return yt(parts[0]);
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (parts[0] === 'watch') return yt(u.searchParams.get('v'));
    if (['embed', 'shorts', 'live', 'v'].includes(parts[0])) return yt(parts[1]);
    return null;
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const i = parts.findIndex((p) => /^\d{5,12}$/.test(p));
    if (i < 0) return null;
    const next = parts[i + 1];
    const hash = u.searchParams.get('h') || (next && /^[a-f0-9]{6,20}$/i.test(next) ? next : '');
    return { kind: 'vimeo', id: parts[i], hash: /^[a-f0-9]{6,20}$/i.test(hash) ? hash : '' };
  }
  return null;
}

/** The video's title from the provider (oEmbed), or '' when it can't be found. Fixed hosts only. */
export async function videoTitle(v) {
  const page = v.kind === 'youtube' ? `https://www.youtube.com/watch?v=${v.id}` : `https://vimeo.com/${v.id}${v.hash ? `/${v.hash}` : ''}`;
  const api = v.kind === 'youtube'
    ? `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(page)}`
    : `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(page)}`;
  try {
    const res = await fetch(api, { signal: AbortSignal.timeout(4000), headers: { accept: 'application/json' } });
    if (!res.ok) return '';
    const text = await res.text();
    if (text.length > 200_000) return '';
    const data = JSON.parse(text);
    return typeof data.title === 'string' ? data.title.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
  } catch {
    return '';
  }
}
