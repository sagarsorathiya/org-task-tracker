// ──────────────────────────────────────────────
// /api/users/[id] — GET, PUT, DELETE user
// ──────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { pool, query } from '@/lib/db';
import { logger } from '@/lib/logger';
import { z } from 'zod';
import type { User, ApiResponse, UserScopeAssignment } from '@/types';

const updateSchema = z.object({
  displayName: z.string().max(200).optional(),
  email: z.string().email().optional().nullable(),
  mobileNumber: z.string().max(20).optional().nullable(),
  companyId: z.number().int().positive().optional().nullable(),
  deptId: z.number().int().positive().optional().nullable(),
  desigId: z.number().int().positive().optional().nullable(),
  role: z.enum(['admin', 'manager', 'user']).optional(),
  isActive: z.boolean().optional(),
  scopeAssignments: z.array(z.object({
    companyId: z.number().int().positive(),
    deptId: z.number().int().positive().nullable().optional(),
    desigId: z.number().int().positive().nullable().optional(),
    responsibilityType: z.string().max(150).nullable().optional(),
    isPrimary: z.boolean().optional(),
    isActive: z.boolean().optional(),
    activeFrom: z.string().nullable().optional(),
    activeTo: z.string().nullable().optional(),
  })).optional(),
});

function normalizeResponsibilityType(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.toLowerCase().replace(/\s+/g, '_');
}

const RESERVED_SYSTEM_ROLE_TOKENS = new Set(['admin', 'manager', 'user']);

const USER_SAFE_COLUMNS = `
  id, username, display_name, email, mobile_number,
  company_id, dept_id, desig_id, role, auth_type,
  is_active, onboarding_complete, created_at, updated_at, last_login_at
`;

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Unauthorized' }, { status: 401 });

    const userId = parseInt(params.id, 10);

    // Regular users may only view their own profile; admins and managers can view any user
    const isAdminOrManager = session.user.role === 'admin' || session.user.role === 'manager';
    const isSelf = Number(session.user.id) === userId;
    if (!isAdminOrManager && !isSelf) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const result = await query<User>(
      `SELECT u.id, u.username, u.display_name, u.email, u.mobile_number,
              u.company_id, u.dept_id, u.desig_id, u.role, u.auth_type,
              u.is_active, u.onboarding_complete, u.created_at, u.updated_at, u.last_login_at,
              c.name as company_name,
              d.name as dept_name,
              dg.name as desig_name
       FROM users u
       LEFT JOIN companies c ON u.company_id = c.id
       LEFT JOIN departments d ON u.dept_id = d.id
       LEFT JOIN designations dg ON u.desig_id = dg.id
       WHERE u.id = $1`,
      [userId]
    );

    if (result.rowCount === 0) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'User not found' }, { status: 404 });
    }

    const assignments = await query<UserScopeAssignment>(
      `SELECT usa.*, c.name as company_name, d.name as dept_name, dg.name as desig_name
       FROM user_scope_assignments usa
       LEFT JOIN companies c ON c.id = usa.company_id
       LEFT JOIN departments d ON d.id = usa.dept_id
       LEFT JOIN designations dg ON dg.id = usa.desig_id
       WHERE usa.user_id = $1
       ORDER BY usa.is_primary DESC, usa.id ASC`,
      [userId]
    );

    result.rows[0].scope_assignments = assignments.rows;

    return NextResponse.json<ApiResponse<User>>({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error({ err }, 'GET /api/users/[id] error');
    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== 'admin') {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const userId = parseInt(params.id, 10);
    const body = await req.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: parsed.error.errors[0]?.message || 'Invalid input' }, { status: 400 });
    }

    const existingUser = await query<{ id: number; role: 'admin' | 'manager' | 'user' }>(
      'SELECT id, role FROM users WHERE id = $1',
      [userId]
    );
    if ((existingUser.rowCount || 0) === 0) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'User not found' }, { status: 404 });
    }

    const data = parsed.data;
    const targetRole = data.role ?? existingUser.rows[0].role;
    const isTargetAdmin = targetRole === 'admin';
    const hasScopeAssignmentsUpdate = data.scopeAssignments !== undefined;
    const sets: string[] = ['updated_at = NOW()'];
    const p: unknown[] = [];
    let idx = 1;

    if (data.displayName !== undefined) { sets.push(`display_name = $${idx++}`); p.push(data.displayName); }
    if (data.email !== undefined) { sets.push(`email = $${idx++}`); p.push(data.email); }
    if (data.mobileNumber !== undefined) { sets.push(`mobile_number = $${idx++}`); p.push(data.mobileNumber); }
    if (isTargetAdmin) {
      sets.push('company_id = NULL');
      sets.push('dept_id = NULL');
      sets.push('desig_id = NULL');
    } else {
      if (data.companyId !== undefined) { sets.push(`company_id = $${idx++}`); p.push(data.companyId); }
      if (data.deptId !== undefined) { sets.push(`dept_id = $${idx++}`); p.push(data.deptId); }
      if (data.desigId !== undefined) { sets.push(`desig_id = $${idx++}`); p.push(data.desigId); }
    }
    if (data.role !== undefined) { sets.push(`role = $${idx++}`); p.push(data.role); }
    if (data.isActive !== undefined) { sets.push(`is_active = $${idx++}`); p.push(data.isActive); }

    if (sets.length <= 1 && !hasScopeAssignmentsUpdate && !isTargetAdmin) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'No fields to update' }, { status: 400 });
    }

    p.push(userId);
    let result: { rows: User[]; rowCount: number | null } = { rows: [], rowCount: 0 };
    if (sets.length > 1) {
      result = await query<User>(
        `UPDATE users SET ${sets.join(', ')} WHERE id = $${idx} RETURNING ${USER_SAFE_COLUMNS}`,
        p
      );
    } else {
      result = await query<User>(`SELECT ${USER_SAFE_COLUMNS} FROM users WHERE id = $1`, [userId]);
    }

    if (result.rowCount === 0) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'User not found' }, { status: 404 });
    }

    if (isTargetAdmin) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM user_scope_assignments WHERE user_id = $1', [userId]);
        await client.query(
          `UPDATE users
           SET company_id = NULL, dept_id = NULL, desig_id = NULL, updated_at = NOW()
           WHERE id = $1`,
          [userId]
        );
        await client.query('COMMIT');
      } catch (txErr) {
        await client.query('ROLLBACK');
        throw txErr;
      } finally {
        client.release();
      }

      const refreshed = await query<User>('SELECT * FROM users WHERE id = $1', [userId]);
      if ((refreshed.rowCount || 0) > 0) {
        result = refreshed;
      }
    } else if (data.scopeAssignments !== undefined) {
      const desigIds = Array.from(new Set(data.scopeAssignments.map((a) => a.desigId).filter((v): v is number => !!v)));
      const companyHeadMap = desigIds.length > 0
        ? await query<{ desig_id: number; company_id: number }>(
            'SELECT desig_id, company_id FROM desig_company_head_map WHERE desig_id = ANY($1::int[])',
            [desigIds]
          )
        : { rows: [] as Array<{ desig_id: number; company_id: number }> };
      const companyHeadPairs = new Set(companyHeadMap.rows.map((r) => `${r.desig_id}:${r.company_id}`));

      const prepared = data.scopeAssignments.map((item) => ({
        companyId: item.companyId,
        deptId: item.deptId ?? null,
        desigId: item.desigId ?? null,
        mappedCompanyHead: item.desigId ? companyHeadPairs.has(`${item.desigId}:${item.companyId}`) : false,
        responsibilityType: normalizeResponsibilityType(item.responsibilityType),
        isPrimary: !!item.isPrimary,
        isActive: item.isActive ?? true,
        activeFrom: item.activeFrom ?? null,
        activeTo: item.activeTo ?? null,
      })).map((item) => {
        const resolvedResponsibilityType = item.mappedCompanyHead ? 'company_head' : item.responsibilityType;
        const isCompanyHead = resolvedResponsibilityType === 'company_head';
        return {
        companyId: item.companyId,
        deptId: isCompanyHead ? null : (item.deptId ?? null),
        desigId: item.desigId ?? null,
        responsibilityType: resolvedResponsibilityType,
        isPrimary: !!item.isPrimary,
        isActive: item.isActive ?? true,
        activeFrom: item.activeFrom ?? null,
        activeTo: item.activeTo ?? null,
        };
      });

      if (prepared.length === 0) {
        return NextResponse.json<ApiResponse<null>>({ success: false, error: 'At least one assignment row is required' }, { status: 400 });
      }

      const activeAssignments = prepared.filter((a) => a.isActive);
      if (activeAssignments.length === 0) {
        return NextResponse.json<ApiResponse<null>>({ success: false, error: 'At least one assignment must be active' }, { status: 400 });
      }

      const activePrimaryCount = activeAssignments.filter((a) => a.isPrimary).length;
      if (activePrimaryCount !== 1) {
        return NextResponse.json<ApiResponse<null>>(
          { success: false, error: 'Exactly one active primary assignment is required per user' },
          { status: 400 }
        );
      }

      const dedupeKeys = new Set<string>();
      for (const assignment of prepared) {
        const key = `${assignment.companyId}:${assignment.deptId ?? 'all'}:${assignment.desigId ?? 'none'}`;
        if (dedupeKeys.has(key)) {
          return NextResponse.json<ApiResponse<null>>(
            { success: false, error: 'Duplicate assignment rows are not allowed' },
            { status: 400 }
          );
        }
        dedupeKeys.add(key);

        if (assignment.responsibilityType && RESERVED_SYSTEM_ROLE_TOKENS.has(assignment.responsibilityType)) {
          return NextResponse.json<ApiResponse<null>>(
            { success: false, error: 'Responsibility must be business-oriented and cannot be a system role (admin/supervisor/user)' },
            { status: 400 }
          );
        }

        if (assignment.responsibilityType === 'department_head' && !assignment.deptId) {
          return NextResponse.json<ApiResponse<null>>(
            { success: false, error: 'Department Head assignment requires a specific department' },
            { status: 400 }
          );
        }

        if (assignment.deptId) {
          const mapped = await query(
            'SELECT 1 FROM dept_company_map WHERE dept_id = $1 AND company_id = $2',
            [assignment.deptId, assignment.companyId]
          );
          if (mapped.rowCount === 0) {
            return NextResponse.json<ApiResponse<null>>(
              { success: false, error: 'One or more assignment rows have invalid Company-Department mapping' },
              { status: 400 }
            );
          }
        }

        if (assignment.isActive && assignment.responsibilityType === 'department_head' && assignment.deptId) {
          const existingHead = await query<{ user_id: number }>(
            `SELECT user_id
             FROM user_scope_assignments
             WHERE company_id = $1
               AND dept_id = $2
               AND is_active = true
               AND lower(coalesce(responsibility_type, '')) = 'department_head'
               AND user_id <> $3
             LIMIT 1`,
            [assignment.companyId, assignment.deptId, userId]
          );
          if (existingHead.rowCount && existingHead.rowCount > 0) {
            return NextResponse.json<ApiResponse<null>>(
              { success: false, error: 'This company and department already has an active Department Head' },
              { status: 409 }
            );
          }
        }
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM user_scope_assignments WHERE user_id = $1', [userId]);

        for (const assignment of prepared) {
          await client.query(
            `INSERT INTO user_scope_assignments
              (user_id, company_id, dept_id, desig_id, responsibility_type, is_primary, is_active, active_from, active_to, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9::timestamptz, $10)`,
            [
              userId,
              assignment.companyId,
              assignment.deptId,
              assignment.desigId,
              assignment.responsibilityType,
              assignment.isPrimary,
              assignment.isActive,
              assignment.activeFrom,
              assignment.activeTo,
              session.user.id,
            ]
          );
        }

        const primary = activeAssignments.find((a) => a.isPrimary);
        if (!primary) {
          throw new Error('Primary assignment not found');
        }

        await client.query(
          `UPDATE users
           SET company_id = $1, dept_id = $2, desig_id = $3, updated_at = NOW()
           WHERE id = $4`,
          [primary.companyId, primary.deptId, primary.desigId, userId]
        );

        await client.query('COMMIT');
      } catch (txErr) {
        await client.query('ROLLBACK');
        throw txErr;
      } finally {
        client.release();
      }
    }

    // Audit log
    await query(
      'INSERT INTO audit_log (actor_id, entity_type, entity_id, action, diff) VALUES ($1, $2, $3, $4, $5)',
      [session.user.id, 'user', userId, 'updated', JSON.stringify(data)]
    );

    const assignments = await query<UserScopeAssignment>(
      `SELECT usa.*, c.name as company_name, d.name as dept_name, dg.name as desig_name
       FROM user_scope_assignments usa
       LEFT JOIN companies c ON c.id = usa.company_id
       LEFT JOIN departments d ON d.id = usa.dept_id
       LEFT JOIN designations dg ON dg.id = usa.desig_id
       WHERE usa.user_id = $1
       ORDER BY usa.is_primary DESC, usa.id ASC`,
      [userId]
    );
    result.rows[0].scope_assignments = assignments.rows;

    logger.info({ userId, updatedBy: session.user.id }, 'User updated');
    return NextResponse.json<ApiResponse<User>>({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error({ err }, 'PUT /api/users/[id] error');
    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== 'admin') {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const userId = parseInt(params.id, 10);

    // Cannot delete yourself
    if (userId === session.user.id) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Cannot delete your own account' }, { status: 400 });
    }

    // Cannot delete the last admin
    const adminCount = await query<{ count: string }>(
      "SELECT COUNT(*) as count FROM users WHERE role = 'admin' AND is_active = true"
    );
    const userToDelete = await query<{ id: number; role: string }>('SELECT id, role FROM users WHERE id = $1', [userId]);

    if (userToDelete.rowCount === 0) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'User not found' }, { status: 404 });
    }

    if (userToDelete.rows[0].role === 'admin' && parseInt(adminCount.rows[0]?.count || '0', 10) <= 1) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Cannot delete the last admin' }, { status: 400 });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Nullify user references so hard delete can succeed.
      await client.query('UPDATE tasks SET assigned_to = NULL WHERE assigned_to = $1', [userId]);
      await client.query('UPDATE tasks SET assigned_by = NULL WHERE assigned_by = $1', [userId]);
      await client.query(
        'UPDATE tasks SET assigned_to_ids = array_remove(assigned_to_ids, $1) WHERE assigned_to_ids @> ARRAY[$1]::int[]',
        [userId]
      );
      await client.query('UPDATE task_comments SET user_id = NULL WHERE user_id = $1', [userId]);
      await client.query('UPDATE task_activity SET user_id = NULL WHERE user_id = $1', [userId]);
      await client.query('UPDATE task_attachments SET uploaded_by = NULL WHERE uploaded_by = $1', [userId]);
      await client.query('UPDATE subtasks SET created_by = NULL WHERE created_by = $1', [userId]);
      await client.query('UPDATE reminder_rules SET created_by = NULL WHERE created_by = $1', [userId]);
      await client.query('UPDATE audit_log SET actor_id = NULL WHERE actor_id = $1', [userId]);

      // Explicitly remove assignment rows before deleting user.
      await client.query('DELETE FROM user_scope_assignments WHERE user_id = $1', [userId]);

      await client.query('DELETE FROM users WHERE id = $1', [userId]);

      await client.query(
        'INSERT INTO audit_log (actor_id, entity_type, entity_id, action) VALUES ($1, $2, $3, $4)',
        [session.user.id, 'user', userId, 'deleted']
      );

      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    logger.info({ userId, deletedBy: session.user.id }, 'User deleted');
    return NextResponse.json<ApiResponse<null>>({ success: true });
  } catch (err) {
    logger.error({ err }, 'DELETE /api/users/[id] error');
    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
