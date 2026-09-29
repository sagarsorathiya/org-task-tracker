// ──────────────────────────────────────────────
// GET /api/dashboard/stats — KPI metrics
// ──────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { buildTaskScopeSql } from '@/lib/authorization';
import { logger } from '@/lib/logger';
import type { DashboardStats, ApiResponse } from '@/types';

export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Unauthorized' }, { status: 401 });

    // Local admin fallback session when DB is unavailable.
    if (Number(session.user.id) === -1) {
      const empty: DashboardStats = {
        total: 0,
        inProgress: 0,
        completed: 0,
        overdue: 0,
        highPriority: 0,
        dueToday: 0,
        upcoming7Days: 0,
      };
      return NextResponse.json<ApiResponse<DashboardStats>>({ success: true, data: empty });
    }

    const { searchParams } = new URL(req.url);
    const mineOnly = searchParams.get('mine') === 'true';

    let visibilityClause = '';
    let params: unknown[] = [];

    if (mineOnly) {
      // Only tasks assigned to the current user
      const uid = Number(session.user.id);
      visibilityClause = `(assigned_to = $1 OR $1 = ANY(COALESCE(assigned_to_ids, ARRAY[]::INTEGER[])))`;
      params = [uid];
    } else {
      const scopeSql = await buildTaskScopeSql(session.user, { startIndex: 1 });

      if (session.user.role === 'admin') {
        if (!scopeSql.hasAccess) {
          const empty: DashboardStats = {
            total: 0, inProgress: 0, completed: 0, overdue: 0,
            highPriority: 0, dueToday: 0, upcoming7Days: 0,
          };
          return NextResponse.json<ApiResponse<DashboardStats>>({ success: true, data: empty });
        }
        visibilityClause = scopeSql.clause;
        params = scopeSql.params;
      } else {
        const assigneeIndex = scopeSql.nextIndex;
        const assigneeClause = `(assigned_to = $${assigneeIndex} OR $${assigneeIndex} = ANY(COALESCE(assigned_to_ids, ARRAY[]::INTEGER[])))`;
        const assigneeParam = Number(session.user.id);

        if (scopeSql.hasAccess && scopeSql.clause) {
          visibilityClause = `(${scopeSql.clause} OR ${assigneeClause})`;
          params = [...scopeSql.params, assigneeParam];
        } else {
          visibilityClause = assigneeClause;
          params = [assigneeParam];
        }
      }
    }

    const scopeFilter = visibilityClause ? `AND ${visibilityClause}` : '';

    // Single scan with FILTER aggregates instead of 7 separate COUNT queries.
    const result = await query<{
      total: string;
      in_progress: string;
      completed: string;
      overdue: string;
      high_priority: string;
      due_today: string;
      upcoming_7_days: string;
    }>(
      `SELECT
         COUNT(*)                                                                               AS total,
         COUNT(*) FILTER (WHERE (
           status = 'in_progress'
           OR (
             status = 'open'
             AND activity_start_date IS NOT NULL
             AND (
               activity_start_date < CURRENT_DATE
               OR (activity_start_date = CURRENT_DATE AND COALESCE(activity_start_time, '00:00:00') <= CURRENT_TIME)
             )
           )
         ) AND NOT (
           due_date IS NOT NULL AND (
             due_date < CURRENT_DATE
             OR (due_date = CURRENT_DATE AND due_time IS NOT NULL AND due_time < CURRENT_TIME)
           )
         ))                                                                                     AS in_progress,
         COUNT(*) FILTER (WHERE status = 'completed')                                          AS completed,
         COUNT(*) FILTER (WHERE status NOT IN ('completed','cancelled') AND (
           due_date < CURRENT_DATE
           OR (due_date = CURRENT_DATE AND due_time IS NOT NULL AND due_time < CURRENT_TIME)
         ))                                                                                     AS overdue,
         COUNT(*) FILTER (WHERE priority IN ('high','critical') AND status NOT IN ('completed','cancelled'))
                                                                                                AS high_priority,
         COUNT(*) FILTER (WHERE status NOT IN ('completed','cancelled') AND due_date = CURRENT_DATE)
                                                                                                AS due_today,
         COUNT(*) FILTER (WHERE status NOT IN ('completed','cancelled')
           AND due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
           AND (due_date > CURRENT_DATE OR due_time IS NULL OR due_time >= CURRENT_TIME))
                                                                                                AS upcoming_7_days
       FROM tasks
       WHERE is_deleted = false ${scopeFilter}`,
      params,
    );

    const row = result.rows[0];
    const stats: DashboardStats = {
      total: parseInt(row?.total || '0', 10),
      inProgress: parseInt(row?.in_progress || '0', 10),
      completed: parseInt(row?.completed || '0', 10),
      overdue: parseInt(row?.overdue || '0', 10),
      highPriority: parseInt(row?.high_priority || '0', 10),
      dueToday: parseInt(row?.due_today || '0', 10),
      upcoming7Days: parseInt(row?.upcoming_7_days || '0', 10),
    };

    return NextResponse.json<ApiResponse<DashboardStats>>({ success: true, data: stats });
  } catch (err) {
    logger.error({ err }, 'GET /api/dashboard/stats error');
    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
