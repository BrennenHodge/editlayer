## Site styles

One place to change the look of the whole site: colours, fonts, text weight, corners, buttons and spacing.

### What editors can do

| In the panel | How |
|---|---|
| Open it | **Site styles** button (palette) in the bottom bar. Editors and admins only. |
| Colours | Each colour has a swatch (click to pick) and a code field (type `#1a2b3c`, `rgb(…)` or `hsl(…)`). A see-through colour keeps its see-through amount when you pick a new one. If a text colour and its background become hard to read, a yellow note says so in plain words ("Text on gold buttons is hard to read") and the colours involved get a warning mark. |
| Fonts | Headings and body text, each picked from a short list of good Google fonts (clean and modern, or classic with serifs) plus the site's own fonts. A sample line shows the font. "Same as body text" or "Original (…)" goes back to the site's font. |
| Text weight | Sliders for headings and body text (Light, Regular, Medium, Bold…). |
| Corners | One slider from Sharp to Round for cards, pictures, boxes and inputs. |
| Buttons | Shape (Match corners, Square, Rounded, Pill), text weight, and All capitals on or off. |
| Spacing | Space around sections: Compact, Normal or Airy. |
| Reset | **Reset** on each group, or **Reset all to the original** at the bottom. |
| See the page on a phone | The arrow button in the panel header shrinks the panel to its title bar, so you can see the page. Tap it again to bring the settings back. |

Every change shows on the page straight away and saves on its own as a draft, like text edits. **Publish** (on any page) makes the styles live on every page. History lists it as "site styles", and Restore and Discard work as for other changes. Undo (Ctrl+Z) doesn't cover style changes. Use Reset instead.

### How it works

- The editor sends the whole style set as the site-wide draft key `@theme`, for example `{"props": {"--gold": "#d4a72c", "--radius": "8px"}, "fonts": {"--font-body": "Inter"}}`.
- The Worker checks it strictly and stores it as JSON. It accepts only settings this site offers. Colours must be `#hex`, `rgb()` or `hsl()`. Lengths are a number plus the setting's unit, within its min and max. Weights are 100–900 in hundreds. Choices and on/off values must be ones the panel offers. Fonts must come from the allowed list, which never includes Fraunces. Saving needs the editor role or higher. Anything else is refused with a plain message.
- On every page with a saved style set (published for visitors; draft in `?edit` and `?preview`), the Worker adds `<style id="vibecms-theme">:root{…}</style>` at the end of `<head>`, after the site's stylesheet. It also adds a Google Fonts `<link>`, with preconnect when the page has none, for chosen fonts the page doesn't already load. Every value is checked again before it's written. If nothing was ever saved, pages pass through untouched.

### Site setup: standard properties

Define these on `:root` in the site's stylesheet, with the current look as the default values, and use them in the CSS. The panel shows a control for each one the site defines.

| Property | Used for | Example default |
|---|---|---|
| `--font-body` | body text font stack (point other font variables at it, e.g. `--f-sans: var(--font-body)`) | `"Geist", ui-sans-serif, system-ui, sans-serif` |
| `--font-heading` | h1–h4 `font-family` | `var(--font-body)` (headings follow the body font until changed) |
| `--weight-heading` / `--weight-body` / `--weight-button` | `font-weight` of headings, body, buttons | `500` / `400` / `500` |
| `--radius` | `border-radius` of cards, images, inputs, framed boxes (add `overflow: clip` to frames so pictures follow the corners) | `0px` |
| `--radius-btn` | button `border-radius` | `var(--radius)` (follows the corners slider until a shape is chosen) |
| `--btn-case` | button `text-transform` | `none` (panel sets `uppercase`) |
| `--space-scale` | multiplier on section spacing, e.g. `--sec: calc(clamp(72px, 9vw, 128px) * var(--space-scale))` | `1` (Compact 0.75, Airy 1.35) |

### Options (`createCms({ styles: { … } })`)

```js
styles: {
  groups: [
    { id: 'colours', label: 'Colours', settings: [
      { prop: '--gold', label: 'Gold accent', hint: 'Buttons and highlights' },   // type defaults to 'color'
    ] },
    { id: 'corners', label: 'Corners', settings: [
      { prop: '--radius', type: 'length', unit: 'px', min: 0, max: 24, step: 1, label: 'Cards and pictures', ends: ['Sharp', 'Round'] },
    ] },
    'standard',   // the standard controls for the standard properties the stylesheet defines
  ],
  contrast: [ { text: '--text', on: '--paper', label: 'Main text on the page background', min: 4.5 } ],  // text may be a fixed colour such as '#ffffff'
  fonts: [ { name: 'Geist', category: 'sans', min: 100, max: 900, google: true } ],  // the site's own fonts; google: false if the site serves them itself
}
```

Setting types: `color`, `font`, `weight` (min, max), `length` (unit px|rem|em|%, min, max, step, ends), `choice` (options `[{ value, label }]`, where value `null` means the original), and `toggle` (`on`, `off`).

Without `opts.styles`, the Worker reads the `:root` custom properties from the site's own stylesheets. It offers every colour with a readable label (`--gold-soft` becomes "Gold soft") and the standard controls for the standard properties it finds. It guesses text/background pairs and warns only when a change makes a pair harder to read than it was.

The font list: Inter, Work Sans, DM Sans, Manrope, Public Sans, Plus Jakarta Sans, Outfit, Figtree, Source Sans 3, Space Grotesk, Source Serif 4, Lora, Playfair Display, Newsreader, plus `styles.fonts`. Each loads as one variable-weight Google Fonts file.

