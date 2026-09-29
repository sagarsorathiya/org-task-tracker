import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { logger } from '@/lib/logger';
import { getClientIpFromHeaders } from '@/lib/request-ip';

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const clientIp = getClientIpFromHeaders(req.headers);
    const userAgent = req.headers.get('user-agent') || 'unknown';

    await query(
      `INSERT INTO audit_log (actor_id, entity_type, entity_id, action, diff)
       VALUES ($1, 'auth', 0, 'logout', $2)`,
      [session.user.id || null, JSON.stringify({ username: session.user.username, clientIp, userAgent })]
    );

    return NextResponse.json({ success: true });
  } catch (err) {
    logger.warn({ err }, 'Failed to persist logout audit event');
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
