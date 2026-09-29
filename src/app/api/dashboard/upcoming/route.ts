// ──────────────────────────────────────────────
// GET /api/dashboard/upcoming — Tasks with target date (due_date) in the next N days
// ──────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { buildTaskScopeSql } from '@/lib/authorization';
import { logger } from '@/lib/logger';
import type { Task, ApiResponse } from '@/types';

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Unauthorized' }, { status: 401 });

    // Local admin fallback session when DB is unavailable.
    if (Number(session.user.id) === -1) {
      return NextResponse.json<ApiResponse<Task[]>>({ success: true, data: [] });
    }

    const { searchParams } = new URL(req.url);
    const daysParam = Number.parseInt(searchParams.get('days') || '', 10);
    const days = Number.isNaN(daysParam) ? 7 : Math.max(1, Math.min(90, daysParam));

    const limitParam = Number.parseInt(searchParams.get('limit') || '', 10);
    const limit = Number.isNaN(limitParam) ? 20 : Math.max(1, Math.min(100, limitParam));

    const scopeSql = await buildTaskScopeSql(session.user, { tableAlias: 't', startIndex: 1 });
    let visibilityClause = '';
    let visibilityParams: unknown[] = [];
    let nextParamIndex = scopeSql.nextIndex;

    if (session.user.role === 'admin') {
      if (!scopeSql.hasAccess) {
        return NextResponse.json<ApiResponse<Task[]>>({ success: true, data: [] });
      }
      visibilityClause = scopeSql.clause;
      visibilityParams = scopeSql.params;
      nextParamIndex = scopeSql.nextIndex;
    } else {
      const assigneeClause = `(t.assigned_to = $${nextParamIndex} OR $${nextParamIndex} = ANY(COALESCE(t.assigned_to_ids, ARRAY[]::INTEGER[])))`;
      const assigneeParam = Number(session.user.id);

      if (scopeSql.hasAccess && scopeSql.clause) {
        visibilityClause = `(${scopeSql.clause} OR ${assigneeClause})`;
        visibilityParams = [...scopeSql.params, assigneeParam];
      } else {
        visibilityClause = assigneeClause;
        visibilityParams = [assigneeParam];
      }

      nextParamIndex += 1;
    }

    const scopeFilter = visibilityClause ? `AND ${visibilityClause}` : '';
    const daysParamIndex = nextParamIndex;
    const limitParamIndex = daysParamIndex + 1;

    const result = await query<Task>(
      `SELECT t.*,
        COALESCE(assignees.assigned_names, ua.display_name, ua.username) as assigned_to_name,
        c.name as company_name,
        d.name as dept_name
       FROM tasks t
       LEFT JOIN users ua ON t.assigned_to = ua.id
       LEFT JOIN companies c ON t.company_id = c.id
       LEFT JOIN departments d ON t.dept_id = d.id
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
       WHERE t.is_deleted = false
         AND t.status NOT IN ('completed', 'cancelled')
         AND t.due_date IS NOT NULL
         AND t.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + ($${daysParamIndex} * INTERVAL '1 day')
         ${scopeFilter}
       ORDER BY t.due_date ASC, t.due_time ASC NULLS LAST
       LIMIT $${limitParamIndex}`,
      [...visibilityParams, days, limit]
    );

    const rows = result.rows;

    return NextResponse.json<ApiResponse<Task[]>>({ success: true, data: rows });
  } catch (err) {
    logger.error({ err }, 'GET /api/dashboard/upcoming error');
    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
