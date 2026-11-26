// A site repository on GitHub, read and changed through the REST API (no clone needed, works from a Worker).
// NOT YET RUN against GitHub: Phase 0 testing so far used repo-local.js. Needs a fine-grained token with
// Contents read/write, Metadata read, Commit statuses read and Deployments read on the one repository.
//
// Safety rule (Phase 0): commits only to the configured branch, never main or master, and only as a fast-forward.

import { SEARCHABLE } from './find.js';

const SKIP = /(^|\/)(node_modules|dist|build|out|\.next|\.git|coverage|vendor|attached_assets|audit|docs|tmp)(\/|$)|(^|\/)(package(-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|tsconfig[^/]*\.json|[^/]*\.config\.[cm]?[jt]s|[^/]*\.min\.[^/]+|[^/]*\.d\.ts)$|^[^/]+\.md$/i;

export function githubRepo({ owner, repo, branch, token, fetchImpl = fetch }) {
  if (/^(main|master)$/i.test(branch)) throw new Error('Editlayer Phase 0 never commits to main or master');
  const base = `https://api.github.com/repos/${owner}/${repo}`;
  const blobCache = new Map(); // sha -> content

  async function gh(method, route, body) {
    const r = await fetchImpl(base + route, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'editlayer-source-mode',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) throw new Error(`GitHub ${method} ${route}: ${r.status} ${(await r.text()).slice(0, 200)}`);
    return r.status === 204 ? null : r.json();
  }

  const decode = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\n/g, '')), (c) => c.charCodeAt(0)));
  const encode = (s) => { let bin = ''; for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b); return btoa(bin); };

  return {
    kind: 'github',
    branch,

    async head() { return (await gh('GET', `/git/ref/heads/${encodeURIComponent(branch)}`)).object.sha; },

    async readAll() {
      const sha = await this.head();
      const commit = await gh('GET', `/git/commits/${sha}`);
      const tree = await gh('GET', `/git/trees/${commit.tree.sha}?recursive=1`);
      const files = new Map();
      const wanted = tree.tree.filter((t) => t.type === 'blob' && t.size < 1_500_000 && SEARCHABLE.test(t.path) && !SKIP.test(t.path));
      for (const t of wanted) {
        if (!blobCache.has(t.sha)) blobCache.set(t.sha, decode((await gh('GET', `/git/blobs/${t.sha}`)).content));
        files.set(t.path, blobCache.get(t.sha));
      }
      files.headSha = sha;
      return files;
    },

    /** One commit with all changed files, fast-forwarded onto the branch. Returns the new commit sha. */
    async commit(changes, message, author, expectedHead) {
      const head = await this.head();
      if (expectedHead && head !== expectedHead) throw new Error('The branch changed while publishing; try again');
      const parent = await gh('GET', `/git/commits/${head}`);
      const entries = [];
      for (const [path, content] of changes) {
        const blob = await gh('POST', '/git/blobs', { content: encode(content), encoding: 'base64' });
        entries.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
      }
      const tree = await gh('POST', '/git/trees', { base_tree: parent.tree.sha, tree: entries });
      const commit = await gh('POST', '/git/commits', {
        message, tree: tree.sha, parents: [head],
        author: { name: author.name, email: author.email, date: new Date().toISOString() },
      });
      await gh('PATCH', `/git/refs/heads/${encodeURIComponent(branch)}`, { sha: commit.sha, force: false });
      return commit.sha;
    },

    /** What the host has reported for a commit: combined status plus deployments. */
    async deployStatus(sha) {
      const status = await gh('GET', `/commits/${sha}/status`);
      const deployments = await gh('GET', `/deployments?sha=${sha}&per_page=5`);
      const latest = [];
      for (const d of deployments) {
        const s = await gh('GET', `/deployments/${d.id}/statuses?per_page=1`);
        latest.push({ environment: d.environment, state: s[0]?.state || 'pending', url: s[0]?.environment_url || s[0]?.target_url || null });
      }
      return { combined: status.state, statuses: status.statuses.map((s) => ({ context: s.context, state: s.state })), deployments: latest };
    },
  };
}
