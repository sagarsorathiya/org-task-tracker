import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { buildTaskScopeSql } from '@/lib/authorization';
import { logger } from '@/lib/logger';
import { canViewInsights } from '@/lib/utils';
import type { ApiResponse } from '@/types';

interface TrendRow {
  day: string;
  completed?: number;
  overdue?: number;
}

interface DepartmentTrendRow {
  dept_name: string;
  total: number;
  completed: number;
}

interface TrendsPayload {
  completion: TrendRow[];
  overdue: TrendRow[];
  byDepartment: DepartmentTrendRow[];
  avgClosureDays: number;
  currentOverdue: number;
}

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Unauthorized' }, { status: 401 });
    if (!canViewInsights(session.user.role, session.user.insightsAccess)) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    if (Number(session.user.id) === -1) {
      return NextResponse.json<ApiResponse<TrendsPayload>>({
        success: true,
        data: { completion: [], overdue: [], byDepartment: [], avgClosureDays: 0, currentOverdue: 0 },
      });
    }

    const days = Math.min(180, Math.max(1, Number(new URL(req.url).searchParams.get('days') || 30)));
    const companyIdRaw = new URL(req.url).searchParams.get('companyId');
    const deptIdRaw = new URL(req.url).searchParams.get('deptId');
    const selectedCompanyId = companyIdRaw ? Number(companyIdRaw) : null;
    const selectedDeptId = deptIdRaw ? Number(deptIdRaw) : null;

    const scopeNoDays = await buildTaskScopeSql(session.user, {
      startIndex: 1,
      selectedCompanyId,
      selectedDeptId,
    });
    if (!scopeNoDays.hasAccess) {
      return NextResponse.json<ApiResponse<TrendsPayload>>({
        success: true,
        data: { completion: [], overdue: [], byDepartment: [], avgClosureDays: 0, currentOverdue: 0 },
      });
    }

    const scopeWithDays = await buildTaskScopeSql(session.user, {
      startIndex: 2,
      selectedCompanyId,
      selectedDeptId,
    }); // $1 reserved for days
    const scopedWhereWithDays = scopeWithDays.clause ? ` AND ${scopeWithDays.clause}` : '';

    const completion = await query<TrendRow>(
      `SELECT DATE(updated_at)::text AS day, COUNT(*)::int AS completed
       FROM tasks
       WHERE status = 'completed'
         AND is_deleted = false
         AND updated_at >= NOW() - ($1 || ' days')::interval
         ${scopedWhereWithDays}
       GROUP BY DATE(updated_at)
       ORDER BY day`,
      [days, ...scopeWithDays.params]
    );

    const overdue = await query<TrendRow>(
      `SELECT DATE(created_at)::text AS day,
              COUNT(*) FILTER (WHERE due_date IS NOT NULL AND due_date < CURRENT_DATE AND status <> 'completed')::int AS overdue
       FROM tasks
       WHERE is_deleted = false
         AND created_at >= NOW() - ($1 || ' days')::interval
         ${scopedWhereWithDays}
       GROUP BY DATE(created_at)
       ORDER BY day`,
      [days, ...scopeWithDays.params]
    );

    const scopeNoDaysForAlias = await buildTaskScopeSql(session.user, {
      tableAlias: 't',
      startIndex: 1,
      selectedCompanyId,
      selectedDeptId,
    });
    const deptScopedWhere = scopeNoDaysForAlias.clause ? ` AND ${scopeNoDaysForAlias.clause}` : '';

    const byDepartment = await query<DepartmentTrendRow>(
      `SELECT d.name AS dept_name,
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE t.status = 'completed')::int AS completed
       FROM tasks t
       INNER JOIN departments d ON d.id = t.dept_id
       WHERE t.is_deleted = false
         ${deptScopedWhere}
       GROUP BY d.id, d.name
       ORDER BY total DESC, d.name ASC`,
      scopeNoDaysForAlias.params
    );

    const avgScopedWhere = scopeNoDays.clause ? ` AND ${scopeNoDays.clause}` : '';

    const avgClosure = await query<{ avg_days: number | null }>(
      `SELECT ROUND(AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) / 86400)::numeric, 2) AS avg_days
       FROM tasks
       WHERE status = 'completed' AND is_deleted = false
         ${avgScopedWhere}`,
      scopeNoDays.params
    );

    // Live count: all tasks currently overdue regardless of when they were created.
    // The trend overdue query only covers tasks created within the window, so it
    // misses older tasks — this gives the correct real-time number for the Hero KPI.
    const currentOverdueResult = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM tasks
       WHERE is_deleted = false
         AND status NOT IN ('completed', 'cancelled')
         AND due_date IS NOT NULL
         AND (due_date::date + COALESCE(due_time, '23:59:59'::time)) < NOW()
         ${avgScopedWhere}`,
      scopeNoDays.params
    );
    const currentOverdue = parseInt(currentOverdueResult.rows[0]?.count || '0', 10);

    return NextResponse.json<ApiResponse<TrendsPayload>>({
      success: true,
      data: {
        completion: completion.rows,
        overdue: overdue.rows,
        byDepartment: byDepartment.rows,
        avgClosureDays: Number(avgClosure.rows[0]?.avg_days || 0),
        currentOverdue,
      },
    });
  } catch (err) {
    logger.error({ err }, 'GET /api/analytics/trends error');
    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
