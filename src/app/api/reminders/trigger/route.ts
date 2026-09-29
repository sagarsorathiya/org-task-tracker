// ──────────────────────────────────────────────
// POST /api/reminders/trigger — Manual reminder sweep (admin only)
// ──────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { runReminderSweep } from '@/lib/scheduler';
import type { ApiResponse } from '@/types';

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== 'admin') {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const force = searchParams.get('force') === 'true';

    const result = await runReminderSweep({ force });
    logger.info({ result, force }, 'Manual reminder sweep triggered');

    return NextResponse.json<ApiResponse<typeof result>>({ success: true, data: result });
  } catch (err) {
    logger.error({ err }, 'POST /api/reminders/trigger error');
    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
