// Zero-dependency HTML sanitizer — no jsdom/DOMParser required.
// Preserves rich-text formatting tags (bold, italic, tables, lists)
// while stripping scripts, event handlers, and dangerous protocols.

const ALLOWED_TAGS = new Set([
  'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'sub', 'sup',
  'p', 'div', 'span', 'br', 'hr',
  'ul', 'ol', 'li',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'pre', 'code',
]);

const ALLOWED_ATTRS = new Set([
  'style', 'class', 'colspan', 'rowspan', 'align', 'valign', 'width', 'height', 'border',
]);

const DANGEROUS_PROTOCOLS = /^\s*(javascript|vbscript|data)\s*:/i;

function sanitizeAttrValue(name: string, value: string): string | null {
  const decoded = value.replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
                       .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)));
  if ((name === 'href' || name === 'src' || name === 'action') && DANGEROUS_PROTOCOLS.test(decoded)) {
    return null;
  }
  return value;
}

function sanitizeAttributes(rawAttrs: string): string {
  const result: string[] = [];
  // Match name="value", name='value', or name=value
  const attrRe = /\s+([\w-]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*)))?/g;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(rawAttrs)) !== null) {
    const name = m[1].toLowerCase();
    // Block all on* event handlers
    if (/^on/i.test(name)) continue;
    if (!ALLOWED_ATTRS.has(name)) continue;
    const value = m[2] ?? m[3] ?? m[4] ?? '';
    const safe = sanitizeAttrValue(name, value);
    if (safe === null) continue;
    result.push(`${name}="${safe.replace(/"/g, '&quot;')}"`);
  }
  return result.length ? ' ' + result.join(' ') : '';
}

/**
 * Sanitize rich-text HTML (task descriptions, comments) before storing or rendering.
 * Preserves formatting tags while stripping scripts, event handlers, and javascript: URLs.
 * Zero external dependencies — works in Node.js API routes and browser components.
 */
export function sanitizeRichText(html: string): string {
  if (!html) return html;

  return html
    // Remove block-level dangerous elements with their contents
    .replace(/<(script|style|iframe|object|embed|form|math|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    // Remove void/self-closing dangerous elements
    .replace(/<(script|style|iframe|object|embed|form|input|button|base|link|meta)\b[^>]*\/?>/gi, '')
    // Process remaining tags: allow safe ones, strip the rest (keep text content)
    .replace(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)(\/?)\s*>/g, (_, slash, rawTag, attrs, selfClose) => {
      const tag = rawTag.toLowerCase();
      if (!ALLOWED_TAGS.has(tag)) return '';
      if (slash) return `</${tag}>`;
      const safeAttrs = sanitizeAttributes(attrs);
      return selfClose ? `<${tag}${safeAttrs} />` : `<${tag}${safeAttrs}>`;
    });
}
