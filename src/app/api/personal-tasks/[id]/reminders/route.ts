import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { logger } from '@/lib/logger';
import { z } from 'zod';
import type { ApiResponse, PersonalReminder } from '@/types';

type RouteContext = { params: Promise<{ id: string }> };

const createSchema = z.object({
  remind_at: z.string().min(1),
  channel: z.enum(['email', 'whatsapp', 'both', 'in_app']),
});

async function ownsTask(taskId: number, userId: number): Promise<boolean> {
  const r = await query(`SELECT 1 FROM personal_tasks WHERE id = $1 AND user_id = $2`, [taskId, userId]);
  return (r.rowCount ?? 0) > 0;
}

export async function GET(_req: NextRequest, ctx: RouteContext): Promise<NextResponse<ApiResponse<PersonalReminder[]>>> {
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
    const result = await query<PersonalReminder>(
      `SELECT * FROM personal_task_reminders WHERE task_id = $1 AND user_id = $2 ORDER BY remind_at ASC`,
      [taskId, userId]
    );
    return NextResponse.json({ success: true, data: result.rows });
  } catch (err) {
    logger.error({ err }, 'Failed to fetch personal reminders');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse<ApiResponse<PersonalReminder>>> {
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

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.errors[0].message }, { status: 422 });
  }

  const { remind_at, channel } = parsed.data;

  try {
    const result = await query<PersonalReminder>(
      `INSERT INTO personal_task_reminders (task_id, user_id, remind_at, channel)
       VALUES ($1, $2, $3::timestamptz, $4) RETURNING *`,
      [taskId, userId, remind_at, channel]
    );
    await query(
      `INSERT INTO personal_task_activity (task_id, user_id, action, meta)
       VALUES ($1, $2, 'reminder_added', $3)`,
      [taskId, userId, JSON.stringify({ channel, remind_at })]
    );
    return NextResponse.json({ success: true, data: result.rows[0] }, { status: 201 });
  } catch (err) {
    logger.error({ err }, 'Failed to add personal reminder');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
