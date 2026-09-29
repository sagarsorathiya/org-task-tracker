// ──────────────────────────────────────────────
// Shared attachment MIME/extension allowlist + magic-byte content sniffing.
// Used by task and transaction reminder attachment upload routes — keep in
// sync so the allowlist never drifts between the two.
// ──────────────────────────────────────────────

export const DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.ms-word.document.macroenabled.12',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
  'application/vnd.ms-excel',
  'application/vnd.ms-excel.sheet.macroenabled.12',
  'application/vnd.ms-excel.sheet.binary.macroenabled.12',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.template',
  'application/vnd.ms-powerpoint',
  'application/vnd.ms-powerpoint.presentation.macroenabled.12',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.presentationml.template',
  'application/rtf',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
  'application/json',
  'application/xml',
  'text/xml',
  'message/rfc822',
]);

export const ALLOWED_EXTENSIONS = new Set([
  'txt', 'csv', 'tsv', 'log', 'md', 'json', 'xml',
  'pdf', 'doc', 'docx', 'dotx', 'docm',
  'xls', 'xlsx', 'xlsm', 'xlsb', 'xltx',
  'ppt', 'pptx', 'pptm', 'potx',
  'rtf', 'odt', 'ods', 'odp',
  'eml', 'msg',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'svg', 'heic', 'heif',
]);

export function isAllowedAttachment(file: File): boolean {
  const mime = (file.type || '').toLowerCase();
  const ext = file.name.includes('.') ? file.name.split('.').pop()?.toLowerCase() : '';

  if (mime.startsWith('image/')) {
    return true;
  }

  if (mime.startsWith('text/')) {
    return true;
  }

  if (DOCUMENT_MIME_TYPES.has(mime)) {
    return true;
  }

  if (ext && ALLOWED_EXTENSIONS.has(ext)) {
    return true;
  }

  return false;
}

// Returns a label if the buffer contains a dangerous file type regardless of MIME/extension.
export function detectDangerousContent(buf: Buffer): string | null {
  if (buf.length < 2) return null;

  // Windows PE executable: MZ header
  if (buf[0] === 0x4D && buf[1] === 0x5A) return 'Windows executable (MZ)';
  // ELF (Linux) executable
  if (buf[0] === 0x7F && buf[1] === 0x45 && buf[2] === 0x4C && buf[3] === 0x46) return 'ELF executable';

  // HTML/script detection from text start (SVG with inline script, raw HTML, etc.)
  const head = buf.subarray(0, 512).toString('utf8').replace(/^﻿/, '').trimStart().toLowerCase();
  if (head.startsWith('<!doctype html') || head.startsWith('<html') || head.startsWith('<script')) {
    return 'HTML/script document';
  }

  return null;
}
