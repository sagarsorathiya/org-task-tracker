import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { buildTaskScopeSql } from '@/lib/authorization';
import { logger } from '@/lib/logger';
import { canViewInsights } from '@/lib/utils';
import type { ApiResponse } from '@/types';

interface WorkloadRow {
  assignee: string;
  open_tasks: number;
  high_priority_open: number;
}

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Unauthorized' }, { status: 401 });
    if (!canViewInsights(session.user.role, session.user.insightsAccess)) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    if (Number(session.user.id) === -1) {
      return NextResponse.json<ApiResponse<WorkloadRow[]>>({ success: true, data: [] });
    }

    const { searchParams } = new URL(req.url);
    const companyIdRaw = searchParams.get('companyId');
    const deptIdRaw = searchParams.get('deptId');
    const selectedCompanyId = companyIdRaw ? Number(companyIdRaw) : null;
    const selectedDeptId = deptIdRaw ? Number(deptIdRaw) : null;

    const conditions: string[] = ['t.is_deleted = false'];
    const params: unknown[] = [];
    let idx = 1;

    const scopeSql = await buildTaskScopeSql(session.user, {
      tableAlias: 't',
      startIndex: idx,
      selectedCompanyId,
      selectedDeptId,
    });
    if (!scopeSql.hasAccess) {
      return NextResponse.json<ApiResponse<WorkloadRow[]>>({ success: true, data: [] });
    }
    if (scopeSql.clause) {
      conditions.push(scopeSql.clause);
      params.push(...scopeSql.params);
      idx = scopeSql.nextIndex;
    }

    const where = `WHERE ${conditions.join(' AND ')}`;

    const result = await query<WorkloadRow>(
      `WITH expanded AS (
         SELECT
           t.id,
           t.status,
           t.priority,
           CASE
             WHEN t.assigned_to_ids IS NOT NULL AND array_length(t.assigned_to_ids, 1) > 0 THEN t.assigned_to_ids
             WHEN t.assigned_to IS NOT NULL THEN ARRAY[t.assigned_to]
             ELSE ARRAY[]::INTEGER[]
           END AS assignee_ids
         FROM tasks t
         ${where}
       ), mapped AS (
         SELECT e.id, e.status, e.priority, unnest(e.assignee_ids) AS assignee_id
         FROM expanded e
       )
       SELECT COALESCE(u.display_name, u.username, 'Unassigned') AS assignee,
              COUNT(*) FILTER (WHERE m.status <> 'completed')::int AS open_tasks,
              COUNT(*) FILTER (WHERE m.priority IN ('high', 'critical') AND m.status <> 'completed')::int AS high_priority_open
       FROM mapped m
       LEFT JOIN users u ON m.assignee_id = u.id
       GROUP BY COALESCE(u.display_name, u.username, 'Unassigned')
       ORDER BY open_tasks DESC, assignee ASC`,
      params
    );

    return NextResponse.json<ApiResponse<WorkloadRow[]>>({ success: true, data: result.rows });
  } catch (err) {
    logger.error({ err }, 'GET /api/workload error');
    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
