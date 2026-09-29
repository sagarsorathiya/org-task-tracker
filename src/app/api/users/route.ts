// ──────────────────────────────────────────────
// /api/users — GET list + POST create, Admin only
// ──────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { pool, query } from '@/lib/db';
import { logger } from '@/lib/logger';
import type { User, ApiResponse, PaginatedResponse } from '@/types';

// scrypt parameters — cost=2^15, blockSize=8, parallelism=1, keyLen=64
const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LEN = 64;

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await new Promise<Buffer>((resolve, reject) =>
    crypto.scrypt(password, salt, SCRYPT_KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 64 * 1024 * 1024 }, (err, derivedKey) =>
      err ? reject(err) : resolve(derivedKey)
    )
  );
  return `${salt}:${hash.toString('hex')}`;
}

const createSchema = z.object({
  username: z.string().min(1).max(100).regex(/^[a-zA-Z0-9._\-@]+$/, 'Username may only contain letters, digits, dots, underscores, hyphens, or @'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  displayName: z.string().min(1).max(200),
  email: z.string().email().optional().nullable(),
  mobileNumber: z.string().max(20).optional().nullable(),
  role: z.enum(['admin', 'manager', 'user']),
  companyId: z.number().int().positive().optional().nullable(),
  deptId: z.number().int().positive().optional().nullable(),
  desigId: z.number().int().positive().optional().nullable(),
  scopeAssignments: z.array(z.object({
    companyId: z.number().int().positive(),
    deptId: z.number().int().positive().nullable().optional(),
    desigId: z.number().int().positive().nullable().optional(),
    responsibilityType: z.string().max(150).nullable().optional(),
    isPrimary: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })).optional(),
});

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role === 'user') {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    // Local admin fallback session when DB is unavailable.
    if (Number(session.user.id) === -1) {
      const page = Math.max(1, parseInt(new URL(req.url).searchParams.get('page') || '1', 10));
      return NextResponse.json<ApiResponse<PaginatedResponse<User>>>({
        success: true,
        data: { items: [], total: 0, page, totalPages: 0 },
      });
    }

    const { searchParams } = new URL(req.url);
    const search = searchParams.get('search') || '';
    const role = searchParams.get('role') || '';
    const deptId = searchParams.get('deptId') || '';
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)));
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (search) {
      conditions.push(`(u.username ILIKE $${idx} OR u.display_name ILIKE $${idx} OR u.email ILIKE $${idx} OR u.mobile_number ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }
    if (role) { conditions.push(`u.role = $${idx++}`); params.push(role); }
    if (deptId) { conditions.push(`u.dept_id = $${idx++}`); params.push(parseInt(deptId, 10)); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await query<{ count: string }>(`SELECT COUNT(*) as count FROM users u ${where}`, params);
    const total = parseInt(countResult.rows[0]?.count || '0', 10);

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
       ${where}
       ORDER BY u.display_name NULLS LAST, u.username
       LIMIT $${idx++} OFFSET $${idx}`,
      [...params, limit, offset]
    );

    return NextResponse.json<ApiResponse<PaginatedResponse<User>>>({
      success: true,
      data: { items: result.rows, total, page, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    logger.error({ err }, 'GET /api/users error');
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
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: parsed.error.errors[0]?.message || 'Invalid input' },
        { status: 400 }
      );
    }

    const data = parsed.data;
    const isAdmin = data.role === 'admin';

    // Check username uniqueness
    const existing = await query('SELECT id FROM users WHERE lower(username) = lower($1)', [data.username]);
    if ((existing.rowCount || 0) > 0) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Username already exists' }, { status: 409 });
    }

    const passwordHash = await hashPassword(data.password);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const insertResult = await client.query<User>(
        `INSERT INTO users
           (username, display_name, email, mobile_number, role, auth_type,
            company_id, dept_id, desig_id, is_active, onboarding_complete, password_hash, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'local', $6, $7, $8, true, true, $9, NOW(), NOW())
         RETURNING id, username, display_name, email, mobile_number,
                   company_id, dept_id, desig_id, role, auth_type,
                   is_active, onboarding_complete, created_at, updated_at, last_login_at`,
        [
          data.username,
          data.displayName,
          data.email || null,
          data.mobileNumber || null,
          data.role,
          isAdmin ? null : (data.companyId || null),
          isAdmin ? null : (data.deptId || null),
          isAdmin ? null : (data.desigId || null),
          passwordHash,
        ]
      );

      const newUser = insertResult.rows[0];

      if (!isAdmin && data.scopeAssignments && data.scopeAssignments.length > 0) {
        for (const assignment of data.scopeAssignments) {
          await client.query(
            `INSERT INTO user_scope_assignments
               (user_id, company_id, dept_id, desig_id, responsibility_type, is_primary, is_active, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              newUser.id,
              assignment.companyId,
              assignment.deptId || null,
              assignment.desigId || null,
              assignment.responsibilityType || null,
              !!assignment.isPrimary,
              assignment.isActive !== false,
              session.user.id,
            ]
          );
        }

        const primary = data.scopeAssignments.find((a) => a.isPrimary);
        if (primary) {
          await client.query(
            `UPDATE users SET company_id = $1, dept_id = $2, desig_id = $3 WHERE id = $4`,
            [primary.companyId, primary.deptId || null, primary.desigId || null, newUser.id]
          );
        }
      }

      await client.query(
        'INSERT INTO audit_log (actor_id, entity_type, entity_id, action, diff) VALUES ($1, $2, $3, $4, $5)',
        [session.user.id, 'user', newUser.id, 'created', JSON.stringify({ username: data.username, role: data.role, auth_type: 'local' })]
      );

      await client.query('COMMIT');
      logger.info({ userId: newUser.id, createdBy: session.user.id }, 'Manual local user created');
      return NextResponse.json<ApiResponse<User>>({ success: true, data: newUser }, { status: 201 });
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error({ err }, 'POST /api/users error');
    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
