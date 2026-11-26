// Quality (Worker side): stores the page checks an editor chose to ignore on a page, as the draft key
// "#checks" ({ ignored: ["links:…", …] }), so it follows draft → publish → history like the page itself,
// and hands the list to the editor. Visitors never see it.

const MAX_ITEMS = 300;
const ID_RE = /^(meta|images|links|headings|contrast|placeholder):/;

export function cleanChecks(value) {
  const list = value && Array.isArray(value.ignored) ? value.ignored : [];
  const out = [];
  for (const s of list) {
    if (typeof s !== 'string') continue;
    const v = s.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 190);
    if (ID_RE.test(v) && !out.includes(v)) out.push(v);
    if (out.length >= MAX_ITEMS) break;
  }
  return { ignored: out };
}

export default {
  name: 'quality',
  keys: {
    '#checks': (value) => JSON.stringify(cleanChecks(value)),
  },
  render(ctx) {
    if (!ctx.editing) return;
    const row = ctx.rows.get('#checks');
    let data = { ignored: [] };
    if (row) {
      try { data = cleanChecks(JSON.parse(row.html)); } catch { data = { ignored: [] }; }
    }
    ctx.share(data);
  },
};
