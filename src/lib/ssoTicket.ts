import crypto from 'crypto';

/**
 * Short-lived signed tickets that carry a Windows identity from the IIS auth
 * bridge (`_authbridge/negotiate.aspx`) to the NextAuth sign-in POST.
 *
 * Why a ticket instead of just forwarding an identity header on every request:
 * IIS URL Rewrite expands `{LOGON_USER}` at BeginRequest, which runs *before*
 * Windows authentication, so a proxied `x-forwarded-user` header is always
 * empty. Only code running inside the ASP.NET pipeline sees the authenticated
 * identity, and that code cannot itself perform the NextAuth sign-in — hence
 * the hand-off.
 */

const TICKET_TTL_SECONDS = 120;

function b64url(input: Buffer): string {
  return input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(input: string): Buffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded + '='.repeat((4 - (padded.length % 4)) % 4), 'base64');
}

function sign(payload: string, secret: string): string {
  return b64url(crypto.createHmac('sha256', secret).update(payload).digest());
}

/** Mint a ticket for a raw Windows identity (e.g. `DOMAIN\username`). */
export function mintSsoTicket(identity: string, secret: string): string {
  const body = b64url(
    Buffer.from(
      JSON.stringify({ identity, exp: Math.floor(Date.now() / 1000) + TICKET_TTL_SECONDS }),
      'utf8'
    )
  );
  return `${body}.${sign(body, secret)}`;
}

export type SsoTicketResult =
  | { valid: true; identity: string }
  | { valid: false; reason: 'malformed' | 'bad_signature' | 'expired' };

/** Verify a ticket and return the identity it carries. */
export function verifySsoTicket(ticket: string, secret: string): SsoTicketResult {
  const parts = (ticket || '').split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { valid: false, reason: 'malformed' };

  const expected = sign(parts[0], secret);
  const a = Buffer.from(parts[1]);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { valid: false, reason: 'bad_signature' };
  }

  let parsed: { identity?: unknown; exp?: unknown };
  try {
    parsed = JSON.parse(fromB64url(parts[0]).toString('utf8'));
  } catch {
    return { valid: false, reason: 'malformed' };
  }

  if (typeof parsed.identity !== 'string' || !parsed.identity || typeof parsed.exp !== 'number') {
    return { valid: false, reason: 'malformed' };
  }
  if (parsed.exp < Math.floor(Date.now() / 1000)) {
    return { valid: false, reason: 'expired' };
  }

  return { valid: true, identity: parsed.identity };
}
