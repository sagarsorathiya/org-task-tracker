// Zero-dependency .eml (RFC 822/2045 MIME) parser for inline preview.
// Extracts headers + the best human-readable body part — no external mail library required.

import { sanitizeRichText } from '@/lib/sanitize';

export interface ParsedEml {
  from: string;
  to: string;
  cc: string;
  subject: string;
  date: string;
  isHtml: boolean;
  body: string;
}

const CHARSET_ALIASES: Record<string, BufferEncoding> = {
  'utf-8': 'utf8', utf8: 'utf8',
  'us-ascii': 'ascii', ascii: 'ascii',
  'iso-8859-1': 'latin1', latin1: 'latin1', 'windows-1252': 'latin1',
  'utf-16le': 'utf16le', 'utf-16': 'utf16le',
};

function resolveEncoding(charset: string | undefined): BufferEncoding {
  if (!charset) return 'utf8';
  return CHARSET_ALIASES[charset.trim().toLowerCase()] || 'utf8';
}

function decodeQuotedPrintable(input: string, charset: string | undefined): string {
  const bytes: number[] = [];
  const normalized = input.replace(/=\r?\n/g, ''); // soft line breaks
  for (let i = 0; i < normalized.length; i++) {
    if (normalized[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(normalized.slice(i + 1, i + 3))) {
      bytes.push(parseInt(normalized.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(normalized.charCodeAt(i));
    }
  }
  return Buffer.from(bytes).toString(resolveEncoding(charset));
}

// Decodes RFC 2047 encoded-words in header values, e.g. =?UTF-8?B?...?= / =?UTF-8?Q?...?=
function decodeHeaderValue(value: string): string {
  return value.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, charset, enc, text) => {
    const encoding = resolveEncoding(charset);
    if (enc.toLowerCase() === 'b') {
      return Buffer.from(text, 'base64').toString(encoding);
    }
    return decodeQuotedPrintable(text.replace(/_/g, ' '), charset);
  }).replace(/\s+/g, ' ').trim();
}

function parseHeaders(block: string): Record<string, string> {
  const headers: Record<string, string> = {};
  const lines = block.split(/\r?\n/);
  let currentKey = '';
  for (const line of lines) {
    if (/^[ \t]/.test(line) && currentKey) {
      headers[currentKey] += ' ' + line.trim();
      continue;
    }
    const m = line.match(/^([^:]+):\s*(.*)$/);
    if (m) {
      currentKey = m[1].toLowerCase().trim();
      headers[currentKey] = m[2];
    }
  }
  return headers;
}

function getHeaderParam(headerValue: string, param: string): string | undefined {
  const re = new RegExp(`${param}\\s*=\\s*"?([^";]+)"?`, 'i');
  const m = headerValue.match(re);
  return m ? m[1].trim() : undefined;
}

interface MimePart {
  contentType: string;
  charset?: string;
  encoding?: string;
  disposition?: string;
  body: string;
}

function splitOnBoundary(body: string, boundary: string): string[] {
  const marker = `--${boundary}`;
  const segments = body.split(marker);
  // First segment is preamble, last segment after the closing "--" marker is the epilogue
  return segments.slice(1, -1).map((s) => s.replace(/^\r?\n/, '').replace(/\r?\n$/, ''));
}

function parsePart(raw: string): MimePart {
  const sep = raw.search(/\r?\n\r?\n/);
  const headerBlock = sep === -1 ? raw : raw.slice(0, sep);
  const bodyBlock = sep === -1 ? '' : raw.slice(sep).replace(/^\r?\n\r?\n/, '');
  const headers = parseHeaders(headerBlock);
  const contentTypeHeader = headers['content-type'] || 'text/plain';
  const contentType = contentTypeHeader.split(';')[0].trim().toLowerCase();
  return {
    contentType,
    charset: getHeaderParam(contentTypeHeader, 'charset'),
    encoding: (headers['content-transfer-encoding'] || '').toLowerCase().trim(),
    disposition: (headers['content-disposition'] || '').toLowerCase(),
    body: bodyBlock,
  };
}

function decodeBody(part: MimePart): string {
  if (part.encoding === 'base64') {
    const clean = part.body.replace(/\s+/g, '');
    return Buffer.from(clean, 'base64').toString(resolveEncoding(part.charset));
  }
  if (part.encoding === 'quoted-printable') {
    return decodeQuotedPrintable(part.body, part.charset);
  }
  return part.body;
}

// Walks (possibly nested) multipart bodies to find the best text/plain or text/html part,
// preferring HTML, and skipping attachment-disposition parts.
function findBestTextPart(raw: string, contentTypeHeader: string, depth = 0): { isHtml: boolean; text: string } | null {
  if (depth > 5) return null;
  const contentType = contentTypeHeader.split(';')[0].trim().toLowerCase();

  if (contentType.startsWith('multipart/')) {
    const boundary = getHeaderParam(contentTypeHeader, 'boundary');
    if (!boundary) return null;
    const segments = splitOnBoundary(raw, boundary);
    let htmlResult: { isHtml: boolean; text: string } | null = null;
    let plainResult: { isHtml: boolean; text: string } | null = null;
    for (const segment of segments) {
      const part = parsePart(segment);
      if (part.disposition?.startsWith('attachment')) continue;
      if (part.contentType.startsWith('multipart/')) {
        const sepIdx = segment.search(/\r?\n\r?\n/);
        const headerBlock = sepIdx === -1 ? segment : segment.slice(0, sepIdx);
        const headers = parseHeaders(headerBlock);
        const nested = findBestTextPart(segment.slice(sepIdx).replace(/^\r?\n\r?\n/, ''), headers['content-type'] || '', depth + 1);
        if (nested?.isHtml && !htmlResult) htmlResult = nested;
        else if (nested && !nested.isHtml && !plainResult) plainResult = nested;
        continue;
      }
      if (part.contentType === 'text/html' && !htmlResult) {
        htmlResult = { isHtml: true, text: decodeBody(part) };
      } else if (part.contentType === 'text/plain' && !plainResult) {
        plainResult = { isHtml: false, text: decodeBody(part) };
      }
    }
    return htmlResult || plainResult;
  }

  if (contentType === 'text/html' || contentType === 'text/plain') {
    const part = parsePart(raw);
    return { isHtml: contentType === 'text/html', text: decodeBody(part) };
  }

  return null;
}

export function parseEml(buffer: Buffer): ParsedEml {
  const raw = buffer.toString('latin1');
  const sep = raw.search(/\r?\n\r?\n/);
  const headerBlock = sep === -1 ? raw : raw.slice(0, sep);
  const bodyBlock = sep === -1 ? '' : raw.slice(sep).replace(/^\r?\n\r?\n/, '');
  const headers = parseHeaders(headerBlock);

  const contentTypeHeader = headers['content-type'] || 'text/plain';
  const best = findBestTextPart(bodyBlock, contentTypeHeader) || { isHtml: false, text: bodyBlock };

  return {
    from: decodeHeaderValue(headers['from'] || ''),
    to: decodeHeaderValue(headers['to'] || ''),
    cc: decodeHeaderValue(headers['cc'] || ''),
    subject: decodeHeaderValue(headers['subject'] || '(no subject)'),
    date: headers['date'] || '',
    isHtml: best.isHtml,
    body: best.isHtml ? sanitizeRichText(best.text) : best.text,
  };
}
