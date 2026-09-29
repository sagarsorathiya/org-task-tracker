export function normalizeClientIp(rawIp: string): string {
  const value = (rawIp || '').trim();
  if (!value) return 'unknown';

  // Localhost IPv6 loopback => IPv4 loopback
  if (value === '::1') return '127.0.0.1';

  // IPv4-mapped IPv6 (e.g. ::ffff:192.168.1.10)
  if (value.startsWith('::ffff:')) {
    return value.slice('::ffff:'.length) || 'unknown';
  }

  return value;
}

export function getClientIpFromHeaders(headers?: Headers): string {
  if (!headers) return 'unknown';

  const forwardedFor = headers.get('x-forwarded-for') || '';
  if (forwardedFor) {
    const first = forwardedFor.split(',')[0]?.trim();
    if (first) return normalizeClientIp(first);
  }

  const realIp = headers.get('x-real-ip') || headers.get('x-client-ip') || '';
  return normalizeClientIp(realIp);
}
