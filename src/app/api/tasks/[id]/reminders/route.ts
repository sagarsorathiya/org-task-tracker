// ──────────────────────────────────────────────
// /api/tasks/[id]/reminders — CRUD for reminder rules
// ──────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { logger } from '@/lib/logger';
import { ensureSchedulerInitialized } from '@/lib/scheduler-init';
import { canUserAccessTaskId } from '@/lib/authorization';
import { z } from 'zod';
import type { ReminderRule, ApiResponse } from '@/types';

const createSchema = z.object({
  offsetDays: z.number().int().min(0).max(365).optional(),
  remindAt: z.string().datetime().optional(),
  channel: z.enum(['whatsapp', 'email', 'both']),
}).refine((data) => data.offsetDays !== undefined || data.remindAt !== undefined, {
  message: 'Either offsetDays or remindAt is required',
});

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    ensureSchedulerInitialized();

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

    const result = await query<ReminderRule>(
      'SELECT * FROM reminder_rules WHERE task_id = $1 ORDER BY created_at',
      [taskId]
    );

    return NextResponse.json<ApiResponse<ReminderRule[]>>({ success: true, data: result.rows });
  } catch (err) {
    logger.error({ err }, 'GET /api/tasks/[id]/reminders error');
    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    ensureSchedulerInitialized();

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

    const body = await req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: parsed.error.errors[0]?.message || 'Invalid input' }, { status: 400 });
    }

    if (parsed.data.remindAt) {
      const remindAtDate = new Date(parsed.data.remindAt);
      if (Number.isNaN(remindAtDate.getTime()) || remindAtDate.getTime() < Date.now()) {
        return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Reminder date/time cannot be in the past' }, { status: 400 });
      }
    }

    let offsetDays = parsed.data.offsetDays;
    if (offsetDays === undefined && parsed.data.remindAt) {
      const taskResult = await query<{ due_date: string | null; due_time: string | null }>('SELECT due_date, due_time FROM tasks WHERE id = $1', [taskId]);
      const dueDate = taskResult.rows[0]?.due_date;
      if (dueDate) {
        const dueTime = taskResult.rows[0]?.due_time ? String(taskResult.rows[0].due_time).slice(0, 8) : '00:00:00';
        const due = new Date(`${dueDate}T${dueTime}`);
        const remindAt = new Date(parsed.data.remindAt);
        const diffMs = due.getTime() - remindAt.getTime();
        offsetDays = Math.max(0, Math.ceil(diffMs / (24 * 60 * 60 * 1000)));
      } else {
        offsetDays = 0;
      }
    }

    const result = await query<ReminderRule>(
      'INSERT INTO reminder_rules (task_id, offset_days, remind_at, channel, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [taskId, offsetDays ?? 0, parsed.data.remindAt || null, parsed.data.channel, session.user.id]
    );

    logger.info({ taskId, ruleId: result.rows[0].id }, 'Reminder rule created');
    return NextResponse.json<ApiResponse<ReminderRule>>({ success: true, data: result.rows[0] }, { status: 201 });
  } catch (err) {
    logger.error({ err }, 'POST /api/tasks/[id]/reminders error');
    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    ensureSchedulerInitialized();

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
    const ruleId = parseInt(searchParams.get('ruleId') || '', 10);
    if (!ruleId) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'ruleId is required' }, { status: 400 });
    }

    const result = await query('DELETE FROM reminder_rules WHERE id = $1 AND task_id = $2', [ruleId, taskId]);
    if (result.rowCount === 0) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Reminder rule not found' }, { status: 404 });
    }

    return NextResponse.json<ApiResponse<null>>({ success: true });
  } catch (err) {
    logger.error({ err }, 'DELETE /api/tasks/[id]/reminders error');
    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
