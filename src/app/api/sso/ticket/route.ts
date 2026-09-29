import { NextRequest, NextResponse } from 'next/server';
import { getSecret } from '@/lib/secrets';
import { mintSsoTicket } from '@/lib/ssoTicket';
import { logger } from '@/lib/logger';
import crypto from 'crypto';

// Reads request headers and env at request time.
export const dynamic = 'force-dynamic';

/**
 * Called only by the IIS auth bridge (`_authbridge/negotiate.aspx`) over
 * 127.0.0.1 — never by a browser. The bridge runs inside the ASP.NET pipeline,
 * where the Windows identity is actually available, and passes it here along
 * with the shared proxy secret. We return a short-lived signed ticket that the
 * login page then presents to the normal NextAuth sign-in POST.
 */
export async function GET(req: NextRequest) {
  const ssoEnabled = process.env.SSO_ENABLED === 'true';
  const secret = getSecret('SSO_PROXY_SHARED_SECRET', '');
  // Deliberately NOT SSO_PROXY_SHARED_SECRET: the IIS rewrite rule injects that
  // one onto every proxied request, so it proves nothing here — an anonymous
  // internet request would arrive already carrying it. This secret is known only
  // to the auth bridge, which calls this route directly over loopback.
  const bridgeSecret = getSecret('SSO_BRIDGE_SHARED_SECRET', '');

  if (!ssoEnabled || !secret || !bridgeSecret) {
    return NextResponse.json({ success: false, error: 'Domain SSO is not enabled' }, { status: 404 });
  }

  const incoming = req.headers.get('x-sso-bridge-secret') || '';
  const a = crypto.createHash('sha256').update(incoming).digest();
  const b = crypto.createHash('sha256').update(bridgeSecret).digest();
  if (!incoming || !crypto.timingSafeEqual(a, b)) {
    logger.warn({ path: '/api/sso/ticket' }, 'SSO ticket request without a valid bridge secret');
    return NextResponse.json({ success: false, error: 'Untrusted request' }, { status: 403 });
  }

  const identity = (req.headers.get('x-remote-user') || '').trim();
  if (!identity) {
    return NextResponse.json({ success: false, error: 'No domain identity supplied' }, { status: 400 });
  }

  return NextResponse.json({ success: true, data: { ticket: mintSsoTicket(identity, secret) } });
}
