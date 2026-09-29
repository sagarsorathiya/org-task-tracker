// ──────────────────────────────────────────────
// /api/tasks/[id]/attachments — Upload and manage files
// ──────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { logger } from '@/lib/logger';
import { canUserAccessTaskId, canUserModifyTaskId } from '@/lib/authorization';
import { enqueueEmail, processEmailOutbox } from '@/lib/outbox';
import { isAllowedAttachment, detectDangerousContent } from '@/lib/attachmentValidation';
import { MAX_FILE_SIZE_BYTES } from '@/constants';
import { v4 as uuidv4 } from 'uuid';
import { writeFile, mkdir, unlink } from 'fs/promises';
import { join } from 'path';
import type { TaskAttachment, ApiResponse } from '@/types';

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
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Only task owner, assignee, department head, or company head can add attachments' }, { status: 403 });
    }

    const result = await query<TaskAttachment>(
      `SELECT ta.*, u.display_name as uploaded_by_name
       FROM task_attachments ta JOIN users u ON ta.uploaded_by = u.id
       WHERE ta.task_id = $1 ORDER BY ta.created_at DESC`,
      [taskId]
    );

    return NextResponse.json<ApiResponse<TaskAttachment[]>>({ success: true, data: result.rows });
  } catch (err) {
    logger.error({ err }, 'GET /api/tasks/[id]/attachments error');
    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Unauthorized' }, { status: 401 });

    const taskId = parseInt(params.id, 10);
    const actorName = session.user.displayName || session.user.username || 'Uploader';
    if (Number.isNaN(taskId)) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Invalid task ID' }, { status: 400 });
    }

    const canAccess = await canUserAccessTaskId(session.user, taskId);
    if (!canAccess) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const canModify = await canUserModifyTaskId(session.user, taskId);
    if (!canModify) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Only task owner, assignee, department head, or company head can remove attachments' }, { status: 403 });
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'No file provided' }, { status: 400 });
    }

    if (!isAllowedAttachment(file)) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: `File type not allowed: ${file.type || 'unknown'}` },
        { status: 400 }
      );
    }

    // Validate size limit
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: 'File exceeds 30MB limit' },
        { status: 400 }
      );
    }

    // Generate unique stored name
    const ext = file.name.split('.').pop() || 'bin';
    const storedName = `${uuidv4()}.${ext}`;
    const uploadsDir = join(process.cwd(), 'uploads');
    await mkdir(uploadsDir, { recursive: true });

    // Read buffer before writing so we can validate magic bytes.
    const buffer = Buffer.from(await file.arrayBuffer());

    const dangerousType = detectDangerousContent(buffer);
    if (dangerousType) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: `File content not allowed: ${dangerousType}` },
        { status: 400 }
      );
    }

    await writeFile(join(uploadsDir, storedName), buffer);

    // Insert record
    const result = await query<TaskAttachment>(
      `INSERT INTO task_attachments (task_id, uploaded_by, original_name, stored_name, mime_type, size_bytes)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [taskId, session.user.id, file.name, storedName, file.type, file.size]
    );

    await query(
      'INSERT INTO task_activity (task_id, user_id, action, meta) VALUES ($1, $2, $3, $4)',
      [taskId, session.user.id, 'attachment_added', JSON.stringify({ fileName: file.name })]
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

        for (const recipient of recipients.rows) {
          if (recipient.id === Number(session.user.id)) continue;
          const message = [
            'A new attachment has been added to this task.',
            `Attachment: ${file.name}`,
            `Comment: Attachment added by ${actorName}.`,
          ].join('\n');

          await enqueueEmail({
            eventType: 'task_attachment_added',
            recipientEmail: recipient.email,
            recipientName: recipient.display_name,
            subject: `New Attachment: ${task.title}`,
            message,
            taskId,
            payload: { taskTitle: task.title, dueDate: task.due_date, dueTime: task.due_time, activityStartDate: task.activity_start_date, activityStartTime: task.activity_start_time },
          });
        }

        await processEmailOutbox(25);
      }
    }

    logger.info({ taskId, fileName: file.name }, 'Attachment uploaded');
    return NextResponse.json<ApiResponse<TaskAttachment>>({ success: true, data: result.rows[0] }, { status: 201 });
  } catch (err) {
    logger.error({ err }, 'POST /api/tasks/[id]/attachments error');
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
    const attachId = parseInt(searchParams.get('attachId') || '', 10);
    if (!attachId) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'attachId is required' }, { status: 400 });
    }

    const existing = await query<{ stored_name: string }>(
      'SELECT stored_name FROM task_attachments WHERE id = $1 AND task_id = $2',
      [attachId, taskId]
    );
    if (existing.rowCount === 0) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Attachment not found' }, { status: 404 });
    }

    const storedName = existing.rows[0].stored_name;
    const filePath = join(process.cwd(), 'uploads', storedName);
    try {
      await unlink(filePath);
    } catch {
      // File may already be missing; still remove DB row.
    }

    const result = await query('DELETE FROM task_attachments WHERE id = $1 AND task_id = $2', [attachId, taskId]);
    if (result.rowCount === 0) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Attachment not found' }, { status: 404 });
    }

    return NextResponse.json<ApiResponse<null>>({ success: true });
  } catch (err) {
    logger.error({ err }, 'DELETE /api/tasks/[id]/attachments error');
    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
