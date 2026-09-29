import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { logger } from '@/lib/logger';
import type { ApiResponse, Task } from '@/types';

function canExport(role?: string): boolean {
  return role === 'admin';
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  // Prevent formula execution when CSV is opened in spreadsheet apps.
  if (/^[=+\-@]/.test(s)) {
    s = `'${s}`;
  }
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Unauthorized' }, { status: 401 });
    if (!canExport(session.user.role)) return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Forbidden' }, { status: 403 });

    if (Number(session.user.id) === -1) {
      return new NextResponse('id,title,description,activity_start_date,assigned_to,assigned_to_ids,assigned_by,company_id,dept_id,status,priority,last_follow_up_date,due_date,due_time,follow_up_date,remarks_action_taken,is_deleted,deleted_at,created_at,updated_at\n', {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="tasks-export-${new Date().toISOString().slice(0, 10)}.csv"`,
        },
      });
    }

    const result = await query<Task>(
      `SELECT id, title, description, activity_start_date, assigned_to, assigned_to_ids, assigned_by,
              company_id, dept_id, status, priority, last_follow_up_date, due_date, due_time,
              follow_up_date, remarks_action_taken, is_deleted, deleted_at, created_at, updated_at
       FROM tasks
       ORDER BY created_at DESC`
    );

    const headers = [
      'id', 'title', 'description', 'activity_start_date', 'assigned_to', 'assigned_to_ids', 'assigned_by',
      'company_id', 'dept_id', 'status', 'priority', 'last_follow_up_date', 'due_date', 'due_time',
      'follow_up_date', 'remarks_action_taken', 'is_deleted', 'deleted_at', 'created_at', 'updated_at',
    ];
    const lines = [headers.join(',')];
    for (const row of result.rows) {
      lines.push(headers.map((h) => {
        const value = (row as unknown as Record<string, unknown>)[h];
        if (Array.isArray(value)) return csvEscape(value.join(';'));
        return csvEscape(value);
      }).join(','));
    }

    return new NextResponse(lines.join('\n'), {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="tasks-export-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (err) {
    logger.error({ err }, 'GET /api/tasks/export error');
    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
