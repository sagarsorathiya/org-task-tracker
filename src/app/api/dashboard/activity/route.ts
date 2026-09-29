// ──────────────────────────────────────────────
// GET /api/dashboard/activity — recent task activity feed
// ──────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { buildTaskScopeSql } from '@/lib/authorization';
import { logger } from '@/lib/logger';
import type { ApiResponse } from '@/types';

export interface ActivityItem {
  id: number;
  task_id: number;
  action: string;
  meta: Record<string, unknown>;
  created_at: string;
  user_display_name: string;
  user_name: string;
  task_title: string;
}

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    if (Number(session.user.id) === -1) {
      return NextResponse.json<ApiResponse<ActivityItem[]>>({ success: true, data: [] });
    }

    const scopeSql = await buildTaskScopeSql(session.user, { startIndex: 1 });
    let visibilityClause = '';
    let params: unknown[] = [];

    if (session.user.role === 'admin') {
      if (!scopeSql.hasAccess) {
        return NextResponse.json<ApiResponse<ActivityItem[]>>({ success: true, data: [] });
      }
      visibilityClause = scopeSql.clause;
      params = scopeSql.params;
    } else {
      const assigneeIndex = scopeSql.nextIndex;
      const assigneeClause = `(t.assigned_to = $${assigneeIndex} OR $${assigneeIndex} = ANY(COALESCE(t.assigned_to_ids, ARRAY[]::INTEGER[])))`;
      const assigneeParam = Number(session.user.id);

      if (scopeSql.hasAccess && scopeSql.clause) {
        // buildTaskScopeSql clause references bare column names; prefix with t.
        const prefixed = scopeSql.clause.replace(/\b(company_id|dept_id)\b/g, 't.$1');
        visibilityClause = `(${prefixed} OR ${assigneeClause})`;
        params = [...scopeSql.params, assigneeParam];
      } else {
        visibilityClause = assigneeClause;
        params = [assigneeParam];
      }
    }

    const nextParamIndex = params.length + 1;
    const scopeFilter = visibilityClause ? `AND ${visibilityClause}` : '';

    const result = await query<ActivityItem>(
      `SELECT ta.id, ta.task_id, ta.action, ta.meta, ta.created_at,
              COALESCE(u.display_name, u.username) as user_display_name,
              u.username as user_name,
              t.title as task_title
       FROM task_activity ta
       JOIN users u ON ta.user_id = u.id
       JOIN tasks t ON ta.task_id = t.id
       WHERE t.is_deleted = false
         ${scopeFilter}
       ORDER BY ta.created_at DESC
       LIMIT $${nextParamIndex}`,
      [...params, 20],
    );

    return NextResponse.json<ApiResponse<ActivityItem[]>>({ success: true, data: result.rows });
  } catch (err) {
    logger.error({ err }, 'GET /api/dashboard/activity error');
    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
