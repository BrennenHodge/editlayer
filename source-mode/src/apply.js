// Change: write the new text into the source at the place `find` located, escaped for that kind of text,
// then check that the file still parses. Line endings, indentation and everything around the text stay as they were.

import ts from 'typescript';
import { contextFor, readOpts } from './find.js';
import { norm, normalizeWithMap } from './text.js';

/** Escapes plain text for the kind of source it goes into. */
export function escapeFor(ctx, text) {
  switch (ctx.kind) {
    case 'jsx':
      return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/\{/g, '&#123;').replace(/\}/g, '&#125;');
    case 'string':
      return text.replace(/\\/g, '\\\\').replace(new RegExp(ctx.quote, 'g'), '\\' + ctx.quote)
        .replace(/\r?\n/g, '\\n');
    case 'template':
      return text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
    case 'html':
      return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    case 'attr':
      return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;');
    case 'markdown':
      // keep it literal: escape characters that would start Markdown syntax at the beginning or inline
      return text.replace(/([\\`*_[\]<>])/g, '\\$1');
    case 'yaml':
      return text.replace(/\r?\n/g, ' ');
    default:
      throw new Error(`Can't write into ${ctx.kind} text`);
  }
}

const CODE = /\.(tsx|ts|jsx|js|mjs|cjs|mts|cts)$/i;

/** Syntax errors in a code or JSON file after an edit (empty when fine). */
export function syntaxErrors(file, raw) {
  if (/\.json$/i.test(file)) {
    try { JSON.parse(raw); return []; } catch (e) { return [e.message]; }
  }
  if (!CODE.test(file)) return [];
  const r = ts.transpileModule(raw, {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.Latest, module: ts.ModuleKind.ESNext },
  });
  return (r.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error)
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
}

/**
 * Applies edits to one file. edits: [{ start, end, kind, quote?, text }] with raw offsets into `raw`.
 * Applied from the end of the file backwards so earlier offsets stay valid. Overlapping edits are refused.
 * Returns the new file content or throws.
 */
export function applyToFile(file, raw, edits) {
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].end > sorted[i - 1].start) throw new Error(`Two changes overlap in ${file}`);
  }
  let out = raw;
  for (const e of sorted) {
    const ctx = contextFor(file, out, e.start, e.end);
    if (!ctx || ctx.kind !== e.kind) throw new Error(`The text in ${file} moved; find it again before publishing`);
    out = out.slice(0, e.start) + escapeFor(ctx, e.text) + out.slice(e.end);
  }
  const errors = syntaxErrors(file, out);
  if (errors.length) throw new Error(`${file} wouldn't build after this change: ${errors[0]}`);
  return out;
}

/** True when the normalized text at [start, end) of raw reads `text`. Used to double-check a write. */
export function readsAs(file, raw, start, end, text) {
  const n = normalizeWithMap(raw.slice(start, end), readOpts(file));
  return n.text === norm(text);
}
