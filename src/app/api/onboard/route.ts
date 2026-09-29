// ──────────────────────────────────────────────
// POST /api/onboard — Complete user onboarding
// ──────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { logger } from '@/lib/logger';
import { z } from 'zod';
import type { User, ApiResponse } from '@/types';

const onboardSchema = z.object({
  companyId: z.number().int().positive(),
  deptId: z.number().int().positive().nullable().optional(),
  desigId: z.number().int().positive(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await req.json();
    const parsed = onboardSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: parsed.error.errors[0]?.message || 'Invalid input' },
        { status: 400 }
      );
    }

    const { companyId, deptId, desigId } = parsed.data;

    const companyHeadMapped = await query(
      'SELECT 1 FROM desig_company_head_map WHERE desig_id = $1 AND company_id = $2',
      [desigId, companyId]
    );
    const isCompanyHeadDesignation = (companyHeadMapped.rowCount || 0) > 0;

    if (!isCompanyHeadDesignation) {
      if (!deptId) {
        return NextResponse.json<ApiResponse<null>>(
          { success: false, error: 'Department is required for the selected designation' },
          { status: 400 }
        );
      }

      // Validate mappings exist
      const deptCompanyCheck = await query(
        'SELECT 1 FROM dept_company_map WHERE dept_id = $1 AND company_id = $2',
        [deptId, companyId]
      );
      if (deptCompanyCheck.rowCount === 0) {
        return NextResponse.json<ApiResponse<null>>(
          { success: false, error: 'Department is not mapped to the selected company' },
          { status: 400 }
        );
      }

      const desigDeptCheck = await query(
        'SELECT 1 FROM desig_dept_map WHERE desig_id = $1 AND dept_id = $2',
        [desigId, deptId]
      );
      if (desigDeptCheck.rowCount === 0) {
        return NextResponse.json<ApiResponse<null>>(
          { success: false, error: 'Designation is not mapped to the selected department' },
          { status: 400 }
        );
      }
    }

    // Update user
    const result = await query<User>(
      `UPDATE users SET
        company_id = $1,
        dept_id = $2,
        desig_id = $3,
        onboarding_complete = true,
        updated_at = NOW()
       WHERE id = $4
       RETURNING id, username, role, company_id, dept_id, desig_id, onboarding_complete, display_name, email`,
      [companyId, isCompanyHeadDesignation ? null : (deptId || null), desigId, session.user.id]
    );

    if (result.rowCount === 0) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: 'User not found' },
        { status: 404 }
      );
    }

    const user = result.rows[0];
    logger.info({ userId: user.id }, 'User onboarding completed');

    return NextResponse.json<ApiResponse<Partial<User>>>({
      success: true,
      data: user,
    });
  } catch (err) {
    logger.error({ err }, 'Onboard API error');
    return NextResponse.json<ApiResponse<null>>(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
