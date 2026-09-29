// ──────────────────────────────────────────────
// /api/org/mappings — Upsert org mappings
// ──────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { logger } from '@/lib/logger';
import { z } from 'zod';
import type { ApiResponse, DeptCompanyMap, DesigDeptMap, DesigCompanyHeadMap } from '@/types';

const mappingSchema = z.object({
  type: z.enum(['dept-company', 'desig-dept', 'desig-company-head']),
  sourceId: z.number().int().positive(),
  targetIds: z.array(z.number().int().positive()),
});

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const type = searchParams.get('type');
    const sourceId = searchParams.get('sourceId');
    const sourceType = searchParams.get('sourceType');

    if (type === 'dept-company' && sourceId) {
      // Backward compatible default: sourceType=company
      // Org mapping editor uses sourceType=dept for editing one department.
      const sql = sourceType === 'dept'
        ? 'SELECT * FROM dept_company_map WHERE dept_id = $1'
        : 'SELECT * FROM dept_company_map WHERE company_id = $1';
      const result = await query<DeptCompanyMap>(sql, [parseInt(sourceId, 10)]);
      return NextResponse.json<ApiResponse<DeptCompanyMap[]>>({ success: true, data: result.rows });
    }

    if (type === 'desig-dept' && sourceId) {
      // Backward compatible default: sourceType=dept
      // Org mapping editor uses sourceType=designation for editing one designation.
      const sql = sourceType === 'designation'
        ? 'SELECT * FROM desig_dept_map WHERE desig_id = $1'
        : 'SELECT * FROM desig_dept_map WHERE dept_id = $1';
      const result = await query<DesigDeptMap>(sql, [parseInt(sourceId, 10)]);
      return NextResponse.json<ApiResponse<DesigDeptMap[]>>({ success: true, data: result.rows });
    }

    if (type === 'desig-company-head' && sourceId) {
      const result = await query<DesigCompanyHeadMap>('SELECT * FROM desig_company_head_map WHERE desig_id = $1', [parseInt(sourceId, 10)]);
      return NextResponse.json<ApiResponse<DesigCompanyHeadMap[]>>({ success: true, data: result.rows });
    }

    // Return all mappings
    const deptCompany = await query<DeptCompanyMap>('SELECT * FROM dept_company_map');
    const desigDept = await query<DesigDeptMap>('SELECT * FROM desig_dept_map');
    const desigCompanyHead = await query<DesigCompanyHeadMap>('SELECT * FROM desig_company_head_map');

    return NextResponse.json<ApiResponse<{ deptCompany: DeptCompanyMap[]; desigDept: DesigDeptMap[]; desigCompanyHead: DesigCompanyHeadMap[] }>>({
      success: true,
      data: { deptCompany: deptCompany.rows, desigDept: desigDept.rows, desigCompanyHead: desigCompanyHead.rows },
    });
  } catch (err) {
    logger.error({ err }, 'GET /api/org/mappings error');
    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== 'admin') {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json();
    const parsed = mappingSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: parsed.error.errors[0]?.message || 'Invalid input' }, { status: 400 });
    }

    const { type, sourceId, targetIds } = parsed.data;

    if (type === 'dept-company') {
      // sourceId = dept_id, targetIds = company_ids
      // Delete removed mappings
      if (targetIds.length > 0) {
        await query(
          `DELETE FROM dept_company_map WHERE dept_id = $1 AND company_id != ALL($2::int[])`,
          [sourceId, targetIds]
        );
      } else {
        await query('DELETE FROM dept_company_map WHERE dept_id = $1', [sourceId]);
      }

      // Insert new mappings
      for (const targetId of targetIds) {
        await query(
          'INSERT INTO dept_company_map (dept_id, company_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [sourceId, targetId]
        );
      }

      const result = await query<DeptCompanyMap>(
        'SELECT * FROM dept_company_map WHERE dept_id = $1',
        [sourceId]
      );

      logger.info({ type, sourceId, count: result.rowCount }, 'Mappings updated');
      return NextResponse.json<ApiResponse<DeptCompanyMap[]>>({ success: true, data: result.rows });
    }

    if (type === 'desig-dept') {
      // sourceId = desig_id, targetIds = dept_ids
      if (targetIds.length > 0) {
        await query(
          `DELETE FROM desig_dept_map WHERE desig_id = $1 AND dept_id != ALL($2::int[])`,
          [sourceId, targetIds]
        );
      } else {
        await query('DELETE FROM desig_dept_map WHERE desig_id = $1', [sourceId]);
      }

      for (const targetId of targetIds) {
        await query(
          'INSERT INTO desig_dept_map (desig_id, dept_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [sourceId, targetId]
        );
      }

      const result = await query<DesigDeptMap>(
        'SELECT * FROM desig_dept_map WHERE desig_id = $1',
        [sourceId]
      );

      logger.info({ type, sourceId, count: result.rowCount }, 'Mappings updated');
      return NextResponse.json<ApiResponse<DesigDeptMap[]>>({ success: true, data: result.rows });
    }

    if (type === 'desig-company-head') {
      if (targetIds.length > 0) {
        await query(
          `DELETE FROM desig_company_head_map WHERE desig_id = $1 AND company_id != ALL($2::int[])`,
          [sourceId, targetIds]
        );
      } else {
        await query('DELETE FROM desig_company_head_map WHERE desig_id = $1', [sourceId]);
      }

      for (const targetId of targetIds) {
        await query(
          'INSERT INTO desig_company_head_map (desig_id, company_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [sourceId, targetId]
        );
      }

      const result = await query<DesigCompanyHeadMap>(
        'SELECT * FROM desig_company_head_map WHERE desig_id = $1',
        [sourceId]
      );

      logger.info({ type, sourceId, count: result.rowCount }, 'Mappings updated');
      return NextResponse.json<ApiResponse<DesigCompanyHeadMap[]>>({ success: true, data: result.rows });
    }

    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Invalid mapping type' }, { status: 400 });
  } catch (err) {
    logger.error({ err }, 'POST /api/org/mappings error');
    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
