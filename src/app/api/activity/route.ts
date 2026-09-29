// ──────────────────────────────────────────────
// GET /api/activity — full task activity history, paginated & filterable
// Backs the "View all activity" page (tabs: created / updated / completed, day filter)
// ──────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { buildTaskScopeSql } from '@/lib/authorization';
import { logger } from '@/lib/logger';
import type { ApiResponse, PaginatedResponse } from '@/types';

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

type Tab = 'all' | 'created' | 'updated' | 'completed';

const TAB_CONDITIONS: Record<Tab, string> = {
  all: '',
  created: `ta.action = 'created'`,
  completed: `ta.action IN ('status_changed', 'updated_status') AND ta.meta->>'to' = 'completed'`,
  updated: `NOT (ta.action = 'created') AND NOT (ta.action IN ('status_changed', 'updated_status') AND ta.meta->>'to' = 'completed')`,
};

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '25', 10)));
    const offset = (page - 1) * limit;

    const tabParam = (searchParams.get('tab') || 'all') as Tab;
    const tab: Tab = TAB_CONDITIONS[tabParam] !== undefined ? tabParam : 'all';

    const daysParam = searchParams.get('days');
    const isYesterday = daysParam === 'yesterday';
    const days = daysParam && daysParam !== 'all' && !isYesterday ? Math.max(1, parseInt(daysParam, 10)) : null;

    if (Number(session.user.id) === -1) {
      return NextResponse.json<ApiResponse<PaginatedResponse<ActivityItem>>>({
        success: true,
        data: { items: [], total: 0, page, totalPages: 0 },
      });
    }

    const scopeSql = await buildTaskScopeSql(session.user, { startIndex: 1 });
    let visibilityClause = '';
    let params: unknown[] = [];

    if (session.user.role === 'admin') {
      if (!scopeSql.hasAccess) {
        return NextResponse.json<ApiResponse<PaginatedResponse<ActivityItem>>>({
          success: true,
          data: { items: [], total: 0, page, totalPages: 0 },
        });
      }
      visibilityClause = scopeSql.clause;
      params = scopeSql.params;
    } else {
      const assigneeIndex = scopeSql.nextIndex;
      const assigneeClause = `(t.assigned_to = $${assigneeIndex} OR $${assigneeIndex} = ANY(COALESCE(t.assigned_to_ids, ARRAY[]::INTEGER[])))`;
      const assigneeParam = Number(session.user.id);

      if (scopeSql.hasAccess && scopeSql.clause) {
        const prefixed = scopeSql.clause.replace(/\b(company_id|dept_id)\b/g, 't.$1');
        visibilityClause = `(${prefixed} OR ${assigneeClause})`;
        params = [...scopeSql.params, assigneeParam];
      } else {
        visibilityClause = assigneeClause;
        params = [assigneeParam];
      }
    }

    const conditions: string[] = ['t.is_deleted = false'];
    if (visibilityClause) conditions.push(visibilityClause);
    if (TAB_CONDITIONS[tab]) conditions.push(TAB_CONDITIONS[tab]);

    let idx = params.length + 1;
    if (isYesterday) {
      conditions.push(`ta.created_at >= date_trunc('day', NOW()) - INTERVAL '1 day' AND ta.created_at < date_trunc('day', NOW())`);
    } else if (days !== null) {
      conditions.push(`ta.created_at >= NOW() - $${idx}::interval`);
      params.push(`${days} days`);
      idx += 1;
    }

    const where = `WHERE ${conditions.join(' AND ')}`;

    const countResult = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM task_activity ta
       JOIN users u ON ta.user_id = u.id
       JOIN tasks t ON ta.task_id = t.id
       ${where}`,
      params,
    );
    const total = parseInt(countResult.rows[0]?.count || '0', 10);

    const rows = await query<ActivityItem>(
      `SELECT ta.id, ta.task_id, ta.action, ta.meta, ta.created_at,
              COALESCE(u.display_name, u.username) as user_display_name,
              u.username as user_name,
              t.title as task_title
       FROM task_activity ta
       JOIN users u ON ta.user_id = u.id
       JOIN tasks t ON ta.task_id = t.id
       ${where}
       ORDER BY ta.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset],
    );

    return NextResponse.json<ApiResponse<PaginatedResponse<ActivityItem>>>({
      success: true,
      data: {
        items: rows.rows,
        total,
        page,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (err) {
    logger.error({ err }, 'GET /api/activity error');
    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
