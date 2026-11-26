### Approval, preview links and scheduled publishing (feature: review)

**What editors can do**

| Who | What | How |
|---|---|---|
| Authors | Edit pages and save drafts, but not publish | The Publish button reads **Submit for review**. It saves, then asks for an optional note to the editor. Authors can keep editing while they wait. Sending again while the request is waiting updates the note. |
| Authors | See what happened to their requests | **Reviews** button (bottom bar) → *My requests*: waiting, published, declined (with the editor's comment) or cancelled. A badge counts new answers. Authors can cancel a waiting request; their changes stay as a draft. |
| Editors, admins | Approve or decline | **Reviews** → *Waiting* (the badge counts requests). Open the page, **Preview** it in a new tab, **Approve and publish** (publishes the page as it is now, plus the site-wide header and footer, with the reviewer recorded as publisher), or **Decline** with a comment the author sees. Editors who open a page with a waiting request get a reminder. |
| Everyone signed in | Share a preview | **Reviews** → *Preview links* (or **Page settings** → *Share a preview*) → **Create a preview link**. Anyone with the link sees the page with its unpublished changes, without signing in, for 7 days. The link is shown once. Active links are listed and can be turned off (by the person who made the link, or by an editor). Expired or turned-off links show a friendly "This preview link has expired" page. Preview pages carry noindex and no-referrer and show a small "Preview of unpublished changes · link expires …" note. |
| Editors, admins | Schedule publishing | **Reviews** → *Schedule*: pick a date and time (shown in your own time zone, stored in UTC). At that time everything unpublished on the page goes live, including changes made after scheduling, plus the site-wide header and footer. It runs within 5 minutes of the chosen time. Scheduled publishes can be moved or cancelled, and recent results are listed. History shows them as published by "scheduled: <who>". |
| Admins | Invite authors | **Editors** panel: the role menu now has **Author**, **Editor** and **Admin**, with a one-line explanation of each. |
| Admins | Email the invite | When email is set up, the Editors panel gets **Email the invite** and an envelope button next to each person (sends a new link, which also resets their password). The server creates the link and sends it, never a link from the browser. If sending fails, the link is shown to copy and send by hand. |

Roles: **author** < **editor** < **admin**. Authors can't publish, publish all pages, reset a page, schedule, approve or manage people (the server refuses; the buttons are hidden).

**Site setup**

1. Apply the migration: `npx wrangler d1 migrations apply <db> --remote`. `migrations/0016_review.sql` rebuilds `cms_users` to allow the `author` role, keeping every row and id so sessions stay valid. It also adds `cms_reviews`, `cms_preview_links` and `cms_schedules`.
2. Add a cron trigger to `wrangler.jsonc` for scheduled publishing:
   ```jsonc
   "triggers": { "crons": ["*/5 * * * *"] }
   ```
   Local test: `npx wrangler dev --test-scheduled`, then open `/__scheduled?cron=*/5+*+*+*+*`.
3. Optional email (invites and review notifications) through [Resend](https://resend.com):
   - `npx wrangler secret put RESEND_API_KEY`
   - in `cms.worker.js`: `createCms({ ..., email: { from: 'Site name <cms@your-domain>' } })` (the sending domain must be verified in Resend).
   Without both, email buttons are hidden and nothing is sent.

**Options** (`createCms({ email: { ... } })`)

| Option | Default | Does |
|---|---|---|
| `email.from` | none (email off) | Sender, e.g. `Example Website <cms@example.com>`. Needs `RESEND_API_KEY` too. |
| `email.replyTo` | none | Reply-to address on all emails. |
| `email.siteUrl` | the address the request came to | Public site address used in links inside emails. |
| `email.notify` | `true` | Email editors and admins when an author asks for a review, and the author when it's approved or declined. `false` keeps only invite emails. |
| `email.endpoint` | `https://api.resend.com/emails` | Resend-compatible endpoint (tests or a relay). |

**Notes**

- A request whose drafts disappear (published directly by an editor, or discarded) is settled automatically: it shows as *Published* (with whoever published it) or *Changes discarded*.
- Notification emails go out only for new requests, not for re-sends while a request is waiting.
- To make an existing person an author, invite their email again with the Author role (this also resets their password).
