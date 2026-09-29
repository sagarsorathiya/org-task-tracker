// ──────────────────────────────────────────────
// /api/personal-tasks/[id]/subtasks — GET list, POST create
// ──────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { logger } from '@/lib/logger';
import { z } from 'zod';
import type { ApiResponse, PersonalSubtask } from '@/types';

const createSchema = z.object({
  title: z.string().min(1).max(500),
});

type RouteContext = { params: Promise<{ id: string }> };

async function ownsTask(taskId: number, userId: number): Promise<boolean> {
  const r = await query<{ id: number }>(
    'SELECT id FROM personal_tasks WHERE id = $1 AND user_id = $2',
    [taskId, userId]
  );
  return (r.rowCount ?? 0) > 0;
}

export async function GET(_req: NextRequest, ctx: RouteContext): Promise<NextResponse<ApiResponse<PersonalSubtask[]>>> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;
  const { id } = await ctx.params;
  const taskId = parseInt(id, 10);
  if (isNaN(taskId)) return NextResponse.json({ success: false, error: 'Invalid id' }, { status: 400 });

  if (!(await ownsTask(taskId, userId))) {
    return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
  }

  try {
    const result = await query<PersonalSubtask>(
      `SELECT * FROM personal_task_subtasks WHERE task_id = $1 ORDER BY sort_order, id`,
      [taskId]
    );
    return NextResponse.json({ success: true, data: result.rows });
  } catch (err) {
    logger.error({ err }, 'Failed to fetch personal subtasks');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse<ApiResponse<PersonalSubtask>>> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;
  const { id } = await ctx.params;
  const taskId = parseInt(id, 10);
  if (isNaN(taskId)) return NextResponse.json({ success: false, error: 'Invalid id' }, { status: 400 });

  if (!(await ownsTask(taskId, userId))) {
    return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
  }

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.errors[0].message }, { status: 422 });
  }

  try {
    const maxOrder = await query<{ max: number }>(
      'SELECT COALESCE(MAX(sort_order), -1) + 1 AS max FROM personal_task_subtasks WHERE task_id = $1',
      [taskId]
    );
    const sortOrder = maxOrder.rows[0]?.max ?? 0;

    const result = await query<PersonalSubtask>(
      `INSERT INTO personal_task_subtasks (task_id, user_id, title, sort_order)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [taskId, userId, parsed.data.title, sortOrder]
    );
    await query(
      `INSERT INTO personal_task_activity (task_id, user_id, action, meta) VALUES ($1, $2, 'subtask_added', $3)`,
      [taskId, userId, JSON.stringify({ title: parsed.data.title })]
    );
    return NextResponse.json({ success: true, data: result.rows[0] }, { status: 201 });
  } catch (err) {
    logger.error({ err }, 'Failed to create personal subtask');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
