// Drafts and publishing. A draft is "on this page, this text should now read that", plus where it was found.
// Publishing finds every draft again in the current source (the developer may have changed files since),
// writes them all, checks each file still parses, and makes one commit.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { locate, findAll, snippet } from './find.js';
import { applyToFile, readsAs } from './apply.js';
import { norm } from './text.js';

export function createService({ repo, dataDir }) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'drafts.json');
  let drafts = [];
  try { drafts = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  const save = () => fs.writeFileSync(file, JSON.stringify(drafts, null, 2));

  const view = (d) => ({ id: d.id, path: d.path, old: d.old, new: d.new, where: d.where, copies: d.copies || 0, scope: d.scope, at: d.at, by: d.by });
  const describe = (loc) => ({ file: loc.file, line: loc.line, col: loc.col, kind: loc.kind });

  async function files() { return await repo.readAll(); }

  /** Resolves a draft against the current files. Returns { edits: [{file,start,end,kind,quote,text}] } or { error }. */
  function resolve(all, d) {
    if (d.scope === 'all') {
      const cands = findAll(all, d.old);
      if (!cands.length) return { error: 'missing' };
      return { edits: cands.map((c) => ({ ...c, text: d.new })) };
    }
    const r = locate(all, { text: d.old, neighbours: d.neighbours, path: d.path, prefer: d.where, shared: !!d.shared });
    if (r.status !== 'found') return { error: r.status, candidates: r.candidates };
    return { edits: [r.loc, ...(r.copies || [])].map((c) => ({ ...c, text: d.new })) };
  }

  return {
    list() { return drafts.map(view); },

    /**
     * Records one text change from the editor. change: { path, old, new, neighbours }.
     * Returns { draft, result: { status, where?, candidates?, others? } }.
     */
    async change(change, user) {
      const oldText = norm(change.old);
      const newText = norm(change.new);
      if (!oldText) throw new Error('Nothing to change');
      // editing a text that is already a draft: update that draft
      const prev = drafts.find((d) => d.new === oldText && (d.path === change.path || d.scope === 'all'));
      if (prev) {
        if (newText === prev.old) { drafts = drafts.filter((d) => d !== prev); save(); return { removed: prev.id, result: { status: 'reverted' } }; }
        prev.new = newText; prev.at = new Date().toISOString(); save();
        return { draft: view(prev), result: { status: 'found', where: prev.where, scope: prev.scope } };
      }
      if (newText === oldText) return { result: { status: 'unchanged' } };
      const all = await files();
      const r = locate(all, { text: oldText, neighbours: change.neighbours || [], path: change.path, shared: !!change.shared });
      if (r.status === 'missing') return { result: { status: 'missing' } };
      const d = {
        id: crypto.randomUUID(), path: change.path, old: oldText, new: newText,
        neighbours: (change.neighbours || []).slice(0, 24), shared: !!change.shared, where: r.status === 'found' ? describe(r.loc) : null,
        scope: r.status === 'found' ? 'here' : 'pending', at: new Date().toISOString(), by: user.email,
      };
      drafts.push(d);
      save();
      if (r.status === 'found') {
        d.copies = r.copies?.length || 0;
        save();
        return { draft: view(d), result: { status: 'found', where: d.where, copies: d.copies, others: r.others, how: r.how } };
      }
      return {
        draft: view(d),
        result: {
          status: 'ambiguous',
          candidates: r.candidates.map((c) => ({ ...describe(c), snippet: snippet(all.get(c.file), c.start, c.end) })),
        },
      };
    },

    /** The editor's answer to "which one?": { file, line } for one place, or 'all'. */
    choose(id, choice) {
      const d = drafts.find((x) => x.id === id);
      if (!d) throw new Error('No such draft');
      if (choice === 'all') { d.scope = 'all'; d.where = null; }
      else { d.scope = 'here'; d.where = { file: String(choice.file), line: Number(choice.line) }; }
      save();
      return view(d);
    },

    discard(id) {
      const before = drafts.length;
      drafts = drafts.filter((d) => d.id !== id || false);
      if (id === '*') drafts = [];
      save();
      return before - drafts.length;
    },

    /**
     * Writes every ready draft into the source and commits once.
     * Drafts that can't be placed stay as drafts and are reported. Returns { sha, files, published, skipped }.
     */
    async publish(user) {
      const ready = drafts.filter((d) => d.scope === 'here' || d.scope === 'all');
      if (!ready.length) throw new Error('Nothing to publish');
      const all = await files();
      const byFile = new Map();
      const published = [];
      const skipped = [];
      for (const d of ready) {
        const r = resolve(all, d);
        if (r.error) { skipped.push({ id: d.id, old: d.old, reason: r.error }); continue; }
        for (const e of r.edits) {
          if (!byFile.has(e.file)) byFile.set(e.file, []);
          byFile.get(e.file).push({ ...e, draft: d.id });
        }
        published.push(d);
      }
      const changes = new Map();
      for (const [f, edits] of byFile) {
        // the same spot changed by two drafts (e.g. one "everywhere" and one "here"): keep the latest
        const seen = new Map();
        for (const e of edits) seen.set(e.start, e);
        try {
          changes.set(f, applyToFile(f, all.get(f), [...seen.values()]));
        } catch (err) {
          const ids = new Set(edits.map((e) => e.draft));
          for (const d of published.filter((p) => ids.has(p.id))) skipped.push({ id: d.id, old: d.old, reason: err.message });
          for (let i = published.length - 1; i >= 0; i--) if (ids.has(published[i].id)) published.splice(i, 1);
        }
      }
      // drop files whose only drafts were skipped
      for (const f of [...changes.keys()]) {
        if (!byFile.get(f).some((e) => published.some((p) => p.id === e.draft))) changes.delete(f);
      }
      if (!changes.size) return { sha: null, files: [], published: [], skipped };
      const first = published[0];
      const more = published.length > 1 ? ` and ${published.length - 1} more` : '';
      const subject = `Content: "${first.new.slice(0, 50)}${first.new.length > 50 ? '…' : ''}"${more} (Vibe CMS, ${user.name})`;
      const body = published.map((d) => `- ${d.path}: "${d.old}" → "${d.new}"`).join('\n');
      const sha = await repo.commit(changes, `${subject}\n\n${body}\n`, { name: 'Vibe CMS', email: 'cms@vibecms.local' });
      const done = new Set(published.map((p) => p.id));
      drafts = drafts.filter((d) => !done.has(d.id));
      save();
      return { sha, files: [...changes.keys()], published: published.map(view), skipped };
    },

    /** Checks used by tests: does the committed file read as the new text at the place it was found? */
    readsAs,
  };
}
