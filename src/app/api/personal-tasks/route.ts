import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { logger } from '@/lib/logger';
import { z } from 'zod';
import type { ApiResponse, PersonalTask } from '@/types';

const createSchema = z.object({
  title: z.string().min(1).max(500),
  notes: z.string().max(5000).optional().nullable(),
  priority: z.enum(['low', 'medium', 'high']).optional().default('medium'),
  due_date: z.string().optional().nullable(),
  due_time: z.string().optional().nullable(),
  remind_at: z.string().optional().nullable(),
  remind_channel: z.enum(['email', 'whatsapp', 'both', 'in_app']).optional().nullable(),
  recurrence_rule: z.enum(['none', 'daily', 'weekly', 'monthly']).optional().default('none'),
});

export async function GET(req: NextRequest): Promise<NextResponse<ApiResponse<PersonalTask[]>>> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;

  const { searchParams } = new URL(req.url);
  const statusFilter = searchParams.get('status') || 'all';

  let statusClause = '';
  const params: unknown[] = [userId];

  if (statusFilter === 'pending') {
    statusClause = `AND pt.status = 'pending'`;
  } else if (statusFilter === 'done') {
    statusClause = `AND pt.status = 'done'`;
  }

  try {
    const result = await query<PersonalTask & { subtasks_json: unknown; reminders_json: unknown }>(
      `SELECT
        pt.*,
        COALESCE(
          (SELECT json_agg(s ORDER BY s.sort_order, s.id)
           FROM personal_task_subtasks s
           WHERE s.task_id = pt.id),
          '[]'::json
        ) AS subtasks_json,
        COALESCE(
          (SELECT json_agg(r ORDER BY r.remind_at)
           FROM personal_task_reminders r
           WHERE r.task_id = pt.id AND r.is_fired = false),
          '[]'::json
        ) AS reminders_json
       FROM personal_tasks pt
       WHERE pt.user_id = $1
         ${statusClause}
       ORDER BY
         CASE pt.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
         pt.due_date ASC NULLS LAST,
         pt.created_at DESC`,
      params
    );

    const tasks: PersonalTask[] = result.rows.map((row) => ({
      ...row,
      subtasks: Array.isArray(row.subtasks_json)
        ? row.subtasks_json
        : (typeof row.subtasks_json === 'string' ? JSON.parse(row.subtasks_json) : []),
      reminders: Array.isArray(row.reminders_json)
        ? row.reminders_json
        : (typeof row.reminders_json === 'string' ? JSON.parse(row.reminders_json) : []),
    }));

    return NextResponse.json({ success: true, data: tasks });
  } catch (err) {
    logger.error({ err }, 'Failed to fetch personal tasks');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse<ApiResponse<PersonalTask>>> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.errors[0].message }, { status: 422 });
  }

  const { title, notes, priority, due_date, due_time, remind_at, remind_channel, recurrence_rule } = parsed.data;

  try {
    const result = await query<PersonalTask>(
      `INSERT INTO personal_tasks (user_id, title, notes, priority, due_date, due_time, remind_at, remind_channel, recurrence_rule)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [userId, title, notes ?? null, priority, due_date ?? null, due_time ?? null, remind_at ?? null, remind_channel ?? null, recurrence_rule]
    );

    const task = result.rows[0];

    await query(
      `INSERT INTO personal_task_activity (task_id, user_id, action, meta)
       VALUES ($1, $2, 'created', $3)`,
      [task.id, userId, JSON.stringify({ title })]
    );

    return NextResponse.json({ success: true, data: { ...task, subtasks: [], reminders: [] } }, { status: 201 });
  } catch (err) {
    logger.error({ err }, 'Failed to create personal task');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
