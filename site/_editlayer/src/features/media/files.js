// Document uploads: which files are allowed, how their contents are checked, and safe names.
// A file must have an allowed extension AND look like that kind of file inside (magic bytes,
// the parts list of an Office file, no binary bytes in a text file).

export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export const FILE_TYPES = {
  pdf: { type: 'application/pdf', label: 'PDF', inline: true },
  docx: { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', label: 'Word', zipDir: 'word/' },
  xlsx: { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', label: 'Excel', zipDir: 'xl/' },
  pptx: { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', label: 'PowerPoint', zipDir: 'ppt/' },
  txt: { type: 'text/plain; charset=utf-8', label: 'Text', text: true },
  csv: { type: 'text/csv; charset=utf-8', label: 'CSV', text: true },
};

export const extOf = (name) => (String(name || '').toLowerCase().match(/\.([a-z0-9]{1,5})$/) || [])[1] || '';

/** A file name that is safe in a URL path and an R2 key: letters, digits, dot, dash, underscore. */
export function safeName(original, ext) {
  let base = String(original || '').replace(/\.[a-z0-9]{1,5}$/i, '');
  base = base.normalize('NFKD').replace(/[̀-ͯ]/g, '');
  base = base.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/[-.]{2,}/g, '-').replace(/^[-._]+|[-._]+$/g, '').slice(0, 80);
  return `${base || 'file'}.${ext}`;
}

export const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}\.(pdf|docx|xlsx|pptx|txt|csv)$/;
export const ID_RE = /^[a-z0-9]{10}$/;

const ascii = (bytes, from, len) => String.fromCharCode(...bytes.subarray(from, from + len));

/** Names of the entries in a ZIP file, read from its central directory (end of the file). */
function zipEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const min = Math.max(0, bytes.length - 65557);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= min; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const names = [];
  for (let n = 0; n < count && n < 5000; n++) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== 0x02014b50) return names.length ? names : null;
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    names.push(ascii(bytes, p + 46, Math.min(nameLen, 300)));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

/**
 * Checks that the bytes match the extension. Returns null when the file is fine, or a message for
 * the editor when it isn't.
 */
export function checkContents(ext, bytes) {
  const spec = FILE_TYPES[ext];
  if (!spec) return 'Use a PDF, Word (.docx), Excel (.xlsx), PowerPoint (.pptx), text (.txt) or CSV file.';
  if (!bytes.length) return 'That file is empty.';
  if (ext === 'pdf') {
    // "%PDF-" must appear near the start (a few writers put a little junk first).
    const head = ascii(bytes, 0, Math.min(bytes.length, 1024));
    return head.includes('%PDF-') ? null : 'That file doesn’t look like a real PDF. Try saving it as PDF again.';
  }
  if (spec.zipDir) {
    const bad = `That file doesn’t look like a real ${spec.label} file. Open it in ${spec.label} and save it again as .${ext}.`;
    if (bytes.length < 30 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) return bad;
    const names = zipEntries(bytes);
    if (!names || !names.includes('[Content_Types].xml') || !names.some((n) => n.startsWith(spec.zipDir))) return bad;
    // Macro-enabled documents (.docm etc. renamed to .docx) carry a vbaProject part.
    if (names.some((n) => /vbaproject\.bin$/i.test(n))) return 'Files with macros can’t be uploaded. Save it as a normal document without macros.';
    return null;
  }
  if (spec.text) {
    const head = bytes.subarray(0, Math.min(bytes.length, 65536));
    if (head.includes(0)) return `That doesn’t look like a plain ${spec.label === 'CSV' ? 'CSV' : 'text'} file.`;
    return null;
  }
  return null;
}
