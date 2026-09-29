import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { logger } from '@/lib/logger';
import { z } from 'zod';
import type { ApiResponse, PersonalComment } from '@/types';

type RouteContext = { params: Promise<{ id: string }> };

const postSchema = z.object({
  body: z.string().min(1).max(5000),
});

async function ownsTask(taskId: number, userId: number): Promise<boolean> {
  const r = await query(`SELECT id FROM personal_tasks WHERE id = $1 AND user_id = $2`, [taskId, userId]);
  return (r.rowCount ?? 0) > 0;
}

export async function GET(_req: NextRequest, ctx: RouteContext): Promise<NextResponse<ApiResponse<PersonalComment[]>>> {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  const userId = session.user.id;
  const { id } = await ctx.params;
  const taskId = parseInt(id, 10);
  if (isNaN(taskId)) return NextResponse.json({ success: false, error: 'Invalid id' }, { status: 400 });

  if (!(await ownsTask(taskId, userId))) {
    return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
  }

  try {
    const result = await query<PersonalComment>(
      `SELECT c.id, c.task_id, c.user_id, c.body, c.created_at, u.display_name
       FROM personal_task_comments c
       JOIN users u ON u.id = c.user_id
       WHERE c.task_id = $1
       ORDER BY c.created_at ASC`,
      [taskId]
    );
    return NextResponse.json({ success: true, data: result.rows });
  } catch (err) {
    logger.error({ err }, 'Failed to fetch personal task comments');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse<ApiResponse<PersonalComment>>> {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
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

  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.errors[0].message }, { status: 422 });
  }

  try {
    const result = await query<PersonalComment>(
      `INSERT INTO personal_task_comments (task_id, user_id, body)
       VALUES ($1, $2, $3)
       RETURNING id, task_id, user_id, body, created_at`,
      [taskId, userId, parsed.data.body]
    );

    const comment = result.rows[0];

    // Log activity
    await query(
      `INSERT INTO personal_task_activity (task_id, user_id, action, meta)
       VALUES ($1, $2, 'status_update', $3)`,
      [taskId, userId, JSON.stringify({ body: parsed.data.body.slice(0, 100) })]
    );

    // Fetch with display_name
    const full = await query<PersonalComment>(
      `SELECT c.id, c.task_id, c.user_id, c.body, c.created_at, u.display_name
       FROM personal_task_comments c JOIN users u ON u.id = c.user_id
       WHERE c.id = $1`,
      [comment.id]
    );

    return NextResponse.json({ success: true, data: full.rows[0] }, { status: 201 });
  } catch (err) {
    logger.error({ err }, 'Failed to post personal task comment');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: RouteContext): Promise<NextResponse<ApiResponse<null>>> {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  const userId = session.user.id;
  const { id } = await ctx.params;
  const taskId = parseInt(id, 10);
  if (isNaN(taskId)) return NextResponse.json({ success: false, error: 'Invalid id' }, { status: 400 });

  const { searchParams } = new URL(req.url);
  const commentId = parseInt(searchParams.get('commentId') ?? '', 10);
  if (isNaN(commentId)) return NextResponse.json({ success: false, error: 'Missing commentId' }, { status: 400 });

  try {
    const result = await query(
      `DELETE FROM personal_task_comments WHERE id = $1 AND task_id = $2 AND user_id = $3`,
      [commentId, taskId, userId]
    );
    if ((result.rowCount ?? 0) === 0) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: null });
  } catch (err) {
    logger.error({ err }, 'Failed to delete personal task comment');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
