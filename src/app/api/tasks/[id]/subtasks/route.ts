// ──────────────────────────────────────────────
// /api/tasks/[id]/subtasks — CRUD
// ──────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { logger } from '@/lib/logger';
import { canUserAccessTaskId, canUserModifyTaskId } from '@/lib/authorization';
import { enqueueEmail, processEmailOutbox } from '@/lib/outbox';
import { z } from 'zod';
import type { Subtask, ApiResponse } from '@/types';

const createSchema = z.object({ title: z.string().min(1).max(500) });
const updateSchema = z.object({
  subId: z.number().int().positive(),
  isDone: z.boolean().optional(),
  title: z.string().min(1).max(500).optional(),
});

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

    const canModify = await canUserModifyTaskId(session.user, taskId);
    if (!canModify) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Only task owner, assignee, department head, or company head can add subtasks' }, { status: 403 });
    }

    const result = await query<Subtask>('SELECT * FROM subtasks WHERE task_id = $1 ORDER BY sort_order, id', [taskId]);
    return NextResponse.json<ApiResponse<Subtask[]>>({ success: true, data: result.rows });
  } catch (err) {
    logger.error({ err }, 'GET /api/tasks/[id]/subtasks error');
    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Unauthorized' }, { status: 401 });

    const taskId = parseInt(params.id, 10);
    const actorName = session.user.displayName || session.user.username || 'Editor';
    if (Number.isNaN(taskId)) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Invalid task ID' }, { status: 400 });
    }

    const canAccess = await canUserAccessTaskId(session.user, taskId);
    if (!canAccess) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const canModify = await canUserModifyTaskId(session.user, taskId);
    if (!canModify) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Only task owner, assignee, department head, or company head can update subtasks' }, { status: 403 });
    }

    const body = await req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: parsed.error.errors[0]?.message || 'Invalid input' }, { status: 400 });
    }

    // Get max sort_order
    const maxOrder = await query<{ max: number }>('SELECT COALESCE(MAX(sort_order), 0) as max FROM subtasks WHERE task_id = $1', [taskId]);
    const nextOrder = (maxOrder.rows[0]?.max || 0) + 1;

    const result = await query<Subtask>(
      'INSERT INTO subtasks (task_id, title, sort_order, created_by) VALUES ($1, $2, $3, $4) RETURNING *',
      [taskId, parsed.data.title, nextOrder, session.user.id]
    );

    await query(
      'INSERT INTO task_activity (task_id, user_id, action, meta) VALUES ($1, $2, $3, $4)',
      [taskId, session.user.id, 'subtask_added', JSON.stringify({ title: parsed.data.title })]
    );

    const taskSnapshot = await query<{
      assigned_by: number | null;
      assigned_to: number | null;
      assigned_to_ids: number[] | null;
      title: string;
      description: string | null;
      activity_start_date: string | null;
      activity_start_time: string | null;
      due_date: string | null;
      due_time: string | null;
    }>(
      'SELECT assigned_by, assigned_to, assigned_to_ids, title, description, activity_start_date, activity_start_time, due_date, due_time FROM tasks WHERE id = $1',
      [taskId]
    );

    if ((taskSnapshot.rowCount || 0) > 0) {
      const task = taskSnapshot.rows[0];
      const assignees = task.assigned_to_ids?.length
        ? task.assigned_to_ids
        : (task.assigned_to ? [task.assigned_to] : []);
      const recipientIds = Array.from(new Set([...(task.assigned_by ? [task.assigned_by] : []), ...assignees]));

      if (recipientIds.length > 0) {
        const recipients = await query<{ id: number; email: string | null; display_name: string | null }>(
          'SELECT id, email, display_name FROM users WHERE id = ANY($1::int[])',
          [recipientIds]
        );

        const actorId = Number(session.user.id);
        const recipientsForEmail = recipients.rows.filter((recipient) => recipient.id !== actorId);

        for (const recipient of recipientsForEmail) {
          const message = [
            'A new subtask has been added.',
            `Subtask: ${parsed.data.title}`,
            `Comment: Subtask added by ${actorName}.`,
          ].join('\n');

          await enqueueEmail({
            eventType: 'task_subtask_added',
            recipientEmail: recipient.email,
            recipientName: recipient.display_name,
            subject: `Subtask Added: ${task.title}`,
            message,
            taskId,
            payload: { taskTitle: task.title, dueDate: task.due_date, dueTime: task.due_time, activityStartDate: task.activity_start_date, activityStartTime: task.activity_start_time },
          });
        }

        await processEmailOutbox(25);
      }
    }

    return NextResponse.json<ApiResponse<Subtask>>({ success: true, data: result.rows[0] }, { status: 201 });
  } catch (err) {
    logger.error({ err }, 'POST /api/tasks/[id]/subtasks error');
    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
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

    const canModify = await canUserModifyTaskId(session.user, taskId);
    if (!canModify) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Only task owner, assignee, department head, or company head can delete subtasks' }, { status: 403 });
    }

    const body = await req.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: parsed.error.errors[0]?.message || 'Invalid input' }, { status: 400 });
    }

    const { subId, isDone, title } = parsed.data;
    const sets: string[] = ['updated_at = NOW()'];
    const p: unknown[] = [];
    let idx = 1;

    if (isDone !== undefined) { sets.push(`is_done = $${idx++}`); p.push(isDone); }
    if (title !== undefined) { sets.push(`title = $${idx++}`); p.push(title); }

    p.push(subId, taskId);
    const result = await query<Subtask>(
      `UPDATE subtasks SET ${sets.join(', ')} WHERE id = $${idx++} AND task_id = $${idx} RETURNING *`,
      p
    );

    if (result.rowCount === 0) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Subtask not found' }, { status: 404 });
    }

    return NextResponse.json<ApiResponse<Subtask>>({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error({ err }, 'PUT /api/tasks/[id]/subtasks error');
    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
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
    const subId = parseInt(searchParams.get('subId') || '', 10);
    if (!subId) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'subId is required' }, { status: 400 });
    }

    const result = await query('DELETE FROM subtasks WHERE id = $1 AND task_id = $2', [subId, taskId]);
    if (result.rowCount === 0) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Subtask not found' }, { status: 404 });
    }

    return NextResponse.json<ApiResponse<null>>({ success: true });
  } catch (err) {
    logger.error({ err }, 'DELETE /api/tasks/[id]/subtasks error');
    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
