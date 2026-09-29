// ──────────────────────────────────────────────
// GET /api/reminders/logs — Paginated reminder logs
// ──────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { logger } from '@/lib/logger';
import { buildTaskScopeSql } from '@/lib/authorization';
import type { ReminderLog, ApiResponse, PaginatedResponse } from '@/types';

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Unauthorized' }, { status: 401 });

    if (Number(session.user.id) === -1) {
      const page = Math.max(1, parseInt(new URL(req.url).searchParams.get('page') || '1', 10));
      return NextResponse.json<ApiResponse<PaginatedResponse<ReminderLog>>>({
        success: true,
        data: { items: [], total: 0, page, totalPages: 0 },
      });
    }

    const { searchParams } = new URL(req.url);
    const taskId = searchParams.get('taskId');
    const status = searchParams.get('status');
    const channel = searchParams.get('channel');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)));
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    const scopeSql = await buildTaskScopeSql(session.user, { tableAlias: 't', startIndex: idx });
    if (!scopeSql.hasAccess) {
      return NextResponse.json<ApiResponse<PaginatedResponse<ReminderLog>>>({
        success: true,
        data: { items: [], total: 0, page, totalPages: 0 },
      });
    }
    if (scopeSql.clause) {
      conditions.push(scopeSql.clause);
      params.push(...scopeSql.params);
      idx = scopeSql.nextIndex;
    }

    if (taskId) { conditions.push(`rl.task_id = $${idx++}`); params.push(parseInt(taskId, 10)); }
    if (status) { conditions.push(`rl.status = $${idx++}`); params.push(status); }
    if (channel) { conditions.push(`rl.channel = $${idx++}`); params.push(channel); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await query<{ count: string }>(
      `SELECT COUNT(*) as count
       FROM reminder_logs rl
       LEFT JOIN tasks t ON rl.task_id = t.id
       ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0]?.count || '0', 10);

    const result = await query<ReminderLog>(
      `SELECT rl.*, t.title as task_title
       FROM reminder_logs rl
       LEFT JOIN tasks t ON rl.task_id = t.id
       ${where}
       ORDER BY rl.sent_at DESC
       LIMIT $${idx++} OFFSET $${idx}`,
      [...params, limit, offset]
    );

    return NextResponse.json<ApiResponse<PaginatedResponse<ReminderLog>>>({
      success: true,
      data: { items: result.rows, total, page, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    logger.error({ err }, 'GET /api/reminders/logs error');
    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
