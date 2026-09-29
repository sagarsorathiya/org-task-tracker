// ──────────────────────────────────────────────
// /api/tasks — GET list, POST create
// ──────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { logger } from '@/lib/logger';
import { buildTaskScopeSql, canCreateTaskInScope, resolveWritableTaskScope } from '@/lib/authorization';
import { deriveDisplayTaskStatus } from '@/lib/taskStatus';
import { enqueueEmail, processEmailOutbox } from '@/lib/outbox';
import { beginIdempotentRequest, finalizeIdempotentRequest, hashRequestBody } from '@/lib/idempotency';
import { sanitizeRichText } from '@/lib/sanitize';
import { z } from 'zod';
import { PAGINATION_DEFAULTS } from '@/constants';
import type { Task, ApiResponse, PaginatedResponse } from '@/types';

const createSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().trim().min(1).max(10000),
  activityStartDate: z.string().min(1),
  assignedTo: z.number().int().positive().optional(),
  assignedToIds: z.array(z.number().int().positive()).min(1),
  informationIds: z.array(z.number().int().positive()).optional().default([]),
  companyId: z.number().int().positive().optional(),
  deptId: z.number().int().positive(),
  status: z.enum(['open', 'in_progress', 'completed', 'cancelled']).optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']),
  lastFollowUpDate: z.string().optional(),
  nextFollowUpDate: z.string().optional(),
  targetCompletionDate: z.string().min(1),
  remarksActionTaken: z.string().max(5000).optional(),
  dueDate: z.string().optional(),
  followUpDate: z.string().optional(),
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
  status: 'open' | 'in_progress' | 'completed' | 'cancelled' | undefined,
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

  return status || 'open';
}

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Unauthorized', errorCode: 'AUTH_UNAUTHORIZED' }, { status: 401 });
    }

    if (Number(session.user.id) === -1) {
      const page = Math.max(1, parseInt(new URL(req.url).searchParams.get('page') || String(PAGINATION_DEFAULTS.PAGE), 10));
      return NextResponse.json<ApiResponse<PaginatedResponse<Task>>>({
        success: true,
        data: {
          items: [],
          total: 0,
          page,
          totalPages: 0,
        },
      });
    }

    const { searchParams } = new URL(req.url);
    const search = searchParams.get('search') || '';
    const status = searchParams.get('status') || '';
    const priority = searchParams.get('priority') || '';
    const deptId = searchParams.get('deptId') || '';
    const companyId = searchParams.get('companyId') || '';
    const assignedTo = searchParams.get('assignedTo') || '';
    const activeOnly = searchParams.get('activeOnly') === 'true';
    const overdue = searchParams.get('overdue') === 'true';
    const highPriority = searchParams.get('highPriority') === 'true';
    const dueToday = searchParams.get('dueToday') === 'true';
    const upcomingDaysRaw = searchParams.get('upcomingDays') || '';
    const deleted = searchParams.get('deleted') === 'true';
    const page = Math.max(1, parseInt(searchParams.get('page') || String(PAGINATION_DEFAULTS.PAGE), 10));
    const limit = Math.min(
      PAGINATION_DEFAULTS.MAX_LIMIT,
      Math.max(1, parseInt(searchParams.get('limit') || String(PAGINATION_DEFAULTS.LIMIT), 10))
    );
    const sortBy = searchParams.get('sortBy') || 'created_at';
    const sortDir = searchParams.get('sortDir') === 'asc' ? 'ASC' : 'DESC';
    const offset = (page - 1) * limit;

    // Validate sortBy to prevent SQL injection
    const allowedSorts = ['id', 'title', 'status', 'priority', 'due_date', 'follow_up_date', 'created_at', 'updated_at'];
    const safeSortBy = allowedSorts.includes(sortBy) ? sortBy : 'created_at';

    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    const scopeSql = await buildTaskScopeSql(session.user, { tableAlias: 't', startIndex: idx });
    if (session.user.role === 'admin') {
      if (!scopeSql.hasAccess) {
        conditions.push('1=0');
      } else if (scopeSql.clause) {
        conditions.push(scopeSql.clause);
        params.push(...scopeSql.params);
        idx = scopeSql.nextIndex;
      }
    } else {
      const assigneeParamIndex = scopeSql.hasAccess && scopeSql.clause ? scopeSql.nextIndex : idx;
      const assigneeClause = `(t.assigned_to = $${assigneeParamIndex}::int OR $${assigneeParamIndex}::int = ANY(COALESCE(t.assigned_to_ids, ARRAY[]::INTEGER[])))`;
      const assigneeParam = Number(session.user.id);

      if (scopeSql.hasAccess && scopeSql.clause) {
        conditions.push(`(${scopeSql.clause} OR ${assigneeClause})`);
        params.push(...scopeSql.params, assigneeParam);
        idx = assigneeParamIndex + 1;
      } else {
        conditions.push(assigneeClause);
        params.push(assigneeParam);
        idx += 1;
      }
    }

    // Soft-delete filter
    if (deleted && session.user.role === 'admin') {
      conditions.push(`t.is_deleted = true`);
    } else {
      conditions.push(`t.is_deleted = false`);
    }

    if (search) {
      conditions.push(`(t.title ILIKE $${idx} OR t.description ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }
    if (activeOnly && !status) {
      conditions.push(`t.status NOT IN ('completed', 'cancelled')`);
    }
    if (status) {
      // Translate display statuses (what users see) into DB-level SQL conditions
      if (status === 'overdue') {
        conditions.push(`t.status NOT IN ('completed', 'cancelled')
          AND t.due_date IS NOT NULL
          AND (
            t.due_date < CURRENT_DATE
            OR (t.due_date = CURRENT_DATE AND t.due_time IS NOT NULL AND t.due_time < CURRENT_TIME)
          )`);
      } else if (status === 'in_progress') {
        conditions.push(`(
          t.status = 'in_progress'
          OR (
            t.status = 'open'
            AND t.activity_start_date IS NOT NULL
            AND (
              t.activity_start_date < CURRENT_DATE
              OR (t.activity_start_date = CURRENT_DATE AND COALESCE(t.activity_start_time, '00:00:00') <= CURRENT_TIME)
            )
          )
        )
        AND NOT (
          t.due_date IS NOT NULL AND (
            t.due_date < CURRENT_DATE
            OR (t.due_date = CURRENT_DATE AND t.due_time IS NOT NULL AND t.due_time < CURRENT_TIME)
          )
        )`);
      } else if (status === 'upcoming') {
        conditions.push(`t.status = 'open'
          AND NOT (
            t.due_date IS NOT NULL AND (
              t.due_date < CURRENT_DATE
              OR (t.due_date = CURRENT_DATE AND t.due_time IS NOT NULL AND t.due_time < CURRENT_TIME)
            )
          )
          AND (
            t.activity_start_date IS NULL
            OR t.activity_start_date > CURRENT_DATE
            OR (t.activity_start_date = CURRENT_DATE AND COALESCE(t.activity_start_time, '23:59:59') > CURRENT_TIME)
          )`);
      } else {
        // Raw DB status (completed, cancelled, open)
        conditions.push(`t.status = $${idx++}`);
        params.push(status);
      }
    }
    if (priority) { conditions.push(`t.priority = $${idx++}`); params.push(priority); }
    if (deptId) { conditions.push(`t.dept_id = $${idx++}`); params.push(parseInt(deptId, 10)); }
    if (companyId) { conditions.push(`t.company_id = $${idx++}`); params.push(parseInt(companyId, 10)); }
    if (assignedTo) {
      conditions.push(`(t.assigned_to = $${idx}::int OR $${idx}::int = ANY(COALESCE(t.assigned_to_ids, ARRAY[]::INTEGER[])))`);
      params.push(parseInt(assignedTo, 10));
      idx++;
    }

    if (overdue) {
      conditions.push(`t.status NOT IN ('completed', 'cancelled') AND (
        t.due_date < CURRENT_DATE
        OR (t.due_date = CURRENT_DATE AND t.due_time IS NOT NULL AND t.due_time < CURRENT_TIME)
      )`);
    }
    if (highPriority) {
      conditions.push(`t.status NOT IN ('completed', 'cancelled') AND t.priority IN ('high', 'critical')`);
    }
    if (dueToday) {
      conditions.push(`t.status NOT IN ('completed', 'cancelled') AND t.due_date = CURRENT_DATE`);
    }

    const upcomingDays = parseInt(upcomingDaysRaw, 10);
    if (!Number.isNaN(upcomingDays)) {
      const safeUpcomingDays = Math.max(1, Math.min(90, upcomingDays));
      conditions.push(`t.status NOT IN ('completed', 'cancelled') AND t.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + ($${idx++} * INTERVAL '1 day')
        AND (t.due_date > CURRENT_DATE OR t.due_time IS NULL OR t.due_time >= CURRENT_TIME)`);
      params.push(safeUpcomingDays);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count
    const countResult = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM tasks t ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0]?.count || '0', 10);

    // Data
    const dataResult = await query<Task>(
      `SELECT t.*,
        COALESCE(assignees.assigned_names, ua.display_name, ua.username) as assigned_to_name,
        info_users.information_names as information_to_name,
        COALESCE(status_meta.last_status_update_at, t.updated_at) as last_status_update_at,
        COALESCE(reminder_meta.next_reminder_at, (t.follow_up_date::timestamp + COALESCE(t.follow_up_time, '00:00:00'::time))) as next_reminder_at,
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
       ${where}
       ORDER BY t.${safeSortBy} ${sortDir}
       LIMIT $${idx++} OFFSET $${idx}`,
      [...params, limit, offset]
    );

    const enrichedItems = dataResult.rows.map((task) => ({
      ...task,
      display_status: deriveDisplayTaskStatus({
        status: task.status,
        activityStartDate: task.activity_start_date,
        activityStartTime: task.activity_start_time || null,
        dueDate: task.due_date,
        dueTime: task.due_time || null,
      }),
    }));

    return NextResponse.json<ApiResponse<PaginatedResponse<Task>>>({
      success: true,
      data: {
        items: enrichedItems,
        total,
        page,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    logger.error({ err }, 'GET /api/tasks error');
    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    if (Number(session.user.id) === -1) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Database unavailable in fallback mode', errorCode: 'DB_UNAVAILABLE' }, { status: 503 });
    }

    const body = await req.json();
    const idempotencyKey = req.headers.get('idempotency-key');
    if (idempotencyKey) {
      const idemResult = await beginIdempotentRequest({
        key: idempotencyKey,
        scope: 'POST:/api/tasks',
        requestHash: hashRequestBody(body),
      });

      if (idemResult.kind === 'conflict') {
        return NextResponse.json<ApiResponse<null>>(
          { success: false, error: 'Idempotency key reuse with different payload', errorCode: 'IDEMPOTENCY_CONFLICT' },
          { status: 409 }
        );
      }

      if (idemResult.kind === 'replay') {
        return NextResponse.json(idemResult.response as Record<string, unknown>, { status: idemResult.statusCode });
      }
    }

    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: parsed.error.errors[0]?.message || 'Invalid input', errorCode: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const {
      title,
      description,
      activityStartDate,
      assignedTo,
      assignedToIds,
      informationIds,
      companyId,
      deptId,
      status,
      priority,
      lastFollowUpDate,
      nextFollowUpDate,
      targetCompletionDate,
      remarksActionTaken,
      dueDate,
      followUpDate,
    } = parsed.data;

    const safeDescription = sanitizeRichText(description);
    const normalizedAssignedToIds = Array.from(new Set((assignedToIds || (assignedTo ? [assignedTo] : [])).filter(Boolean)));
    const normalizedInformationIds = Array.from(new Set((informationIds || []).filter((id) => !normalizedAssignedToIds.includes(id))));
    const primaryAssignedTo = normalizedAssignedToIds[0] || assignedTo || null;
    const parsedActivity = splitActivityDateTime(activityStartDate || null);
    const parsedTarget = splitDueDateTime(targetCompletionDate || dueDate || null);
    const parsedFollowUp = splitFollowUpDateTime(nextFollowUpDate || followUpDate || null);
    const resolvedStatus = deriveTaskStatus(status, parsedTarget.dueDate);
    const writableScope = await resolveWritableTaskScope(session.user, companyId || null, deptId || null);
    if (session.user.role !== 'admin' && !writableScope.companyId) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'No valid company/department assignment for this task scope' }, { status: 403 });
    }

    const createPermission = await canCreateTaskInScope(session.user, writableScope.companyId, writableScope.deptId);
    if (session.user.role !== 'admin' && !createPermission.allowed) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: 'Task creation is not permitted in this scope.' },
        { status: 403 }
      );
    }

    if (deptId && !companyId) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Company is required when Department is selected' }, { status: 400 });
    }

    if (!parsedFollowUp.followUpDate || !parsedFollowUp.followUpTime) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Reminder Date & Time is required while creating task' }, { status: 400 });
    }

    const reminderAt = toDateTimeMillis(parsedFollowUp.followUpDate, parsedFollowUp.followUpTime);
    const targetAt = toDateTimeMillis(parsedTarget.dueDate, parsedTarget.dueTime);
    if (reminderAt != null && targetAt != null && reminderAt > targetAt) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Reminder Date & Time cannot be after Target Date' }, { status: 400 });
    }

    if (writableScope.deptId && !writableScope.companyId) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Invalid company/department selection' }, { status: 400 });
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

    const result = await query<Task>(
      `INSERT INTO tasks (
        title, description, activity_start_date, activity_start_time, assigned_to, assigned_to_ids, information_ids, assigned_by, company_id, dept_id,
        status, priority, last_follow_up_date, due_date, due_time, follow_up_date, follow_up_time, remarks_action_taken
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
       RETURNING *`,
      [
        title,
        safeDescription,
        parsedActivity.activityDate,
        parsedActivity.activityTime,
        primaryAssignedTo,
        normalizedAssignedToIds,
        normalizedInformationIds,
        session.user.id,
        writableScope.companyId,
        writableScope.deptId,
        resolvedStatus,
        priority,
        lastFollowUpDate || null,
        parsedTarget.dueDate,
        parsedTarget.dueTime,
        parsedFollowUp.followUpDate,
        parsedFollowUp.followUpTime,
        remarksActionTaken?.trim() || null,
      ]
    );

    const task = result.rows[0];
    const createdBy = Number.isNaN(Number(session.user.id)) ? null : Number(session.user.id);

    // Seed a reminder rule from create-task reminder datetime so it appears in Reminders tab.
    await query(
      `INSERT INTO reminder_rules (task_id, offset_days, remind_at, channel, is_active, created_by)
       VALUES ($1, 0, $2, 'email', true, $3)`,
      [task.id, `${parsedFollowUp.followUpDate}T${parsedFollowUp.followUpTime}`, createdBy]
    );

    // Write activity log
    await query(
      `INSERT INTO task_activity (task_id, user_id, action, meta) VALUES ($1, $2, 'created', $3)`,
      [task.id, session.user.id, JSON.stringify({ title })]
    );

    // Write audit log
    await query(
      `INSERT INTO audit_log (actor_id, entity_type, entity_id, action) VALUES ($1, 'task', $2, 'created')`,
      [session.user.id, task.id]
    );

    // Create notification for assigned user
    for (const userId of normalizedAssignedToIds) {
      if (userId !== session.user.id) {
        await query(
          `INSERT INTO notifications (user_id, type, message, ref_task_id) VALUES ($1, 'task_assigned', $2, $3)`,
          [userId, `You have been assigned a new task: ${title}`, task.id]
        );
      }
    }

    const actorName = session.user.displayName || session.user.username || 'Task Creator';
    const actorId = Number(session.user.id);

    if (normalizedAssignedToIds.length > 0) {
      const assigneeResult = await query<{ id: number; email: string | null; display_name: string | null }>(
        `SELECT id, email, display_name FROM users WHERE id = ANY($1::int[])`,
        [normalizedAssignedToIds]
      );

      const assigneesForEmail = assigneeResult.rows.filter((assignee) => assignee.id !== actorId);
      const allAssigneeNames = assigneeResult.rows.map((u) => u.display_name || `User #${u.id}`);

      for (const assignee of assigneesForEmail) {
        const assignmentMessage = [
          'A new task has been assigned to you.',
          `Comment: New assignment from ${actorName}.`,
          `Subject: ${task.title}`,
          `Creation Date: ${task.created_at}`,
          `Target Date: ${task.due_date || 'N/A'}${task.due_time ? ` ${task.due_time}` : ''}`,
        ].join('\n');

        await enqueueEmail({
          eventType: 'task_assigned_create',
          recipientEmail: assignee.email,
          recipientName: assignee.display_name,
          subject: `New Task Assigned: ${task.title}`,
          message: assignmentMessage,
          taskId: task.id,
          payload: { taskTitle: task.title, dueDate: task.due_date, dueTime: task.due_time, activityStartDate: task.activity_start_date, activityStartTime: task.activity_start_time, allAssigneeNames },
        });
      }
    }

    if (normalizedInformationIds.length > 0) {
      const infoResult = await query<{ id: number; email: string | null; display_name: string | null }>(
        `SELECT id, email, display_name FROM users WHERE id = ANY($1::int[])`,
        [normalizedInformationIds]
      );

      for (const infoUser of infoResult.rows) {
        if (infoUser.id !== actorId) {
          await query(
            `INSERT INTO notifications (user_id, type, message, ref_task_id) VALUES ($1, 'task_assigned', $2, $3)`,
            [infoUser.id, `You have been added to task for information: ${title}`, task.id]
          );
        }

        const infoMessage = [
          'You have been added to this task for information.',
          `Comment: New assignment from ${actorName}.`,
          `Subject: ${task.title}`,
          `Creation Date: ${task.created_at}`,
        ].join('\n');

        await enqueueEmail({
          eventType: 'task_assigned_create',
          recipientEmail: infoUser.email,
          recipientName: infoUser.display_name,
          subject: `Information of Task: ${task.title}`,
          message: infoMessage,
          taskId: task.id,
          payload: { taskTitle: task.title, dueDate: task.due_date, dueTime: task.due_time, activityStartDate: task.activity_start_date, activityStartTime: task.activity_start_time },
        });
      }
    }

    if (normalizedAssignedToIds.length > 0 || normalizedInformationIds.length > 0) {
      await processEmailOutbox(25);
    }

    const responseBody: ApiResponse<Task> = { success: true, data: task };
    if (idempotencyKey) {
      await finalizeIdempotentRequest({
        key: idempotencyKey,
        scope: 'POST:/api/tasks',
        response: responseBody,
        statusCode: 201,
      });
    }

    logger.info({ taskId: task.id, userId: session.user.id }, 'Task created');
    return NextResponse.json<ApiResponse<Task>>(responseBody, { status: 201 });
  } catch (err) {
    logger.error({ err }, 'POST /api/tasks error');
    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Internal server error', errorCode: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
