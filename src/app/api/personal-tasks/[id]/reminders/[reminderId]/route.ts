import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { logger } from '@/lib/logger';
import type { ApiResponse } from '@/types';

type RouteContext = { params: Promise<{ id: string; reminderId: string }> };

export async function DELETE(_req: NextRequest, ctx: RouteContext): Promise<NextResponse<ApiResponse<null>>> {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  const userId = session.user.id;
  const { id, reminderId } = await ctx.params;
  const taskId = parseInt(id, 10);
  const rid = parseInt(reminderId, 10);
  if (isNaN(taskId) || isNaN(rid)) {
    return NextResponse.json({ success: false, error: 'Invalid id' }, { status: 400 });
  }

  try {
    const result = await query(
      `DELETE FROM personal_task_reminders
       WHERE id = $1 AND task_id = $2 AND user_id = $3`,
      [rid, taskId, userId]
    );
    if ((result.rowCount ?? 0) === 0) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }
    await query(
      `INSERT INTO personal_task_activity (task_id, user_id, action, meta)
       VALUES ($1, $2, 'reminder_deleted', $3)`,
      [taskId, userId, JSON.stringify({ reminder_id: rid })]
    );
    return NextResponse.json({ success: true, data: null });
  } catch (err) {
    logger.error({ err }, 'Failed to delete personal reminder');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
