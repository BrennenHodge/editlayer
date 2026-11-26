// Juniper Café: the Editlayer demo site for app-directory reviewers (https://demo.editlayer.co).
// Engine: ./_editlayer (refresh with: node ../engine/cli/editlayer.mjs update).
import { createCms } from './_editlayer/src/worker.js';

const cms = createCms({
  siteName: 'Juniper Café',
  accent: '#b0532c',
  // Reviewers sign in with a password: app-store reviews can't receive emailed links or codes.
  login: 'password',
});

// Every night the page edits, new pages and schedules are cleared, so each reviewer starts from the real site.
// Editor accounts and AI connections stay. History older than a week goes too.
const RESET_CRON = '40 4 * * *';
async function resetDemo(env) {
  const weekAgo = Date.now() - 7 * 864e5;
  await env.CMS_DB.batch([
    env.CMS_DB.prepare('DELETE FROM cms_regions'),
    env.CMS_DB.prepare('DELETE FROM cms_pages'),
    env.CMS_DB.prepare('DELETE FROM cms_schedules'),
    env.CMS_DB.prepare('DELETE FROM cms_preview_links'),
    env.CMS_DB.prepare('DELETE FROM cms_revisions WHERE published_at < ?').bind(weekAgo),
  ]);
}

export default {
  ...cms,
  async scheduled(event, env, ctx) {
    if (event.cron === RESET_CRON) {
      try { await resetDemo(env); } catch (err) { console.error('demo reset failed', err && err.stack || err); }
    }
    return cms.scheduled(event, env, ctx);
  },
};
