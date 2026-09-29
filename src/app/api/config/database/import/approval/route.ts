import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { logger } from '@/lib/logger';
import { issueRestoreApprovalToken } from '@/lib/restoreApproval';
import type { ApiResponse } from '@/types';

const schema = z.object({
  confirmText: z.string().min(1),
  reason: z.string().min(5).max(500),
});

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== 'admin') {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Forbidden', errorCode: 'AUTH_FORBIDDEN' }, { status: 403 });
    }

    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Invalid input', errorCode: 'VALIDATION_ERROR' }, { status: 400 });
    }

    if (parsed.data.confirmText.trim().toUpperCase() !== 'RESTORE DATABASE') {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: 'Invalid confirmation text', errorCode: 'APPROVAL_CONFIRMATION_INVALID' },
        { status: 400 }
      );
    }

    const token = issueRestoreApprovalToken({ userId: Number(session.user.id), reason: parsed.data.reason });

    await query(
      `INSERT INTO audit_log (actor_id, entity_type, entity_id, action, diff)
       VALUES ($1, 'config_database', 0, 'import_approval_issued', $2)`,
      [session.user.id, JSON.stringify({ reason: parsed.data.reason })]
    );

    return NextResponse.json<ApiResponse<{ approvalToken: string; expiresInSeconds: number }>>({
      success: true,
      data: {
        approvalToken: token,
        expiresInSeconds: 10 * 60,
      },
    });
  } catch (err) {
    logger.error({ err }, 'POST /api/config/database/import/approval error');
    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Internal server error', errorCode: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
