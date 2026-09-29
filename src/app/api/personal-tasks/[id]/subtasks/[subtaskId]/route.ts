// ──────────────────────────────────────────────
// /api/personal-tasks/[id]/subtasks/[subtaskId] — PATCH toggle, DELETE
// ──────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { logger } from '@/lib/logger';
import type { ApiResponse, PersonalSubtask } from '@/types';

type RouteContext = { params: Promise<{ id: string; subtaskId: string }> };

async function getOwnedSubtask(taskId: number, subtaskId: number, userId: number) {
  const r = await query<PersonalSubtask>(
    `SELECT s.* FROM personal_task_subtasks s
     JOIN personal_tasks pt ON pt.id = s.task_id
     WHERE s.id = $1 AND s.task_id = $2 AND pt.user_id = $3`,
    [subtaskId, taskId, userId]
  );
  return r.rows[0] ?? null;
}

export async function PATCH(_req: NextRequest, ctx: RouteContext): Promise<NextResponse<ApiResponse<PersonalSubtask>>> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;
  const { id, subtaskId } = await ctx.params;
  const taskId = parseInt(id, 10);
  const sId = parseInt(subtaskId, 10);
  if (isNaN(taskId) || isNaN(sId)) return NextResponse.json({ success: false, error: 'Invalid id' }, { status: 400 });

  const existing = await getOwnedSubtask(taskId, sId, userId);
  if (!existing) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

  try {
    const result = await query<PersonalSubtask>(
      `UPDATE personal_task_subtasks SET is_done = $2 WHERE id = $1 RETURNING *`,
      [sId, !existing.is_done]
    );
    await query(
      `INSERT INTO personal_task_activity (task_id, user_id, action, meta) VALUES ($1, $2, 'subtask_toggled', $3)`,
      [taskId, userId, JSON.stringify({ title: existing.title, is_done: !existing.is_done })]
    );
    return NextResponse.json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error({ err }, 'Failed to toggle personal subtask');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, ctx: RouteContext): Promise<NextResponse<ApiResponse<null>>> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;
  const { id, subtaskId } = await ctx.params;
  const taskId = parseInt(id, 10);
  const sId = parseInt(subtaskId, 10);
  if (isNaN(taskId) || isNaN(sId)) return NextResponse.json({ success: false, error: 'Invalid id' }, { status: 400 });

  const existing = await getOwnedSubtask(taskId, sId, userId);
  if (!existing) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

  try {
    await query('DELETE FROM personal_task_subtasks WHERE id = $1', [sId]);
    return NextResponse.json({ success: true, data: null });
  } catch (err) {
    logger.error({ err }, 'Failed to delete personal subtask');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
