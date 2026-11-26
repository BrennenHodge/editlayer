// Writes seed.sql for the security test site: an admin, an editor and an author with known invite links, and
// three AI keys (author role, editor role, and one whose maker is no longer an admin). Test values only.
//   node seed.mjs > seed.sql   then   npx wrangler d1 execute <db> --local --file seed.sql
import crypto from 'node:crypto';

const h = (s) => crypto.createHash('sha256').update(s).digest('hex');
const now = Date.now();
const exp = now + 7 * 864e5;
const users = [
  ['admin@test.local', 'admin', 'inviteadmin00000000000000000001'],
  ['editor@test.local', 'editor', 'inviteeditor0000000000000000001'],
  ['author@test.local', 'author', 'inviteauthor0000000000000000001'],
];
const keys = [
  ['AuthorBot', 'author', 'admin@test.local', 'vcms_authorkey000000000000000000000001'],
  ['EditorBot', 'editor', 'admin@test.local', 'vcms_editorkey000000000000000000000001'],
  ['Orphan', 'editor', 'gone@test.local', 'vcms_orphankey000000000000000000000001'],
];
const out = ['DELETE FROM cms_regions; DELETE FROM cms_revisions; DELETE FROM cms_sessions; DELETE FROM cms_ai_usage; DELETE FROM cms_ai_tokens; DELETE FROM cms_users;'];
for (const [e, r, t] of users) out.push(`INSERT INTO cms_users (email, name, role, invite_hash, invite_expires, created_at) VALUES ('${e}', '${r} test', '${r}', '${h(t)}', ${exp}, ${now});`);
for (const [n, r, by, k] of keys) out.push(`INSERT INTO cms_ai_tokens (name, token_hash, role, created_by, created_at) VALUES ('${n}', '${h(k)}', '${r}', '${by}', ${now});`);
console.log(out.join('\n'));
