import crypto from 'crypto';

const DEFAULT_TTL_SECONDS = 10 * 60;

function getSecret(): string {
  return process.env.DB_RESTORE_APPROVAL_SECRET || process.env.NEXTAUTH_SECRET || 'unsafe-dev-secret';
}

export function issueRestoreApprovalToken(input: { userId: number; reason: string; ttlSeconds?: number }): string {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + (input.ttlSeconds || DEFAULT_TTL_SECONDS);
  const payload = {
    userId: input.userId,
    reason: input.reason,
    iat: now,
    exp,
    nonce: crypto.randomUUID(),
  };

  const payloadBase64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', getSecret()).update(payloadBase64).digest('base64url');
  return `${payloadBase64}.${sig}`;
}

export function verifyRestoreApprovalToken(token: string, expectedUserId: number): { valid: boolean; reason?: string } {
  const [payloadBase64, sig] = token.split('.');
  if (!payloadBase64 || !sig) {
    return { valid: false, reason: 'Malformed token' };
  }

  const expectedSig = crypto.createHmac('sha256', getSecret()).update(payloadBase64).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
    return { valid: false, reason: 'Invalid token signature' };
  }

  let payload: { userId: number; exp: number };
  try {
    payload = JSON.parse(Buffer.from(payloadBase64, 'base64url').toString('utf8')) as { userId: number; exp: number };
  } catch {
    return { valid: false, reason: 'Invalid token payload' };
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) {
    return { valid: false, reason: 'Token expired' };
  }

  if (payload.userId !== expectedUserId) {
    return { valid: false, reason: 'Token user mismatch' };
  }

  return { valid: true };
}
