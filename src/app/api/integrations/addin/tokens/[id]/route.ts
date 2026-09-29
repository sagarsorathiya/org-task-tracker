// ──────────────────────────────────────────────
// DELETE /api/integrations/addin/tokens/[id] — revoke a specific add-in token
// ──────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { logger } from '@/lib/logger';
import type { ApiResponse } from '@/types';

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const tokenId = parseInt(params.id, 10);
    if (isNaN(tokenId)) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Invalid token ID' }, { status: 400 });
    }

    // Only delete if it belongs to the current user
    const result = await query(
      `DELETE FROM addin_tokens WHERE id = $1 AND user_id = $2`,
      [tokenId, session.user.id]
    );

    if ((result.rowCount ?? 0) === 0) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Token not found' }, { status: 404 });
    }

    logger.info({ userId: session.user.id, tokenId }, 'Add-in token revoked');

    return NextResponse.json<ApiResponse<{ revoked: true }>>({ success: true, data: { revoked: true } });
  } catch (err) {
    logger.error({ err }, 'Failed to revoke add-in token');
    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
