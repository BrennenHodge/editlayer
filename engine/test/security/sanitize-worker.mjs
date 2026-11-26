import { sanitize } from 'ENGINE/sanitize.js';
export default {
  async fetch(req) {
    const { payloads, opts } = await req.json();
    const out = [];
    for (const p of payloads) {
      try { const removed = []; const o = await sanitize(p, { ...(opts || {}), removed }); out.push(opts && opts.report ? o + '   #REMOVED ' + JSON.stringify(removed) : o); } catch (e) { out.push('ERROR: ' + e.message); }
    }
    return Response.json(out);
  },
};
