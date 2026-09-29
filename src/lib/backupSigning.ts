import crypto from 'crypto';

const HEADER_META = '-- ORG_BACKUP_META '; 
const HEADER_SIG = '-- ORG_BACKUP_SIG ';

function getSigningSecret(): string | null {
  return process.env.BACKUP_SIGNING_SECRET || null;
}

export function signBackup(sqlBody: string, meta: Record<string, unknown>): string {
  const secret = getSigningSecret();
  if (!secret) {
    return sqlBody;
  }

  const hash = crypto.createHash('sha256').update(sqlBody, 'utf8').digest('hex');
  const metaWithHash = { ...meta, sha256: hash };
  const metaJson = JSON.stringify(metaWithHash);
  const signature = crypto.createHmac('sha256', secret).update(metaJson).digest('hex');

  return `${HEADER_META}${metaJson}\n${HEADER_SIG}${signature}\n${sqlBody}`;
}

export function verifySignedBackup(content: string): { valid: boolean; reason?: string; unsigned?: boolean } {
  const secret = getSigningSecret();
  if (!secret) {
    return { valid: true };
  }

  const lines = content.split(/\r?\n/);
  const metaLine = lines[0] || '';
  const sigLine = lines[1] || '';

  if (!metaLine.startsWith(HEADER_META) || !sigLine.startsWith(HEADER_SIG)) {
    return { valid: false, unsigned: true, reason: 'Backup signature header missing' };
  }

  const metaJson = metaLine.slice(HEADER_META.length).trim();
  const sig = sigLine.slice(HEADER_SIG.length).trim();
  const expected = crypto.createHmac('sha256', secret).update(metaJson).digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return { valid: false, reason: 'Backup signature mismatch' };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(metaJson) as Record<string, unknown>;
  } catch {
    return { valid: false, reason: 'Backup metadata is invalid' };
  }

  const sqlBody = lines.slice(2).join('\n');
  const hash = crypto.createHash('sha256').update(sqlBody, 'utf8').digest('hex');
  if (parsed.sha256 !== hash) {
    return { valid: false, reason: 'Backup content hash mismatch' };
  }

  return { valid: true };
}
