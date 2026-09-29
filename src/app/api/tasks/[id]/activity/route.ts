// ──────────────────────────────────────────────
// /api/tasks/[id]/activity — GET paginated activity timeline
// ──────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { logger } from '@/lib/logger';
import { canUserAccessTaskId } from '@/lib/authorization';
import type { TaskActivity, ApiResponse, PaginatedResponse } from '@/types';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Unauthorized' }, { status: 401 });

    const taskId = parseInt(params.id, 10);
    if (Number.isNaN(taskId)) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Invalid task ID' }, { status: 400 });
    }

    const canAccess = await canUserAccessTaskId(session.user, taskId);
    if (!canAccess) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)));
    const offset = (page - 1) * limit;

    const countResult = await query<{ count: string }>('SELECT COUNT(*) as count FROM task_activity WHERE task_id = $1', [taskId]);
    const total = parseInt(countResult.rows[0]?.count || '0', 10);

    const result = await query<TaskActivity>(
      `SELECT ta.*, u.display_name as user_display_name, u.username as user_name
       FROM task_activity ta JOIN users u ON ta.user_id = u.id
       WHERE ta.task_id = $1 ORDER BY ta.created_at DESC LIMIT $2 OFFSET $3`,
      [taskId, limit, offset]
    );

    return NextResponse.json<ApiResponse<PaginatedResponse<TaskActivity>>>({
      success: true,
      data: { items: result.rows, total, page, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    logger.error({ err }, 'GET /api/tasks/[id]/activity error');
    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
