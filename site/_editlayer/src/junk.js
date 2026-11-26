// Markup that browser extensions inject into pages people type on: grammar checkers (Grammarly,
// now Superhuman; LanguageTool; DeepL; Wordtune), password managers (Dashlane, LastPass, 1Password,
// Bitwarden, NordPass, Proton Pass, Keeper), AI sidebars and dark-mode tools. None of it belongs in a
// saved page. The editor strips it before saving and the Worker strips it again (sanitize.js).
// The build embeds these patterns into client/editor.js, so both sides use the same list.
//
// Attributes a developer sets on purpose to keep password managers away (data-lpignore,
// data-1p-ignore, data-bwignore, data-form-type) are deliberately not on the list.

/** Custom-element tag names, matched against the lower-case tag name. */
export const JUNK_TAG = '^(grammarly|superhuman|lt|languagetool|deepl|wordtune|quillbot|ginger|prowritingaid|linguix|'
  + 'dashlane|lastpass|com-1password|onepassword|bitwarden|nordpass|protonpass|keeper|ddg|'
  + 'loom|merlin|monica|sider|maxai|harpa|plasmo|wxt|honey)(-|$)';

/** Attribute names, matched against the lower-case attribute name. */
export const JUNK_ATTR = '^(data-(gramm|grammarly|enable-grammarly|gr-|new-gr-|dashlane|lastpass-|lp-|com-onepassword|'
  + 'onepassword|bitwarden|np-|nordpass|protonpass|keeper|lt-|languagetool|deepl|wordtune|wt-|quillbot|'
  + 'darkreader|ddg-|kwimpala|plasmo|wxt|sider|monica|maxai|loom)|__gchrome)';

/** Inline-style declarations added by Dark Reader. */
export const JUNK_STYLE = '--darkreader-[a-z-]+\\s*:[^;]*;?';

/** Any element carrying this attribute is an extension's overlay, whatever its tag. */
export const JUNK_MARKER = 'data-grammarly-shadow-root';
