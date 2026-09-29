import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { buildTaskScopeSql } from '@/lib/authorization';
import { logger } from '@/lib/logger';
import { canViewInsights } from '@/lib/utils';
import type { ApiResponse, Task } from '@/types';

type KanbanResponse = Record<string, Task[]>;

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Unauthorized' }, { status: 401 });
    if (!canViewInsights(session.user.role, session.user.insightsAccess)) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    if (Number(session.user.id) === -1) {
      return NextResponse.json<ApiResponse<KanbanResponse>>({ success: true, data: {} });
    }

    const { searchParams } = new URL(req.url);
    const companyIdRaw = searchParams.get('companyId');
    const deptIdRaw = searchParams.get('deptId');
    const selectedCompanyId = companyIdRaw ? Number(companyIdRaw) : null;
    const selectedDeptId = deptIdRaw ? Number(deptIdRaw) : null;

    const conditions: string[] = ['is_deleted = false'];
    const params: unknown[] = [];

    const scopeSql = await buildTaskScopeSql(session.user, {
      startIndex: 1,
      selectedCompanyId,
      selectedDeptId,
    });
    if (!scopeSql.hasAccess) {
      return NextResponse.json<ApiResponse<KanbanResponse>>({ success: true, data: { open: [], in_progress: [], completed: [], cancelled: [] } });
    }
    if (scopeSql.clause) {
      conditions.push(scopeSql.clause);
      params.push(...scopeSql.params);
    }

    const result = await query<Task>(
      `SELECT * FROM tasks WHERE ${conditions.join(' AND ')} ORDER BY updated_at DESC LIMIT 500`,
      params
    );

    const board: KanbanResponse = {
      open: [],
      in_progress: [],
      completed: [],
      cancelled: [],
    };

    for (const task of result.rows) {
      if (!board[task.status]) {
        board[task.status] = [];
      }
      board[task.status].push(task);
    }

    return NextResponse.json<ApiResponse<KanbanResponse>>({ success: true, data: board });
  } catch (err) {
    logger.error({ err }, 'GET /api/views/kanban error');
    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
