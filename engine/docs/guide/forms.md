## Form messages (Inbox)

Site forms send their messages to the CMS, and editors read them in the editor's **Inbox**.

### What editors can do

| | How |
|---|---|
| See new messages | The **Inbox** button in the bottom bar shows how many are unread. Editors and admins only; authors don't see it. |
| Read a message | Open the Inbox and click a message. Every answer is shown, with the form, the page it was sent from and the time. Opening a message marks it as read. |
| Reply | **Reply by email** opens your email app addressed to the sender. |
| Keep track | **Mark as unread**, **Spam** / **Not spam**, **Delete** (asks first; can't be undone). |
| Find messages | Pick a form or **Spam** from the menu, or type in **Search messages**. Search looks at what people wrote, not the field names. |
| Spreadsheet | **Download as a spreadsheet** saves a CSV of the messages currently shown. Cells that could run as formulas are made safe. |
| Spam | Messages the spam checks caught wait under **Spam** for 30 days. **Not spam** moves one back to the Inbox; **Delete all spam** empties the list. |
| Email alerts (admins) | Shown only when email is set up. List who gets each new message. It's saved as a draft and starts working when you publish, and it appears in History like any page change. |

### Site setup

Mark a form and point it at the CMS:

```html
<form id="contact-form" data-cms-form="contact" action="/_cms/form/contact" method="post"
      data-cms-success="Thanks. Your message was sent.">
  …fields…
  <button type="submit">Send</button>
  <p role="status" aria-live="polite"></p>
</form>
```

- Form name: lower-case letters, digits and hyphens, at most 40 characters.
- **Field names** may contain letters, digits, spaces and `_ . : ( ) [ ] -`, up to 64 characters. Up to 50 fields, 5,000 characters each and 30 KB in total. Add `maxlength="5000"` to textareas. Files aren't accepted.
- **Without JavaScript** the browser posts and comes back to the same page with `?sent=<name>#<form id>`. The CMS writes the success message (`data-cms-success`, or "Thanks. Your message was sent.") into the form's `[role="status"]` element. If there isn't one, it adds a paragraph. Errors come back as `?unsent=<name>&why=<code>`, shown with a fixed plain-language message.
- **With JavaScript**, post with `fetch(form.action, { method: 'POST', body: new URLSearchParams(new FormData(form)), headers: { accept: 'application/json' } })`. You get `{ ok: true, message }` or `{ ok: false, code, error }` (`error` is ready to show), with HTTP 400, 413, 415, 429 or 503. The status element gets `data-cms-form-result="sent|error"` for styling.
- While the page is served, the CMS adds hidden fields to every `form[data-cms-form]`: a honeypot field, a signed load time, and the page path and form id used for the redirect back. They are never added in edit mode, so they can't be saved into the page. Pages without such a form are served byte-for-byte unchanged, but the feature uses `alwaysRender`, so the render pass runs on every page view.
- Run the migration `0014_forms.sql`: `npx wrangler d1 migrations apply <db> --remote`. Until it is applied, the Inbox button stays hidden and form posts answer "couldn't be sent right now".
- To delete old spam automatically, add a cron trigger to `wrangler.jsonc`, for example `"triggers": { "crons": ["17 4 * * *"] }`.

### Spam protection

- A hidden honeypot field.
- A load time signed with HMAC-SHA-256. The key is a random per-site key kept in D1 (`cms_form_keys`), or the `CMS_FORM_SECRET` secret if set. Forms sent within 3 seconds of loading are refused.
- At most 5 messages per 10 minutes per visitor, counted on a salted hash of their IP address.
- Posts must come from the same site (Origin or Referer).
- Optional Cloudflare Turnstile.

Honeypot hits and missing or forged time fields are stored as spam (the sender is told it worked) and deleted after 30 days. Too-fast posts, rate-limited posts and failed robot checks are refused with a plain message.

### Options (`createCms({ forms: { … } })`, all optional; `forms: false` turns the feature off)

| Option | Default | |
|---|---|---|
| `labels` | from the name | `{ contact: 'Contact page' }`: names shown in the Inbox, CSV and emails ("training-video" shows as "Training video") |
| `minSeconds` | 3 | Fastest a person can fill a form |
| `rate` | `{ max: 5, minutes: 10 }` | Messages per visitor |
| `keepDays` | 0 (keep) | Delete all messages older than this (needs the cron trigger) |
| `timeZone` | UTC | Times in the CSV, e.g. `'America/Chicago'` |
| `turnstile` | off | Turnstile site key; also set the `TURNSTILE_SECRET` secret. Needs JavaScript, so visitors without it can't send while this is on. |
| `notify` | off | `{ from: 'Website <web@yourdomain>', to: ['team@…'], forms: ['contact'] }`; also set the `RESEND_API_KEY` secret. Sends a plain-text email with reply-to set to the sender. The Email alerts list admins publish replaces `to`. |
| `salesforce` | off | `{ oid: '00D…', forms: ['contact'], fields: { name: 'last_name', email: 'email', company: 'company', phone: 'phone', message: 'description' }, leadSource: 'Website' }`. Posts each message to Salesforce Web-to-Lead. |

Email and Salesforce run after the message is stored, in the background. A failure is logged and never affects the visitor.

