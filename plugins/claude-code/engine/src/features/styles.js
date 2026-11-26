// Site styles: colours, fonts, weights, corners, buttons and spacing for the whole site, edited live
// in the editor and stored as the site-wide draft key "@theme" (draft → publish → history).
//
// Stored value: {"props": {"--gold": "#d4a72c", "--radius": "8px"}, "fonts": {"--font-body": "Inter"}}
// Served as <style id="editlayer-theme">:root{…}</style> at the end of <head>, plus a Google Fonts
// <link> for chosen fonts the page doesn't already load.

import { hasRole, escapeHtml } from '../util.js';
import { fontList, familiesIn, weightsIn } from './styles/fonts.js';
import { buildSchema, validateTheme, parseTheme, themeCss, isWeight } from './styles/schema.js';
import { siteVars } from './styles/discover.js';

async function schemaFor(env, opts, path) {
  const needVars = !(opts.styles && Array.isArray(opts.styles.groups)) || opts.styles.groups.includes('standard');
  const vars = needVars ? await siteVars(env, path || '/') : null;
  return { schema: buildSchema(opts, vars), vars };
}

export default {
  name: 'styles',

  keys: {
    async '@theme'(value, { env, path, user, opts = {} }) {
      if (!hasRole(user, 'editor')) throw Object.assign(new Error('Only editors and admins can change site styles.'), { status: 403 });
      const { schema } = await schemaFor(env, opts, path);
      const theme = validateTheme(value, schema, fontList(opts));
      return JSON.stringify(theme);
    },
  },

  async render(ctx) {
    const row = ctx.rows.get('@theme');
    const theme = (row && parseTheme(row.html)) || { props: {}, fonts: {} };
    const fonts = fontList(ctx.opts);

    if (ctx.editing && hasRole(ctx.user, 'editor')) {
      const { schema, vars } = await schemaFor(ctx.env, ctx.opts, ctx.path);
      const raw = {};
      if (vars) for (const g of schema.groups) for (const s of g.settings) if (vars.has(s.prop)) raw[s.prop] = vars.get(s.prop).slice(0, 200);
      ctx.share({
        groups: schema.groups,
        contrast: schema.contrast,
        auto: schema.auto,
        raw,
        fonts: fonts.map(({ name, category, min, max, css, href, site }) => ({ name, category, min, max, css, href, site: Boolean(site) })),
        theme,
      });
    }

    const css = themeCss(theme, fonts);
    if (!css) return;
    const chosen = [...new Set(Object.values(theme.fonts))].map((n) => fonts.find((f) => f.name === n)).filter((f) => f && f.href);
    // Weights the theme asks for: a font the page already loads with only some weights (for example, a site that loads
    // Geist 400;500;600) is loaded again with its full range, or "Light" and "Bold" would look the same.
    const weights = [...new Set(Object.values(theme.props).filter((v) => isWeight(v)).map(Number))];
    const loaded = new Set();
    const ranges = new Map();
    let preconnected = false;
    if (chosen.length || weights.length) {
      ctx.on('link[href*="fonts.googleapis.com/css"]', {
        element(el) {
          const href = el.getAttribute('href') || '';
          familiesIn(href).forEach((f) => loaded.add(f));
          for (const [fam, r] of weightsIn(href)) ranges.set(fam, [...(ranges.get(fam) || []), ...r]);
        },
      });
      ctx.on('link[rel="preconnect"][href^="https://fonts.gstatic.com"]', { element() { preconnected = true; } });
    }
    const missingWeights = (f) => {
      const r = ranges.get(f.name.toLowerCase());
      return Boolean(r) && weights.some((w) => w >= f.min && w <= f.max && !r.some(([a, b]) => w >= a && w <= b));
    };
    ctx.on('head', {
      element(el) {
        el.onEndTag((end) => {
          const need = chosen.filter((f) => !loaded.has(f.name.toLowerCase()));
          for (const f of fonts) if (f.href && !need.includes(f) && missingWeights(f)) need.push(f);
          let html = '';
          if (need.length) {
            if (!preconnected) html += '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>';
            html += need.map((f) => `<link rel="stylesheet" href="${escapeHtml(f.href)}" data-editlayer-font>`).join('');
          }
          html += `<style id="editlayer-theme">${css.replace(/</g, '\\3c ')}</style>`;
          end.before(html, { html: true });
        });
      },
    });
  },
};
