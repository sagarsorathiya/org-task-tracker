import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { buildTaskScopeSql } from '@/lib/authorization';
import { logger } from '@/lib/logger';
import { canViewInsights } from '@/lib/utils';
import type { ApiResponse } from '@/types';

interface CalendarRow {
  id: number;
  title: string;
  status: string;
  priority: string;
  assigned_to_name: string | null;
  due_date: string | null;
  follow_up_date: string | null;
}

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Unauthorized' }, { status: 401 });
    if (!canViewInsights(session.user.role, session.user.insightsAccess)) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    if (Number(session.user.id) === -1) {
      return NextResponse.json<ApiResponse<CalendarRow[]>>({ success: true, data: [] });
    }

    const { searchParams } = new URL(req.url);
    const companyIdRaw = searchParams.get('companyId');
    const deptIdRaw = searchParams.get('deptId');
    const selectedCompanyId = companyIdRaw ? Number(companyIdRaw) : null;
    const selectedDeptId = deptIdRaw ? Number(deptIdRaw) : null;

    const conditions: string[] = ['t.is_deleted = false'];
    const params: unknown[] = [];

    const scopeSql = await buildTaskScopeSql(session.user, {
      tableAlias: 't',
      startIndex: 1,
      selectedCompanyId,
      selectedDeptId,
    });
    if (!scopeSql.hasAccess) {
      return NextResponse.json<ApiResponse<CalendarRow[]>>({ success: true, data: [] });
    }
    if (scopeSql.clause) {
      conditions.push(scopeSql.clause);
      params.push(...scopeSql.params);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;

    const result = await query<CalendarRow>(
      `SELECT t.id, t.title, t.status, t.priority,
              COALESCE(assignees.assigned_names, u.display_name, u.username) AS assigned_to_name,
              t.due_date, t.follow_up_date
       FROM tasks t
       LEFT JOIN users u ON u.id = t.assigned_to
       LEFT JOIN LATERAL (
         SELECT string_agg(COALESCE(ux.display_name, ux.username), ', ' ORDER BY COALESCE(ux.display_name, ux.username)) AS assigned_names
         FROM users ux
         WHERE ux.id = ANY(
           CASE
             WHEN t.assigned_to_ids IS NOT NULL AND array_length(t.assigned_to_ids, 1) > 0 THEN t.assigned_to_ids
             WHEN t.assigned_to IS NOT NULL THEN ARRAY[t.assigned_to]
             ELSE ARRAY[]::INTEGER[]
           END
         )
       ) assignees ON true
       ${where}
       ORDER BY t.due_date ASC NULLS LAST, t.follow_up_date ASC NULLS LAST, t.created_at DESC
       LIMIT 200`,
      params
    );

    return NextResponse.json<ApiResponse<CalendarRow[]>>({ success: true, data: result.rows });
  } catch (err) {
    logger.error({ err }, 'GET /api/views/calendar error');
    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
