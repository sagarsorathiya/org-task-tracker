// ──────────────────────────────────────────────
// GET /api/integrations/addin/tokens — list current user's add-in tokens
// ──────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { logger } from '@/lib/logger';
import type { ApiResponse } from '@/types';

export interface AddinToken {
  id: number;
  device_label: string;
  created_at: string;
  last_used_at: string | null;
}

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const result = await query<AddinToken>(
      `SELECT id, device_label, created_at, last_used_at
       FROM addin_tokens
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [session.user.id]
    );

    return NextResponse.json<ApiResponse<AddinToken[]>>({
      success: true,
      data: result.rows,
    });
  } catch (err) {
    logger.error({ err }, 'Failed to list add-in tokens');
    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
