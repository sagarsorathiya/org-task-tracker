// ──────────────────────────────────────────────
// /api/tasks/[id]/comments — GET, POST, DELETE
// ──────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { logger } from '@/lib/logger';
import { canUserAccessTaskId, canUserModifyTaskId } from '@/lib/authorization';
import { enqueueEmail, processEmailOutbox } from '@/lib/outbox';
import { beginIdempotentRequest, finalizeIdempotentRequest, hashRequestBody } from '@/lib/idempotency';
import { sanitizeRichText } from '@/lib/sanitize';
import { z } from 'zod';
import type { TaskComment, ApiResponse, PaginatedResponse } from '@/types';

const createSchema = z.object({
  body: z.string().min(1).max(10000),
  status: z.enum(['open', 'in_progress', 'completed', 'cancelled']).optional(),
});

function getSpecificSubject(input: {
  previousStatus: 'open' | 'in_progress' | 'completed' | 'cancelled';
  nextStatus?: 'open' | 'in_progress' | 'completed' | 'cancelled';
  taskTitle: string;
}): string {
  if (!input.nextStatus) {
    return `New Comment: ${input.taskTitle}`;
  }

  if (input.nextStatus === 'completed') {
    return `Task Completed: ${input.taskTitle}`;
  }

  if (
    (input.previousStatus === 'completed' || input.previousStatus === 'cancelled')
    && (input.nextStatus === 'open' || input.nextStatus === 'in_progress')
  ) {
    return `Task Reopened: ${input.taskTitle}`;
  }

  if (input.nextStatus === 'cancelled') {
    return `Task Cancelled: ${input.taskTitle}`;
  }

  return `Task Status Updated: ${input.taskTitle}`;
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Unauthorized' }, { status: 401 });

    const taskId = parseInt(params.id, 10);

    if (Number.isNaN(taskId)) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Invalid task ID' }, { status: 400 });
    }

    if (session.user.role !== 'admin') {
      const canAccess = await canUserAccessTaskId(session.user, taskId);
      if (!canAccess) {
        return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Forbidden' }, { status: 403 });
      }
    }

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)));
    const offset = (page - 1) * limit;

    const countResult = await query<{ count: string }>('SELECT COUNT(*) as count FROM task_comments WHERE task_id = $1', [taskId]);
    const total = parseInt(countResult.rows[0]?.count || '0', 10);

    const result = await query<TaskComment>(
      `SELECT tc.*, u.display_name as user_display_name, u.username as user_name
       FROM task_comments tc JOIN users u ON tc.user_id = u.id
       WHERE tc.task_id = $1 ORDER BY tc.created_at DESC LIMIT $2 OFFSET $3`,
      [taskId, limit, offset]
    );

    return NextResponse.json<ApiResponse<PaginatedResponse<TaskComment>>>({
      success: true,
      data: { items: result.rows, total, page, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    logger.error({ err }, 'GET /api/tasks/[id]/comments error');
    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Unauthorized' }, { status: 401 });

    const taskId = parseInt(params.id, 10);

    if (Number.isNaN(taskId)) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Invalid task ID' }, { status: 400 });
    }

    if (session.user.role !== 'admin') {
      const canAccess = await canUserAccessTaskId(session.user, taskId);
      if (!canAccess) {
        return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Forbidden' }, { status: 403 });
      }

      const canModify = await canUserModifyTaskId(session.user, taskId);
      if (!canModify) {
        return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Only task owner, assignee, department head, or company head can comment' }, { status: 403 });
      }
    }

    const body = await req.json();
    const idempotencyKey = req.headers.get('idempotency-key');
    if (idempotencyKey) {
      const idemResult = await beginIdempotentRequest({
        key: idempotencyKey,
        scope: `POST:/api/tasks/${taskId}/comments`,
        requestHash: hashRequestBody(body),
      });

      if (idemResult.kind === 'conflict') {
        return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Idempotency key reuse with different payload' }, { status: 409 });
      }

      if (idemResult.kind === 'replay') {
        return NextResponse.json(idemResult.response as Record<string, unknown>, { status: idemResult.statusCode });
      }
    }

    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: parsed.error.errors[0]?.message || 'Invalid input' }, { status: 400 });
    }

    const taskSnapshot = await query<{
      assigned_by: number | null;
      assigned_to: number | null;
      assigned_to_ids: number[] | null;
      information_ids: number[] | null;
      title: string;
      description: string | null;
      activity_start_date: string | null;
      activity_start_time: string | null;
      due_date: string | null;
      due_time: string | null;
      status: 'open' | 'in_progress' | 'completed' | 'cancelled';
    }>(
      'SELECT assigned_by, assigned_to, assigned_to_ids, information_ids, title, description, activity_start_date, activity_start_time, due_date, due_time, status FROM tasks WHERE id = $1',
      [taskId]
    );
    if (taskSnapshot.rowCount === 0) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Task not found' }, { status: 404 });
    }

    const currentTask = taskSnapshot.rows[0];
    const actorName = session.user.displayName || session.user.username || 'Commenter';

    const safeBody = sanitizeRichText(parsed.data.body);
    const result = await query<TaskComment>(
      'INSERT INTO task_comments (task_id, user_id, body) VALUES ($1, $2, $3) RETURNING *',
      [taskId, session.user.id, safeBody]
    );

    if (parsed.data.status) {
      await query(
        'UPDATE tasks SET status = $1, updated_at = NOW() WHERE id = $2',
        [parsed.data.status, taskId]
      );

      // A status change made via comment is logged once, as the status change itself —
      // no separate "Added a comment" row, since the comment IS the status-change action.
      await query(
        'INSERT INTO task_activity (task_id, user_id, action, meta) VALUES ($1, $2, $3, $4)',
        [taskId, session.user.id, 'status_changed', JSON.stringify({ to: parsed.data.status, via: 'comment', commentId: result.rows[0].id })]
      );
    } else {
      await query(
        'INSERT INTO task_activity (task_id, user_id, action, meta) VALUES ($1, $2, $3, $4)',
        [taskId, session.user.id, 'commented', JSON.stringify({ commentId: result.rows[0].id, status: null })]
      );
    }

    // For status changes, include the creator (assigned_by); for plain comments, assignees only
    const assignees = currentTask.assigned_to_ids?.length
      ? currentTask.assigned_to_ids
      : (currentTask.assigned_to ? [currentTask.assigned_to] : []);
    const infoRecipients = currentTask.information_ids?.length ? currentTask.information_ids : [];
    const creatorIds = parsed.data.status && currentTask.assigned_by ? [currentTask.assigned_by] : [];
    const recipientIds = Array.from(new Set([...creatorIds, ...assignees, ...infoRecipients]));
    for (const recipientId of recipientIds) {
      if (recipientId !== Number(session.user.id)) {
        await query(
          'INSERT INTO notifications (user_id, type, message, ref_task_id) VALUES ($1, $2, $3, $4)',
          [recipientId, 'task_commented', `New comment on task: ${currentTask.title}`, taskId]
        );
      }
    }

    if (recipientIds.length > 0) {
      const recipients = await query<{ id: number; email: string | null; display_name: string | null }>(
        'SELECT id, email, display_name FROM users WHERE id = ANY($1::int[])',
        [recipientIds]
      );

      const actorId = Number(session.user.id);
      const recipientsForEmail = recipients.rows.filter((recipient) => recipient.id !== actorId);

      for (const recipient of recipientsForEmail) {
        const subject = getSpecificSubject({
          previousStatus: currentTask.status,
          nextStatus: parsed.data.status,
          taskTitle: currentTask.title,
        });
        const isHtmlBody = /<[a-zA-Z][\s\S]*?>/.test(safeBody);
        // For the message intro, use plain text; the full comment body goes in commentBodyHtml
        const plainBodyPreview = isHtmlBody
          ? (safeBody.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300) || '(see attached comment)')
          : safeBody.slice(0, 300);
        const message = parsed.data.status
          ? `A comment was added by ${actorName} and task status was updated.\nComment: ${plainBodyPreview}`
          : `A new comment was added by ${actorName}.\nComment: ${plainBodyPreview}`;

        await enqueueEmail(
          {
            eventType: 'task_comment_added',
            recipientEmail: recipient.email,
            recipientName: recipient.display_name,
            subject,
            message,
            taskId,
            payload: {
              taskTitle: currentTask.title,
              dueDate: currentTask.due_date,
              dueTime: currentTask.due_time,
              activityStartDate: currentTask.activity_start_date,
              activityStartTime: currentTask.activity_start_time,
              taskStatus: parsed.data.status ?? null,
              commentBodyHtml: isHtmlBody ? safeBody : null,
            },
          }
        );
      }

      await processEmailOutbox(25);
    }

    const responseBody: ApiResponse<TaskComment> = { success: true, data: result.rows[0] };
    if (idempotencyKey) {
      await finalizeIdempotentRequest({
        key: idempotencyKey,
        scope: `POST:/api/tasks/${taskId}/comments`,
        response: responseBody,
        statusCode: 201,
      });
    }

    return NextResponse.json<ApiResponse<TaskComment>>(responseBody, { status: 201 });
  } catch (err) {
    logger.error({ err }, 'POST /api/tasks/[id]/comments error');
    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const commentId = parseInt(searchParams.get('commentId') || '', 10);
    if (!commentId) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'commentId is required' }, { status: 400 });
    }

    // Check ownership
    const comment = await query<TaskComment>('SELECT * FROM task_comments WHERE id = $1 AND task_id = $2', [commentId, parseInt(params.id, 10)]);
    if (comment.rowCount === 0) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Comment not found' }, { status: 404 });
    }

    if (comment.rows[0].user_id !== session.user.id && session.user.role !== 'admin') {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Cannot delete others\' comments' }, { status: 403 });
    }

    await query('DELETE FROM task_comments WHERE id = $1', [commentId]);
    return NextResponse.json<ApiResponse<null>>({ success: true });
  } catch (err) {
    logger.error({ err }, 'DELETE /api/tasks/[id]/comments error');
    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
