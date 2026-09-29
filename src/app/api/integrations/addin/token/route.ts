// ──────────────────────────────────────────────
// /api/integrations/addin/token — generate per-user add-in Bearer token
// Inserts into addin_tokens table (supports multiple devices per user)
// ──────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { logger } from '@/lib/logger';
import crypto from 'crypto';
import type { ApiResponse } from '@/types';

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (Number(session.user.id) === -1) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Database unavailable', errorCode: 'DB_UNAVAILABLE' }, { status: 503 });
    }

    // Optional device label from request body
    let deviceLabel = 'My Device';
    try {
      const body = await req.json();
      if (typeof body?.deviceLabel === 'string' && body.deviceLabel.trim()) {
        deviceLabel = body.deviceLabel.trim().slice(0, 80);
      }
    } catch {
      // no body / not JSON — use default label
    }

    const plaintext = crypto.randomBytes(32).toString('hex');
    const hash = crypto.createHash('sha256').update(plaintext).digest('hex');

    const result = await query<{ id: number }>(
      `INSERT INTO addin_tokens (user_id, token_hash, device_label)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [session.user.id, hash, deviceLabel]
    );

    logger.info({ userId: session.user.id, tokenId: result.rows[0]?.id, deviceLabel }, 'Add-in token generated');

    return NextResponse.json<ApiResponse<{ token: string; tokenId: number; deviceLabel: string }>>({
      success: true,
      data: { token: plaintext, tokenId: result.rows[0]!.id, deviceLabel },
    });
  } catch (err) {
    logger.error({ err }, 'Failed to generate add-in token');
    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
