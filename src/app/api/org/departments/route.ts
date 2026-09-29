// ──────────────────────────────────────────────
// /api/org/departments — CRUD for departments
// ──────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { logger } from '@/lib/logger';
import { z } from 'zod';
import type { Department, ApiResponse } from '@/types';

const createSchema = z.object({
  name: z.string().min(1).max(200),
});

const updateSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(200).optional(),
  active: z.boolean().optional(),
});

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    if (Number(session.user.id) === -1) {
      return NextResponse.json<ApiResponse<Department[]>>({ success: true, data: [] });
    }

    const result = await query<Department>('SELECT * FROM departments ORDER BY name');
    return NextResponse.json<ApiResponse<Department[]>>({ success: true, data: result.rows });
  } catch (err) {
    logger.error({ err }, 'GET /api/org/departments error');
    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== 'admin') {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    if (Number(session.user.id) === -1) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Database unavailable in fallback mode' }, { status: 503 });
    }

    const body = await req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: parsed.error.errors[0]?.message || 'Invalid input' }, { status: 400 });
    }

    const result = await query<Department>(
      'INSERT INTO departments (name) VALUES ($1) RETURNING *',
      [parsed.data.name]
    );

    logger.info({ deptId: result.rows[0].id }, 'Department created');
    return NextResponse.json<ApiResponse<Department>>({ success: true, data: result.rows[0] }, { status: 201 });
  } catch (err) {
    logger.error({ err }, 'POST /api/org/departments error');
    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== 'admin') {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    if (Number(session.user.id) === -1) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Database unavailable in fallback mode' }, { status: 503 });
    }

    const body = await req.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: parsed.error.errors[0]?.message || 'Invalid input' }, { status: 400 });
    }

    const { id, name, active } = parsed.data;
    const sets: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (name !== undefined) { sets.push(`name = $${idx++}`); params.push(name); }
    if (active !== undefined) { sets.push(`active = $${idx++}`); params.push(active); }

    if (sets.length === 0) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'No fields to update' }, { status: 400 });
    }

    params.push(id);
    const result = await query<Department>(
      `UPDATE departments SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );

    if (result.rowCount === 0) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Department not found' }, { status: 404 });
    }

    return NextResponse.json<ApiResponse<Department>>({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error({ err }, 'PUT /api/org/departments error');
    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== 'admin') {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    if (Number(session.user.id) === -1) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Database unavailable in fallback mode' }, { status: 503 });
    }

    const { searchParams } = new URL(req.url);
    const id = parseInt(searchParams.get('id') || '', 10);
    if (!id) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'ID is required' }, { status: 400 });
    }

    const result = await query<Department>(
      `WITH removed_company_mappings AS (
         DELETE FROM dept_company_map WHERE dept_id = $1
       ),
       removed_designation_mappings AS (
         DELETE FROM desig_dept_map WHERE dept_id = $1
       )
       DELETE FROM departments WHERE id = $1 RETURNING *`,
      [id]
    );
    if (result.rowCount === 0) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Department not found' }, { status: 404 });
    }

    return NextResponse.json<ApiResponse<null>>({ success: true });
  } catch (err: unknown) {
    if ((err as { code?: string }).code === '23503') {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Cannot permanently delete: department is referenced by users/tasks' }, { status: 409 });
    }
    logger.error({ err }, 'DELETE /api/org/departments error');
    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
