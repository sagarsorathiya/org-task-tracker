import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { logger } from '@/lib/logger';
import type { ApiResponse, PersonalActivity } from '@/types';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: RouteContext): Promise<NextResponse<ApiResponse<PersonalActivity[]>>> {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  const userId = session.user.id;
  const { id } = await ctx.params;
  const taskId = parseInt(id, 10);
  if (isNaN(taskId)) return NextResponse.json({ success: false, error: 'Invalid id' }, { status: 400 });

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
  const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') ?? '20', 10)));
  const offset = (page - 1) * limit;

  const owns = await query(
    `SELECT 1 FROM personal_tasks WHERE id = $1 AND user_id = $2`,
    [taskId, userId]
  );
  if ((owns.rowCount ?? 0) === 0) {
    return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
  }

  try {
    const result = await query<PersonalActivity>(
      `SELECT a.*, u.display_name
       FROM personal_task_activity a
       JOIN users u ON u.id = a.user_id
       WHERE a.task_id = $1 AND a.user_id = $2
       ORDER BY a.created_at DESC
       LIMIT $3 OFFSET $4`,
      [taskId, userId, limit, offset]
    );
    return NextResponse.json({ success: true, data: result.rows });
  } catch (err) {
    logger.error({ err }, 'Failed to fetch personal task activity');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
