// ──────────────────────────────────────────────
// /api/notifications — GET and POST (mark read)
// ──────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { logger } from '@/lib/logger';
import { ensureSchedulerInitialized } from '@/lib/scheduler-init';
import { z } from 'zod';
import type { Notification, ApiResponse } from '@/types';

const markReadSchema = z.object({
  id: z.number().int().positive().optional(),
  readAll: z.boolean().optional(),
});

export async function GET() {
  try {
    ensureSchedulerInitialized();

    const session = await auth();
    if (!session?.user) return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Unauthorized' }, { status: 401 });

    // Local admin fallback session when DB is unavailable.
    if (Number(session.user.id) === -1) {
      return NextResponse.json<ApiResponse<Notification[]>>({ success: true, data: [] });
    }

    const result = await query<Notification>(
      `SELECT * FROM notifications WHERE user_id = $1
       ORDER BY is_read ASC, created_at DESC LIMIT 50`,
      [session.user.id]
    );

    return NextResponse.json<ApiResponse<Notification[]>>({ success: true, data: result.rows });
  } catch (err) {
    logger.error({ err }, 'GET /api/notifications error');
    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Unauthorized' }, { status: 401 });

    // Local admin fallback session when DB is unavailable.
    if (Number(session.user.id) === -1) {
      return NextResponse.json<ApiResponse<null>>({ success: true });
    }

    const body = await req.json();
    const parsed = markReadSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Invalid input' }, { status: 400 });
    }

    if (parsed.data.readAll) {
      await query('UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false', [session.user.id]);
    } else if (parsed.data.id) {
      await query('UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2', [parsed.data.id, session.user.id]);
    }

    return NextResponse.json<ApiResponse<null>>({ success: true });
  } catch (err) {
    logger.error({ err }, 'POST /api/notifications error');
    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
