// Vibe CMS marketing site, edited with Vibe CMS. Engine: ./_vibecms (refresh: node ../engine/cli/vibecms.mjs update)
import { createCms } from './_vibecms/src/worker.js';

export default createCms({
  siteName: 'Vibe CMS',
  accent: '#6a4cff',
  // Editors sign in with an emailed link (no passwords). Sent through Resend from the verified
  // mail.dbvantage.com domain; needs the RESEND_API_KEY secret.
  login: 'link',
  email: { from: 'Vibe CMS <signin@mail.dbvantage.com>', siteUrl: 'https://cms.dbvantage.com' },
  // Section backgrounds editors can pick: the site's own classes.
  sections: {
    backgrounds: [
      { label: 'Page', class: '' },
      { label: 'White', class: 'sec--white' },
      { label: 'Tint', class: 'sec--tint' },
      { label: 'Dark', class: 'sec--ink' },
    ],
    photoClass: 'sec--ink',
  },
  styles: {
    groups: [
      {
        id: 'colours',
        label: 'Colours',
        settings: [
          { prop: '--lime', label: 'Highlight', hint: 'Highlighted words, the call-to-action band, bright buttons' },
          { prop: '--caret', label: 'Cursor and focus', hint: 'The blinking cursor, focus rings, the current menu item' },
          { prop: '--paper', label: 'Page background' },
          { prop: '--white', label: 'Cards and white sections' },
          { prop: '--tint', label: 'Tinted sections' },
          { prop: '--text', label: 'Main text' },
          { prop: '--text-2', label: 'Paragraph text' },
          { prop: '--muted', label: 'Quiet text' },
          { prop: '--line', label: 'Lines and card borders' },
        ],
      },
      'standard',
    ],
    contrast: [
      { text: '--text', on: '--paper', label: 'Main text on the page background' },
      { text: '--text-2', on: '--white', label: 'Paragraph text on cards' },
      { text: '--muted', on: '--paper', label: 'Quiet text on the page background' },
      { text: '--on-lime', on: '--lime', label: 'Text on the highlight colour' },
    ],
    fonts: [
      { name: 'Bricolage Grotesque', category: 'sans', min: 200, max: 800 },
      { name: 'JetBrains Mono', category: 'mono', min: 100, max: 800 },
    ],
  },
  // The early-access and support forms send to the Vibe CMS inbox. Messages are deleted after 12 months,
  // as the privacy policy (/privacy/) promises.
  forms: { keepDays: 365 },
});
