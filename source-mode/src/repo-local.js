// A site repository on this computer, changed with the git command line. Used for Phase 0 testing.
//
// Safety rules (Phase 0): the working branch must not be main or master, the repository must have no remotes
// (so nothing can be pushed anywhere), and only files Editlayer changed are committed.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { SEARCHABLE } from './find.js';

const SKIP_DIRS = /(^|\/)(node_modules|dist|build|out|\.next|\.nuxt|\.svelte-kit|\.astro|\.vercel|\.netlify|\.wrangler|\.git|coverage|vendor|attached_assets|audit|docs|tmp)(\/|$)/;
const SKIP_FILES = /(^|\/)(package(-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|tsconfig[^/]*\.json|[^/]*\.config\.[cm]?[jt]s|[^/]*\.min\.[^/]+|[^/]*\.d\.ts|components\.json|manifest\.json|[^/]*\.webmanifest)$/i;
const ROOT_DOCS = /^[^/]+\.md$/i; // README.md, LAUNCH.md and similar at the repository root

export function localRepo(dir, { branch, allowRemotes = false } = {}) {
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();

  function assertSafe() {
    const current = git('rev-parse', '--abbrev-ref', 'HEAD');
    if (current !== branch) throw new Error(`Expected branch ${branch}, the repository is on ${current}`);
    if (/^(main|master)$/i.test(branch)) throw new Error('Editlayer Phase 0 never commits to main or master');
    if (!allowRemotes && git('remote')) throw new Error('This test repository has a remote; Phase 0 only works on a repository with none');
  }

  return {
    kind: 'local',
    dir,
    branch,
    assertSafe,

    /** Every searchable source file: Map<relative path, content>. */
    readAll() {
      const list = git('ls-files', '-z').split('\0').filter(Boolean);
      const files = new Map();
      for (const rel of list) {
        if (!SEARCHABLE.test(rel) || SKIP_DIRS.test(rel) || SKIP_FILES.test(rel) || ROOT_DOCS.test(rel)) continue;
        const full = path.join(dir, rel);
        let st;
        try { st = fs.statSync(full); } catch { continue; }
        if (st.size > 1_500_000) continue;
        files.set(rel, fs.readFileSync(full, 'utf8'));
      }
      return files;
    },

    head() { return git('rev-parse', 'HEAD'); },

    /** Writes the changed files and commits them. changes: Map<relative path, content>. Returns the commit sha. */
    commit(changes, message, author) {
      assertSafe();
      if (git('status', '--porcelain')) throw new Error('The test repository has uncommitted changes; commit or discard them first');
      for (const [rel, content] of changes) {
        const full = path.join(dir, rel);
        if (!full.startsWith(path.resolve(dir) + path.sep)) throw new Error(`Refusing to write outside the repository: ${rel}`);
        fs.writeFileSync(full, content);
      }
      git('add', '--', ...changes.keys());
      git('-c', `user.name=${author.name}`, '-c', `user.email=${author.email}`, 'commit', '-q', '-m', message);
      return git('rev-parse', 'HEAD');
    },

    /** Undoes one Editlayer commit with a new commit. */
    revert(sha, author) {
      assertSafe();
      git('-c', `user.name=${author.name}`, '-c', `user.email=${author.email}`, 'revert', '--no-edit', sha);
      return git('rev-parse', 'HEAD');
    },

    log(limit = 20) {
      const out = git('log', `-${limit}`, '--format=%H%x09%an%x09%aI%x09%s');
      return out ? out.split('\n').map((l) => { const [sha, author, at, subject] = l.split('\t'); return { sha, author, at, subject }; }) : [];
    },
  };
}
