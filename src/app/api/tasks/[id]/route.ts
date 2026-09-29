// ──────────────────────────────────────────────
// /api/tasks/[id] — GET detail, PUT update, DELETE soft-delete
// ──────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { logger } from '@/lib/logger';
import { canUserAccessTaskId, canUserModifyTaskId, getTaskPermissionProfile, resolveWritableTaskScope } from '@/lib/authorization';
import { deriveDisplayTaskStatus } from '@/lib/taskStatus';
import { enqueueEmail, processEmailOutbox } from '@/lib/outbox';
import { beginIdempotentRequest, finalizeIdempotentRequest, hashRequestBody } from '@/lib/idempotency';
import { sanitizeRichText } from '@/lib/sanitize';
import { z } from 'zod';
import type { Task, ApiResponse } from '@/types';

const updateSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(10000).optional().nullable(),
  activityStartDate: z.string().optional().nullable(),
  assignedTo: z.number().int().positive().optional().nullable(),
  assignedToIds: z.array(z.number().int().positive()).optional().nullable(),
  informationIds: z.array(z.number().int().positive()).optional().nullable(),
  companyId: z.number().int().positive().optional().nullable(),
  deptId: z.number().int().positive().optional().nullable(),
  status: z.enum(['open', 'in_progress', 'completed', 'cancelled']).optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  lastFollowUpDate: z.string().optional().nullable(),
  nextFollowUpDate: z.string().optional().nullable(),
  targetCompletionDate: z.string().optional().nullable(),
  remarksActionTaken: z.string().max(5000).optional().nullable(),
  dueDate: z.string().optional().nullable(),
  followUpDate: z.string().optional().nullable(),
});

function splitDueDateTime(value?: string | null): { dueDate: string | null; dueTime: string | null } {
  if (!value) {
    return { dueDate: null, dueTime: null };
  }

  const normalized = value.trim();
  if (!normalized) {
    return { dueDate: null, dueTime: null };
  }

  if (normalized.includes('T')) {
    const [datePart, timePart] = normalized.split('T');
    const safeTime = (timePart || '').slice(0, 8);
    return {
      dueDate: datePart || null,
      dueTime: safeTime ? `${safeTime}${safeTime.length <= 5 ? ':00' : ''}` : null,
    };
  }

  return { dueDate: normalized, dueTime: null };
}

function splitActivityDateTime(value?: string | null): { activityDate: string | null; activityTime: string | null } {
  if (!value) {
    return { activityDate: null, activityTime: null };
  }

  const normalized = value.trim();
  if (!normalized) {
    return { activityDate: null, activityTime: null };
  }

  if (normalized.includes('T')) {
    const [datePart, timePart] = normalized.split('T');
    const safeTime = (timePart || '').slice(0, 8);
    return {
      activityDate: datePart || null,
      activityTime: safeTime ? `${safeTime}${safeTime.length <= 5 ? ':00' : ''}` : null,
    };
  }

  return { activityDate: normalized, activityTime: null };
}

function splitFollowUpDateTime(value?: string | null): { followUpDate: string | null; followUpTime: string | null } {
  if (!value) {
    return { followUpDate: null, followUpTime: null };
  }

  const normalized = value.trim();
  if (!normalized) {
    return { followUpDate: null, followUpTime: null };
  }

  if (normalized.includes('T')) {
    const [datePart, timePart] = normalized.split('T');
    const safeTime = (timePart || '').slice(0, 8);
    return {
      followUpDate: datePart || null,
      followUpTime: safeTime ? `${safeTime}${safeTime.length <= 5 ? ':00' : ''}` : null,
    };
  }

  return { followUpDate: normalized, followUpTime: null };
}

function toDateTimeMillis(datePart?: string | null, timePart?: string | null): number | null {
  if (!datePart) return null;
  const t = (timePart || '00:00:00').slice(0, 8);
  const parsed = new Date(`${datePart}T${t}`).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

function deriveTaskStatus(
  status: 'open' | 'in_progress' | 'completed' | 'cancelled',
  dueDate: string | null
): 'open' | 'in_progress' | 'completed' | 'cancelled' {
  if (status === 'completed' || status === 'cancelled') {
    return status;
  }

  if (dueDate) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(`${dueDate}T00:00:00`);
    if (!Number.isNaN(due.getTime()) && due.getTime() > today.getTime()) {
      return 'in_progress';
    }
  }

  return status;
}

function isFutureDueDate(dueDate?: string | null): boolean {
  if (!dueDate) return false;
  const normalized = dueDate.split('T')[0];
  const target = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(target.getTime())) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return target.getTime() > today.getTime();
}

function getStatusEventSubject(input: {
  previousStatus: 'open' | 'in_progress' | 'completed' | 'cancelled';
  nextStatus: 'open' | 'in_progress' | 'completed' | 'cancelled';
  taskTitle: string;
  dueDate?: string | null;
}): string {
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

  if (input.nextStatus === 'in_progress' && isFutureDueDate(input.dueDate)) {
    return `Task In Progress: ${input.taskTitle}`;
  }

  return `Task Status Updated: ${input.taskTitle}`;
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const taskId = parseInt(params.id, 10);
    if (isNaN(taskId)) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Invalid task ID' }, { status: 400 });
    }

    // Task with joins
    const taskResult = await query<Task>(
      `SELECT t.*,
        COALESCE(assignees.assigned_names, ua.display_name, ua.username) as assigned_to_name,
        info_users.information_names as information_to_name,
        COALESCE(status_meta.last_status_update_at, t.updated_at) as last_status_update_at,
        COALESCE(reminder_meta.next_reminder_at, (t.follow_up_date::timestamp + COALESCE(t.follow_up_time, '00:00:00'::time))) as next_reminder_at,
        ua.username as assigned_to_username,
        ub.display_name as assigned_by_name,
        c.name as company_name,
        COALESCE(d.name, ad.name) as dept_name
       FROM tasks t
       LEFT JOIN users ua ON t.assigned_to = ua.id
       LEFT JOIN users ub ON t.assigned_by = ub.id
       LEFT JOIN companies c ON t.company_id = c.id
       LEFT JOIN departments d ON t.dept_id = d.id
       LEFT JOIN departments ad ON ua.dept_id = ad.id
       LEFT JOIN LATERAL (
         SELECT MAX(tc.created_at) as last_status_update_at
         FROM task_comments tc
         WHERE tc.task_id = t.id
       ) status_meta ON true
       LEFT JOIN LATERAL (
         SELECT rr.remind_at as next_reminder_at
         FROM reminder_rules rr
         WHERE rr.task_id = t.id
           AND rr.is_active = true
           AND rr.remind_at IS NOT NULL
         ORDER BY rr.remind_at ASC
         LIMIT 1
       ) reminder_meta ON true
       LEFT JOIN LATERAL (
         SELECT string_agg(COALESCE(u.display_name, u.username), ', ' ORDER BY COALESCE(u.display_name, u.username)) as assigned_names
         FROM users u
         WHERE u.id = ANY(
           CASE
             WHEN t.assigned_to_ids IS NOT NULL AND array_length(t.assigned_to_ids, 1) > 0 THEN t.assigned_to_ids
             WHEN t.assigned_to IS NOT NULL THEN ARRAY[t.assigned_to]
             ELSE ARRAY[]::INTEGER[]
           END
         )
       ) assignees ON true
       LEFT JOIN LATERAL (
         SELECT string_agg(COALESCE(u.display_name, u.username), ', ' ORDER BY COALESCE(u.display_name, u.username)) as information_names
         FROM users u
         WHERE t.information_ids IS NOT NULL
           AND array_length(t.information_ids, 1) > 0
           AND u.id = ANY(t.information_ids)
       ) info_users ON true
       WHERE t.id = $1`,
      [taskId]
    );

    if (taskResult.rowCount === 0) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Task not found' }, { status: 404 });
    }

    const task = taskResult.rows[0];
    const taskWithDisplayStatus: Task = {
      ...task,
      display_status: deriveDisplayTaskStatus({
        status: task.status,
        activityStartDate: task.activity_start_date,
        activityStartTime: task.activity_start_time || null,
        dueDate: task.due_date,
        dueTime: task.due_time || null,
      }),
    };

    // Role/assignment check: scoped visibility + cross-department assignee exception.
    const canAccess = await canUserAccessTaskId(session.user, taskId);
    if (!canAccess) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    // Sub-resources (fetch activity first so we can collect user IDs from its meta)
    const [subtasks, comments, reminders, activity, attachments] = await Promise.all([
      query('SELECT * FROM subtasks WHERE task_id = $1 ORDER BY sort_order, id', [taskId]),
      query(
        `SELECT tc.*, u.display_name as user_display_name, u.username as user_name
         FROM task_comments tc JOIN users u ON tc.user_id = u.id
         WHERE tc.task_id = $1 ORDER BY tc.created_at DESC LIMIT 20`,
        [taskId]
      ),
      query('SELECT * FROM reminder_rules WHERE task_id = $1 ORDER BY created_at', [taskId]),
      query(
        `SELECT ta.*, u.display_name as user_display_name, u.username as user_name
         FROM task_activity ta LEFT JOIN users u ON ta.user_id = u.id
         WHERE ta.task_id = $1 ORDER BY ta.created_at DESC LIMIT 20`,
        [taskId]
      ),
      query(
        `SELECT ta.*, u.display_name as uploaded_by_name
         FROM task_attachments ta JOIN users u ON ta.uploaded_by = u.id
         WHERE ta.task_id = $1 ORDER BY ta.created_at DESC`,
        [taskId]
      ),
    ]);

    // Collect ALL user IDs referenced in activity meta (for historical name resolution)
    const resolveMetaIds = (v: unknown): number[] =>
      Array.isArray(v) ? v.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];

    const userIdSet = new Set<number>();
    const currentAssignedIds = taskWithDisplayStatus.assigned_to_ids?.length
      ? taskWithDisplayStatus.assigned_to_ids
      : (taskWithDisplayStatus.assigned_to ? [taskWithDisplayStatus.assigned_to] : []);
    const currentInfoIds = (taskWithDisplayStatus as unknown as Record<string, unknown>).information_ids;
    currentAssignedIds.forEach((id) => userIdSet.add(id));
    resolveMetaIds(currentInfoIds).forEach((id) => userIdSet.add(id));

    const userActivityFields = new Set(['updated_assigned_to_ids', 'updated_assigned_to', 'updated_information_ids']);
    for (const row of activity.rows as Array<{ action: string; meta: unknown }>) {
      if (userActivityFields.has(row.action)) {
        const m = (row.meta && typeof row.meta === 'object' ? row.meta : {}) as Record<string, unknown>;
        resolveMetaIds(m.from).forEach((id) => userIdSet.add(id));
        resolveMetaIds(m.to).forEach((id) => userIdSet.add(id));
      }
    }

    const assignedUsersResult = await query<{ id: number; username: string; display_name: string | null; email: string | null }>(
      `SELECT id, username, display_name, email
       FROM users
       WHERE id = ANY($1::int[])
       ORDER BY COALESCE(display_name, username)`,
      [[...userIdSet]]
    );

    let reminderRows = reminders.rows;
    if (reminderRows.length === 0 && taskWithDisplayStatus.follow_up_date) {
      const remindAt = `${taskWithDisplayStatus.follow_up_date}T${(taskWithDisplayStatus.follow_up_time || '00:00:00').slice(0, 8)}`;
      const createdBy = Number.isNaN(Number(taskWithDisplayStatus.assigned_by))
        ? null
        : Number(taskWithDisplayStatus.assigned_by);

      const seededReminder = await query(
        `INSERT INTO reminder_rules (task_id, offset_days, remind_at, channel, is_active, created_by)
         VALUES ($1, 0, $2, 'email', true, $3)
         RETURNING *`,
        [taskId, remindAt, createdBy]
      );
      reminderRows = seededReminder.rows;
    }

    return NextResponse.json<ApiResponse<Record<string, unknown>>>({
      success: true,
      data: {
        task: taskWithDisplayStatus,
        subtasks: subtasks.rows,
        comments: comments.rows,
        reminders: reminderRows,
        activity: activity.rows,
        attachments: attachments.rows,
        assignedUsers: assignedUsersResult.rows,
      },
    });
  } catch (err) {
    logger.error({ err }, 'GET /api/tasks/[id] error');
    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const taskId = parseInt(params.id, 10);
    if (isNaN(taskId)) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Invalid task ID' }, { status: 400 });
    }

    const body = await req.json();
    const idempotencyKey = req.headers.get('idempotency-key');
    if (idempotencyKey) {
      const idemResult = await beginIdempotentRequest({
        key: idempotencyKey,
        scope: `PUT:/api/tasks/${taskId}`,
        requestHash: hashRequestBody(body),
      });

      if (idemResult.kind === 'conflict') {
        return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Idempotency key reuse with different payload' }, { status: 409 });
      }

      if (idemResult.kind === 'replay') {
        return NextResponse.json(idemResult.response as Record<string, unknown>, { status: idemResult.statusCode });
      }
    }

    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: parsed.error.errors[0]?.message || 'Invalid input' }, { status: 400 });
    }

    const payload = parsed.data;
    if (payload.description !== undefined && !(payload.description || '').trim()) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Description is required' }, { status: 400 });
    }
    if (payload.activityStartDate !== undefined && !(payload.activityStartDate || '').trim()) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Date is required' }, { status: 400 });
    }
    if (payload.targetCompletionDate !== undefined && !(payload.targetCompletionDate || '').trim()) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Target Date is required' }, { status: 400 });
    }
    if (payload.assignedToIds !== undefined && (!payload.assignedToIds || payload.assignedToIds.length === 0)) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Assign To is required' }, { status: 400 });
    }

    // Get current task for diff
    const currentResult = await query<Task>('SELECT * FROM tasks WHERE id = $1', [taskId]);
    if (currentResult.rowCount === 0) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Task not found' }, { status: 404 });
    }
    const current = currentResult.rows[0];

    const canAccess = await canUserAccessTaskId(session.user, taskId);
    if (!canAccess) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const canModify = await canUserModifyTaskId(session.user, taskId);
    if (!canModify) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    // Build dynamic update
    const fieldMap: Record<string, { column: string; value: unknown }> = {};
    const data = payload;

    const explicitDueDate = data.targetCompletionDate !== undefined
      ? splitDueDateTime(data.targetCompletionDate).dueDate
      : (data.dueDate !== undefined ? data.dueDate : undefined);
    const explicitDueTime = data.targetCompletionDate !== undefined
      ? splitDueDateTime(data.targetCompletionDate).dueTime
      : (data.dueDate !== undefined ? null : undefined);
    const effectiveDueDate = explicitDueDate !== undefined ? explicitDueDate : current.due_date;
    const effectiveDueTime = explicitDueTime !== undefined ? explicitDueTime : (current.due_time || null);
    const baseStatus = (data.status ?? current.status) as 'open' | 'in_progress' | 'completed' | 'cancelled';
    const resolvedStatus = deriveTaskStatus(baseStatus, effectiveDueDate || null);

    const followUpInput = data.nextFollowUpDate !== undefined
      ? data.nextFollowUpDate
      : (data.followUpDate !== undefined ? data.followUpDate : undefined);
    if (followUpInput !== undefined) {
      const parsedFollowUpCheck = splitFollowUpDateTime(followUpInput);
      const reminderAt = toDateTimeMillis(parsedFollowUpCheck.followUpDate, parsedFollowUpCheck.followUpTime);
      const targetAt = toDateTimeMillis(effectiveDueDate || null, effectiveDueTime || null);
      if (reminderAt != null && targetAt != null && reminderAt > targetAt) {
        return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Reminder Date & Time cannot be after Target Date' }, { status: 400 });
      }
    }

    if (data.title !== undefined) fieldMap['title'] = { column: 'title', value: data.title };
    if (data.description !== undefined) fieldMap['description'] = { column: 'description', value: data.description ? sanitizeRichText(data.description) : data.description };
    if (data.activityStartDate !== undefined) {
      const parsedActivity = splitActivityDateTime(data.activityStartDate);
      fieldMap['activity_start_date'] = { column: 'activity_start_date', value: parsedActivity.activityDate };
      fieldMap['activity_start_time'] = { column: 'activity_start_time', value: parsedActivity.activityTime };
    }
    if (data.assignedTo !== undefined) fieldMap['assigned_to'] = { column: 'assigned_to', value: data.assignedTo };
    if (data.assignedToIds !== undefined) {
      const normalizedAssignedToIds = data.assignedToIds ? Array.from(new Set(data.assignedToIds.filter(Boolean))) : [];
      fieldMap['assigned_to_ids'] = { column: 'assigned_to_ids', value: normalizedAssignedToIds };
      fieldMap['assigned_to'] = { column: 'assigned_to', value: normalizedAssignedToIds[0] || null };
    }
    if (data.informationIds !== undefined) {
      const nextAssigneeIds = data.assignedToIds
        ? Array.from(new Set(data.assignedToIds.filter(Boolean)))
        : (current.assigned_to_ids?.length ? current.assigned_to_ids : (current.assigned_to ? [current.assigned_to] : []));
      const normalizedInfoIds = data.informationIds
        ? Array.from(new Set(data.informationIds.filter((id) => !nextAssigneeIds.includes(id))))
        : [];
      fieldMap['information_ids'] = { column: 'information_ids', value: normalizedInfoIds };
    }
    if (data.deptId !== undefined && data.deptId && data.companyId === null) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Company is required when Department is selected' }, { status: 400 });
    }

    if (session.user.role !== 'user' && (data.companyId !== undefined || data.deptId !== undefined)) {
      const requestedCompanyId = data.companyId !== undefined ? data.companyId : current.company_id;
      const requestedDeptId = data.deptId !== undefined ? data.deptId : current.dept_id;

      const writableScope = await resolveWritableTaskScope(session.user, requestedCompanyId || null, requestedDeptId || null);
      if (session.user.role !== 'admin' && !writableScope.companyId) {
        return NextResponse.json<ApiResponse<null>>({ success: false, error: 'No valid company/department assignment for this task scope' }, { status: 403 });
      }

      if (writableScope.deptId && !writableScope.companyId) {
        return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Company is required when Department is selected' }, { status: 400 });
      }

      if (writableScope.companyId && writableScope.deptId) {
        const mappingCheck = await query(
          'SELECT 1 FROM dept_company_map WHERE dept_id = $1 AND company_id = $2',
          [writableScope.deptId, writableScope.companyId]
        );
        if (mappingCheck.rowCount === 0) {
          return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Department is not mapped to selected company' }, { status: 400 });
        }
      }

      fieldMap['company_id'] = { column: 'company_id', value: writableScope.companyId };
      fieldMap['dept_id'] = { column: 'dept_id', value: writableScope.deptId };
    }
    if (data.status !== undefined || resolvedStatus !== current.status) {
      fieldMap['status'] = { column: 'status', value: resolvedStatus };
    }
    if (data.priority !== undefined) fieldMap['priority'] = { column: 'priority', value: data.priority };
    if (data.lastFollowUpDate !== undefined) fieldMap['last_follow_up_date'] = { column: 'last_follow_up_date', value: data.lastFollowUpDate };
    if (data.targetCompletionDate !== undefined) {
      const parsedTarget = splitDueDateTime(data.targetCompletionDate);
      fieldMap['due_date'] = { column: 'due_date', value: parsedTarget.dueDate };
      fieldMap['due_time'] = { column: 'due_time', value: parsedTarget.dueTime };
    }
    if (data.nextFollowUpDate !== undefined) {
      const parsedFollowUp = splitFollowUpDateTime(data.nextFollowUpDate);
      fieldMap['follow_up_date'] = { column: 'follow_up_date', value: parsedFollowUp.followUpDate };
      fieldMap['follow_up_time'] = { column: 'follow_up_time', value: parsedFollowUp.followUpTime };
    }
    if (data.remarksActionTaken !== undefined) fieldMap['remarks_action_taken'] = { column: 'remarks_action_taken', value: data.remarksActionTaken };
    if (data.dueDate !== undefined) {
      fieldMap['due_date'] = { column: 'due_date', value: data.dueDate };
      fieldMap['due_time'] = { column: 'due_time', value: null };
    }
    if (data.followUpDate !== undefined) {
      const parsedFollowUp = splitFollowUpDateTime(data.followUpDate);
      fieldMap['follow_up_date'] = { column: 'follow_up_date', value: parsedFollowUp.followUpDate };
      fieldMap['follow_up_time'] = { column: 'follow_up_time', value: parsedFollowUp.followUpTime };
    }

    const entries = Object.entries(fieldMap);
    const actorName = session.user.displayName || session.user.username || 'Editor';
    if (entries.length === 0) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'No fields to update' }, { status: 400 });
    }

    const sets: string[] = ['updated_at = NOW()'];
    const params2: unknown[] = [];
    let idx = 1;

    for (const [, { column, value }] of entries) {
      sets.push(`${column} = $${idx++}`);
      params2.push(value);
    }
    params2.push(taskId);

    const result = await query<Task>(
      `UPDATE tasks SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      params2
    );

    // Resolve display names for user-array fields so activity log stores human-readable names
    const userArrayFields = ['assigned_to_ids', 'information_ids'] as const;
    const userIdsForMeta = new Set<number>();
    for (const [columnName, { value }] of entries) {
      if ((userArrayFields as readonly string[]).includes(columnName)) {
        const normalizeArr = (v: unknown): number[] =>
          Array.isArray(v) ? v.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
        normalizeArr((current as unknown as Record<string, unknown>)[columnName]).forEach((id) => userIdsForMeta.add(id));
        normalizeArr(value).forEach((id) => userIdsForMeta.add(id));
      }
    }
    const activityUserNames = new Map<number, string>();
    if (userIdsForMeta.size > 0) {
      const nameRes = await query<{ id: number; display_name: string | null; username: string }>(
        'SELECT id, display_name, username FROM users WHERE id = ANY($1::int[])',
        [[...userIdsForMeta]]
      );
      nameRes.rows.forEach((u) => activityUserNames.set(u.id, u.display_name || u.username));
    }

    // Log activity for each changed field
    for (const [columnName, { value }] of entries) {
      const oldValue = (current as unknown as Record<string, unknown>)[columnName];
      if (String(oldValue) !== String(value)) {
        const meta: Record<string, unknown> = { from: oldValue, to: value };

        if ((userArrayFields as readonly string[]).includes(columnName)) {
          const normalizeArr = (v: unknown): number[] =>
            Array.isArray(v) ? v.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
          const fromIds = normalizeArr(oldValue);
          const toIds = normalizeArr(value);
          meta.fromNames = fromIds.map((id) => activityUserNames.get(id) ?? `User #${id}`);
          meta.toNames = toIds.map((id) => activityUserNames.get(id) ?? `User #${id}`);
        }

        await query(
          'INSERT INTO task_activity (task_id, user_id, action, meta) VALUES ($1, $2, $3, $4)',
          [taskId, session.user.id, `updated_${columnName}`, JSON.stringify(meta)]
        );
      }
    }

    // Notification if assignment changed
    const previousAssignedIds = current.assigned_to_ids?.length
      ? current.assigned_to_ids
      : (current.assigned_to ? [current.assigned_to] : []);
    const nextAssignedIds = data.assignedToIds
      ? Array.from(new Set(data.assignedToIds.filter(Boolean)))
      : (data.assignedTo !== undefined
        ? (data.assignedTo ? [data.assignedTo] : [])
        : previousAssignedIds);

    for (const assigneeId of nextAssignedIds) {
      if (!previousAssignedIds.includes(assigneeId) && assigneeId !== Number(session.user.id)) {
        await query(
          'INSERT INTO notifications (user_id, type, message, ref_task_id) VALUES ($1, $2, $3, $4)',
          [assigneeId, 'task_assigned', `You have been assigned task: ${result.rows[0].title}`, taskId]
        );
      }
    }

    const newlyAssignedIds = nextAssignedIds.filter((id) => !previousAssignedIds.includes(id) && id !== Number(session.user.id));
    const assignmentEmailIds = newlyAssignedIds.length > 0 ? newlyAssignedIds : nextAssignedIds;
    const actorId = Number(session.user.id);

    // Fetch all current assignee names once — used in every outgoing email so recipients know the full team
    let allAssigneeNames: string[] = [];
    if (nextAssignedIds.length > 0) {
      const allAssigneeNamesResult = await query<{ id: number; display_name: string | null }>(
        `SELECT id, display_name FROM users WHERE id = ANY($1::int[])`,
        [nextAssignedIds]
      );
      allAssigneeNames = allAssigneeNamesResult.rows.map((u) => u.display_name || `User #${u.id}`);
    }

    if (assignmentEmailIds.length > 0) {
      const assigneeResult = await query<{ id: number; email: string | null; display_name: string | null }>(
        `SELECT id, email, display_name FROM users WHERE id = ANY($1::int[])`,
        [assignmentEmailIds]
      );

      const assigneesForEmail = assigneeResult.rows.filter((assignee) => assignee.id !== actorId);

      for (const assignee of assigneesForEmail) {
        const assignmentMessage = `You have been assigned to this task after an update.\nComment: Assignment updated by ${actorName}.`;

        await enqueueEmail({
          eventType: 'task_assigned_update',
          recipientEmail: assignee.email,
          recipientName: assignee.display_name,
          subject: `Task Assignment Updated: ${result.rows[0].title}`,
          message: assignmentMessage,
          taskId: result.rows[0].id,
          payload: { taskTitle: result.rows[0].title, dueDate: result.rows[0].due_date, dueTime: result.rows[0].due_time, activityStartDate: result.rows[0].activity_start_date, activityStartTime: result.rows[0].activity_start_time, allAssigneeNames },
        });
      }
    }

    // Email newly added information recipients
    if (data.informationIds !== undefined) {
      const previousInfoIds = (current as Task & { information_ids?: number[] }).information_ids ?? [];
      const nextInfoIds = (fieldMap['information_ids']?.value as number[]) ?? [];
      const newlyAddedInfoIds = nextInfoIds.filter((id) => !previousInfoIds.includes(id) && id !== actorId);
      if (newlyAddedInfoIds.length > 0) {
        const infoResult = await query<{ id: number; email: string | null; display_name: string | null }>(
          `SELECT id, email, display_name FROM users WHERE id = ANY($1::int[])`,
          [newlyAddedInfoIds]
        );
        for (const infoUser of infoResult.rows) {
          await enqueueEmail({
            eventType: 'task_assigned_update',
            recipientEmail: infoUser.email,
            recipientName: infoUser.display_name,
            subject: `Information of Task: ${result.rows[0].title}`,
            message: `You have been added to this task for information.\nComment: Assignment updated by ${actorName}.`,
            taskId: result.rows[0].id,
            payload: { taskTitle: result.rows[0].title, dueDate: result.rows[0].due_date, dueTime: result.rows[0].due_time, activityStartDate: result.rows[0].activity_start_date, activityStartTime: result.rows[0].activity_start_time, allAssigneeNames },
          });
        }
      }
    }

    if (assignmentEmailIds.length > 0 || data.informationIds !== undefined) {
      await processEmailOutbox(25);
    }

    const statusChanged = String(current.status) !== String(result.rows[0].status);
    if (statusChanged) {
      const nextInfoIds = (result.rows[0] as Task & { information_ids?: number[] }).information_ids ?? [];
      const recipientIds = Array.from(new Set([...(result.rows[0].assigned_by ? [result.rows[0].assigned_by] : []), ...nextAssignedIds, ...nextInfoIds]));
      if (recipientIds.length > 0) {
        const recipients = await query<{ id: number; email: string | null; display_name: string | null }>(
          `SELECT id, email, display_name FROM users WHERE id = ANY($1::int[])`,
          [recipientIds]
        );

        const actorId = Number(session.user.id);
        const recipientsForEmail = recipients.rows.filter((recipient) => recipient.id !== actorId);

        const nextStatus = result.rows[0].status as 'open' | 'in_progress' | 'completed' | 'cancelled';
        const previousStatus = current.status as 'open' | 'in_progress' | 'completed' | 'cancelled';
        const subject = getStatusEventSubject({
          previousStatus,
          nextStatus,
          taskTitle: result.rows[0].title,
          dueDate: result.rows[0].due_date,
        });

        for (const recipient of recipientsForEmail) {
          const message = data.remarksActionTaken
            ? `Task status was updated by ${actorName}.\nComment: ${data.remarksActionTaken}`
            : `Task status was updated by ${actorName}.`;

          await enqueueEmail({
            eventType: 'task_status_changed',
            recipientEmail: recipient.email,
            recipientName: recipient.display_name,
            subject,
            message,
            taskId: result.rows[0].id,
            payload: { taskTitle: result.rows[0].title, dueDate: result.rows[0].due_date, dueTime: result.rows[0].due_time, activityStartDate: result.rows[0].activity_start_date, activityStartTime: result.rows[0].activity_start_time, allAssigneeNames },
          });
        }

        await processEmailOutbox(25);
      }
    }

    const responseBody: ApiResponse<Task> = { success: true, data: result.rows[0] };
    if (idempotencyKey) {
      await finalizeIdempotentRequest({
        key: idempotencyKey,
        scope: `PUT:/api/tasks/${taskId}`,
        response: responseBody,
        statusCode: 200,
      });
    }

    logger.info({ taskId, userId: session.user.id }, 'Task updated');
    return NextResponse.json<ApiResponse<Task>>(responseBody);
  } catch (err) {
    logger.error({ err }, 'PUT /api/tasks/[id] error');
    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const taskId = parseInt(params.id, 10);
    if (isNaN(taskId)) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Invalid task ID' }, { status: 400 });
    }

    const idempotencyKey = req.headers.get('idempotency-key');
    if (idempotencyKey) {
      const idemResult = await beginIdempotentRequest({
        key: idempotencyKey,
        scope: `DELETE:/api/tasks/${taskId}`,
        requestHash: hashRequestBody({ taskId }),
      });

      if (idemResult.kind === 'conflict') {
        return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Idempotency key reuse with different payload' }, { status: 409 });
      }

      if (idemResult.kind === 'replay') {
        return NextResponse.json(idemResult.response as Record<string, unknown>, { status: idemResult.statusCode });
      }
    }

    if (session.user.role !== 'admin') {
      const scopedTask = await query<{ company_id: number | null; dept_id: number | null; assigned_by: number | null }>(
        'SELECT company_id, dept_id, assigned_by FROM tasks WHERE id = $1 AND is_deleted = false',
        [taskId]
      );
      if (scopedTask.rowCount === 0) {
        return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Task not found or already deleted' }, { status: 404 });
      }
      const t = scopedTask.rows[0];
      // Task creator can always delete their own tasks
      const isCreator = t.assigned_by !== null && Number(t.assigned_by) === Number(session.user.id);
      if (!isCreator) {
        const permission = await getTaskPermissionProfile(session.user, { company_id: t.company_id, dept_id: t.dept_id });
        if (!permission.canDelete) {
          return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Forbidden' }, { status: 403 });
        }
      }
    }

    const result = await query(
      'UPDATE tasks SET is_deleted = true, deleted_at = NOW(), updated_at = NOW() WHERE id = $1 AND is_deleted = false',
      [taskId]
    );

    if (result.rowCount === 0) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Task not found or already deleted' }, { status: 404 });
    }

    await query(
      'INSERT INTO task_activity (task_id, user_id, action) VALUES ($1, $2, $3)',
      [taskId, session.user.id, 'soft_deleted']
    );

    const responseBody: ApiResponse<null> = { success: true };
    if (idempotencyKey) {
      await finalizeIdempotentRequest({
        key: idempotencyKey,
        scope: `DELETE:/api/tasks/${taskId}`,
        response: responseBody,
        statusCode: 200,
      });
    }

    logger.info({ taskId, userId: session.user.id }, 'Task soft-deleted');
    return NextResponse.json<ApiResponse<null>>(responseBody);
  } catch (err) {
    logger.error({ err }, 'DELETE /api/tasks/[id] error');
    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
