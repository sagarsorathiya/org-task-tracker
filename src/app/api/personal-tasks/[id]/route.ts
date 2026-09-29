import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { logger } from '@/lib/logger';
import { z } from 'zod';
import type { ApiResponse, PersonalTask, PersonalRecurrence } from '@/types';

const updateSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  notes: z.string().max(5000).optional().nullable(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  due_date: z.string().optional().nullable(),
  due_time: z.string().optional().nullable(),
  remind_at: z.string().optional().nullable(),
  remind_channel: z.enum(['email', 'whatsapp', 'both', 'in_app']).optional().nullable(),
  status: z.enum(['pending', 'done']).optional(),
  recurrence_rule: z.enum(['none', 'daily', 'weekly', 'monthly']).optional(),
});

function computeNextDueDate(dueDateStr: string | null, rule: PersonalRecurrence): string | null {
  if (!dueDateStr || rule === 'none') return null;
  const d = new Date(dueDateStr + 'T00:00:00');
  if (rule === 'daily') d.setDate(d.getDate() + 1);
  else if (rule === 'weekly') d.setDate(d.getDate() + 7);
  else if (rule === 'monthly') d.setMonth(d.getMonth() + 1);
  return d.toISOString().split('T')[0];
}

type RouteContext = { params: Promise<{ id: string }> };

async function getOwnedTask(taskId: number, userId: number) {
  const result = await query<PersonalTask & { subtasks_json: unknown; reminders_json: unknown }>(
    `SELECT pt.*,
       COALESCE(
         (SELECT json_agg(s ORDER BY s.sort_order, s.id)
          FROM personal_task_subtasks s WHERE s.task_id = pt.id),
         '[]'::json
       ) AS subtasks_json,
       COALESCE(
         (SELECT json_agg(r ORDER BY r.remind_at)
          FROM personal_task_reminders r WHERE r.task_id = pt.id AND r.is_fired = false),
         '[]'::json
       ) AS reminders_json
     FROM personal_tasks pt WHERE pt.id = $1 AND pt.user_id = $2`,
    [taskId, userId]
  );
  if (!result.rows[0]) return null;
  const row = result.rows[0];
  return {
    ...row,
    subtasks: Array.isArray(row.subtasks_json) ? row.subtasks_json : [],
    reminders: Array.isArray(row.reminders_json) ? row.reminders_json : [],
  } as PersonalTask;
}

async function logActivity(taskId: number, userId: number, action: string, meta: Record<string, unknown>) {
  await query(
    `INSERT INTO personal_task_activity (task_id, user_id, action, meta) VALUES ($1, $2, $3, $4)`,
    [taskId, userId, action, JSON.stringify(meta)]
  );
}

export async function PUT(req: NextRequest, ctx: RouteContext): Promise<NextResponse<ApiResponse<PersonalTask>>> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;
  const { id } = await ctx.params;
  const taskId = parseInt(id, 10);
  if (isNaN(taskId)) return NextResponse.json({ success: false, error: 'Invalid id' }, { status: 400 });

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.errors[0].message }, { status: 422 });
  }

  const existing = await getOwnedTask(taskId, userId);
  if (!existing) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

  const d = parsed.data;
  try {
    const result = await query<PersonalTask>(
      `UPDATE personal_tasks SET
        title            = COALESCE($3, title),
        notes            = CASE WHEN $4::boolean THEN $5 ELSE notes END,
        priority         = COALESCE($6, priority),
        due_date         = CASE WHEN $7::boolean THEN $8::date ELSE due_date END,
        due_time         = CASE WHEN $9::boolean THEN $10::time ELSE due_time END,
        remind_at        = CASE WHEN $11::boolean THEN $12::timestamptz ELSE remind_at END,
        remind_channel   = CASE WHEN $13::boolean THEN $14 ELSE remind_channel END,
        status           = COALESCE($15, status),
        recurrence_rule  = COALESCE($16, recurrence_rule),
        updated_at       = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [
        taskId, userId,
        d.title ?? null,
        'notes' in d, d.notes ?? null,
        d.priority ?? null,
        'due_date' in d, d.due_date ?? null,
        'due_time' in d, d.due_time ?? null,
        'remind_at' in d, d.remind_at ?? null,
        'remind_channel' in d, d.remind_channel ?? null,
        d.status ?? null,
        d.recurrence_rule ?? null,
      ]
    );

    const updated = result.rows[0];

    const activityPromises: Promise<unknown>[] = [];
    const existingRec = existing as unknown as Record<string, unknown>;
    const trackableFields = ['title', 'notes', 'priority', 'due_date', 'status'] as const;
    for (const field of trackableFields) {
      if (field in d && String(d[field] ?? '') !== String(existingRec[field] ?? '')) {
        activityPromises.push(
          logActivity(taskId, userId, `updated_${field}`, {
            from: existingRec[field],
            to: d[field],
          })
        );
      }
    }
    await Promise.all(activityPromises);

    const task: PersonalTask = { ...updated, subtasks: existing.subtasks, reminders: existing.reminders };
    return NextResponse.json({ success: true, data: task });
  } catch (err) {
    logger.error({ err }, 'Failed to update personal task');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, ctx: RouteContext): Promise<NextResponse<ApiResponse<PersonalTask>>> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;
  const { id } = await ctx.params;
  const taskId = parseInt(id, 10);
  if (isNaN(taskId)) return NextResponse.json({ success: false, error: 'Invalid id' }, { status: 400 });

  const existing = await getOwnedTask(taskId, userId);
  if (!existing) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

  const newStatus = existing.status === 'done' ? 'pending' : 'done';

  try {
    const result = await query<PersonalTask>(
      `UPDATE personal_tasks SET status = $3, updated_at = NOW()
       WHERE id = $1 AND user_id = $2 RETURNING *`,
      [taskId, userId, newStatus]
    );

    await logActivity(taskId, userId, 'updated_status', { from: existing.status, to: newStatus });

    // When a recurring task is marked done, create the next occurrence
    if (newStatus === 'done' && existing.recurrence_rule !== 'none') {
      const nextDate = computeNextDueDate(existing.due_date, existing.recurrence_rule);
      if (nextDate) {
        const nextTask = await query<PersonalTask>(
          `INSERT INTO personal_tasks (user_id, title, notes, priority, due_date, due_time, recurrence_rule)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
          [userId, existing.title, existing.notes, existing.priority, nextDate, existing.due_time, existing.recurrence_rule]
        );
        if (nextTask.rows[0]) {
          await logActivity(nextTask.rows[0].id, userId, 'created', { title: existing.title, from_recurrence: true });
        }
      }
    }

    const task: PersonalTask = { ...result.rows[0], subtasks: existing.subtasks, reminders: existing.reminders };
    return NextResponse.json({ success: true, data: task });
  } catch (err) {
    logger.error({ err }, 'Failed to toggle personal task status');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, ctx: RouteContext): Promise<NextResponse<ApiResponse<null>>> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;
  const { id } = await ctx.params;
  const taskId = parseInt(id, 10);
  if (isNaN(taskId)) return NextResponse.json({ success: false, error: 'Invalid id' }, { status: 400 });

  try {
    const result = await query(
      `DELETE FROM personal_tasks WHERE id = $1 AND user_id = $2`,
      [taskId, userId]
    );
    if ((result.rowCount ?? 0) === 0) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: null });
  } catch (err) {
    logger.error({ err }, 'Failed to delete personal task');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
