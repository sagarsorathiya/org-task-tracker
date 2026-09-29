// ──────────────────────────────────────────────
// POST /api/tasks/[id]/restore — Restore soft-deleted task
// ──────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { logger } from '@/lib/logger';
import { getTaskPermissionProfile } from '@/lib/authorization';
import { beginIdempotentRequest, finalizeIdempotentRequest, hashRequestBody } from '@/lib/idempotency';
import type { ApiResponse } from '@/types';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const taskId = parseInt(params.id, 10);
    if (isNaN(taskId)) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Invalid task ID' }, { status: 400 });
    }

    const idempotencyKey = req.headers.get('idempotency-key');
    if (idempotencyKey) {
      const idemResult = await beginIdempotentRequest({
        key: idempotencyKey,
        scope: `POST:/api/tasks/${taskId}/restore`,
        requestHash: hashRequestBody({ taskId }),
      });

      if (idemResult.kind === 'conflict') {
        return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Idempotency key reuse with different payload' }, { status: 409 });
      }

      if (idemResult.kind === 'replay') {
        return NextResponse.json(idemResult.response as Record<string, unknown>, { status: idemResult.statusCode });
      }
    }

    if (session.user.role !== 'admin') {
      const scopedTask = await query<{ company_id: number | null; dept_id: number | null }>(
        'SELECT company_id, dept_id FROM tasks WHERE id = $1',
        [taskId]
      );
      if (scopedTask.rowCount === 0) {
        return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Task not found or not deleted' }, { status: 404 });
      }
      const t = scopedTask.rows[0];
      const permission = await getTaskPermissionProfile(session.user, { company_id: t.company_id, dept_id: t.dept_id });
      if (!permission.canDelete) {
        return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Forbidden' }, { status: 403 });
      }
    }

    const result = await query(
      'UPDATE tasks SET is_deleted = false, deleted_at = NULL, updated_at = NOW() WHERE id = $1 AND is_deleted = true',
      [taskId]
    );

    if (result.rowCount === 0) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Task not found or not deleted' }, { status: 404 });
    }

    await query(
      'INSERT INTO task_activity (task_id, user_id, action) VALUES ($1, $2, $3)',
      [taskId, session.user.id, 'restored']
    );

    const responseBody: ApiResponse<null> = { success: true };
    if (idempotencyKey) {
      await finalizeIdempotentRequest({
        key: idempotencyKey,
        scope: `POST:/api/tasks/${taskId}/restore`,
        response: responseBody,
        statusCode: 200,
      });
    }

    logger.info({ taskId, userId: session.user.id }, 'Task restored');
    return NextResponse.json<ApiResponse<null>>(responseBody);
  } catch (err) {
    logger.error({ err }, 'POST /api/tasks/[id]/restore error');
    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
