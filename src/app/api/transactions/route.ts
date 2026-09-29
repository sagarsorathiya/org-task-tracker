// ──────────────────────────────────────────────
// /api/transactions — GET list, POST create
// ──────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { logger } from '@/lib/logger';
import { buildTaskScopeSql, canCreateTaskInScope, resolveWritableTaskScope } from '@/lib/authorization';
import { z } from 'zod';
import { PAGINATION_DEFAULTS } from '@/constants';
import type { TransactionReminder, ApiResponse, PaginatedResponse } from '@/types';

const createSchema = z.object({
  type: z.enum(['subscription', 'payment']),
  partyName: z.string().trim().min(1, 'Party Name is required').max(300),
  vendorCode: z.string().trim().max(100).optional(),
  place: z.string().trim().max(200).optional(),
  agreement: z.string().trim().max(5000).optional(),
  executionDate: z.string().optional(),
  billDate: z.string().optional(),
  reminderDate: z.string().min(1, 'Reminder Date is required'),
  reminderTime: z.string().min(1, 'Reminder Time is required'),
  recurrence: z.enum(['none', 'weekly', 'monthly', 'yearly']).optional().default('none'),
  reminderEmails: z.array(z.string().trim().email()).min(1, 'At least one reminder email is required').max(20),
  companyId: z.number().int().positive().optional(),
  deptId: z.number().int().positive({ message: 'Department is required' }),
});

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const search = searchParams.get('search') || '';
    const type = searchParams.get('type') || '';
    const deptId = searchParams.get('deptId') || '';
    const companyId = searchParams.get('companyId') || '';
    const deleted = searchParams.get('deleted') === 'true';
    const page = Math.max(1, parseInt(searchParams.get('page') || String(PAGINATION_DEFAULTS.PAGE), 10));
    const limit = Math.min(
      PAGINATION_DEFAULTS.MAX_LIMIT,
      Math.max(1, parseInt(searchParams.get('limit') || String(PAGINATION_DEFAULTS.LIMIT), 10))
    );
    const sortBy = searchParams.get('sortBy') || 'created_at';
    const sortDir = searchParams.get('sortDir') === 'asc' ? 'ASC' : 'DESC';
    const offset = (page - 1) * limit;

    const allowedSorts = ['id', 'type', 'party_name', 'reminder_date', 'execution_date', 'bill_date', 'created_at'];
    const safeSortBy = allowedSorts.includes(sortBy) ? sortBy : 'created_at';

    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    const scopeSql = await buildTaskScopeSql(session.user, { tableAlias: 'tr', startIndex: idx });
    if (!scopeSql.hasAccess) {
      conditions.push('1=0');
    } else if (scopeSql.clause) {
      conditions.push(scopeSql.clause);
      params.push(...scopeSql.params);
      idx = scopeSql.nextIndex;
    }

    if (deleted && session.user.role === 'admin') {
      conditions.push('tr.is_deleted = true');
    } else {
      conditions.push('tr.is_deleted = false');
    }

    if (search) {
      conditions.push(`(tr.party_name ILIKE $${idx} OR tr.vendor_code ILIKE $${idx} OR tr.place ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }
    if (type === 'subscription' || type === 'payment') { conditions.push(`tr.type = $${idx++}`); params.push(type); }
    if (deptId) { conditions.push(`tr.dept_id = $${idx++}`); params.push(parseInt(deptId, 10)); }
    if (companyId) { conditions.push(`tr.company_id = $${idx++}`); params.push(parseInt(companyId, 10)); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM transaction_reminders tr ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0]?.count || '0', 10);

    const dataResult = await query<TransactionReminder>(
      `SELECT tr.*, c.name as company_name, d.name as dept_name,
        COALESCE(att.attachment_count, 0) as attachment_count
       FROM transaction_reminders tr
       LEFT JOIN companies c ON tr.company_id = c.id
       LEFT JOIN departments d ON tr.dept_id = d.id
       LEFT JOIN LATERAL (
         SELECT COUNT(*) as attachment_count
         FROM transaction_reminder_attachments tra
         WHERE tra.transaction_id = tr.id
       ) att ON true
       ${where}
       ORDER BY tr.${safeSortBy} ${sortDir}
       LIMIT $${idx++} OFFSET $${idx}`,
      [...params, limit, offset]
    );

    return NextResponse.json<ApiResponse<PaginatedResponse<TransactionReminder>>>({
      success: true,
      data: {
        items: dataResult.rows,
        total,
        page,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    logger.error({ err }, 'GET /api/transactions error');
    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: parsed.error.errors[0]?.message || 'Invalid input', errorCode: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const {
      type, partyName, vendorCode, place, agreement, executionDate, billDate,
      reminderDate, reminderTime, recurrence, reminderEmails, companyId, deptId,
    } = parsed.data;

    const writableScope = await resolveWritableTaskScope(session.user, companyId || null, deptId || null);
    if (session.user.role !== 'admin' && !writableScope.companyId) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'No valid company/department assignment for this scope' }, { status: 403 });
    }

    const createPermission = await canCreateTaskInScope(session.user, writableScope.companyId, writableScope.deptId);
    if (session.user.role !== 'admin' && !createPermission.allowed) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Creation is not permitted in this scope.' }, { status: 403 });
    }

    if (deptId && !companyId && session.user.role === 'admin') {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Company is required when Department is selected' }, { status: 400 });
    }

    if (writableScope.companyId && writableScope.deptId) {
      const mappingCheck = await query(
        'SELECT 1 FROM dept_company_map WHERE dept_id = $1 AND company_id = $2',
        [writableScope.deptId, writableScope.companyId]
      );
      if (mappingCheck.rowCount === 0) {
        return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Department is not mapped to selected company' }, { status: 400 });
      }
    }

    const normalizedEmails = Array.from(new Set(reminderEmails.map((e) => e.trim().toLowerCase())));

    const result = await query<TransactionReminder>(
      `INSERT INTO transaction_reminders (
        type, party_name, vendor_code, place, agreement, execution_date, bill_date,
        reminder_date, reminder_time, recurrence, reminder_emails, company_id, dept_id, created_by
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING *`,
      [
        type,
        partyName.trim(),
        vendorCode?.trim() || null,
        place?.trim() || null,
        agreement?.trim() || null,
        executionDate || null,
        billDate || null,
        reminderDate,
        reminderTime,
        recurrence,
        normalizedEmails,
        writableScope.companyId,
        writableScope.deptId,
        session.user.id,
      ]
    );

    const record = result.rows[0];
    logger.info({ transactionId: record.id, userId: session.user.id }, 'Transaction reminder created');
    return NextResponse.json<ApiResponse<TransactionReminder>>({ success: true, data: record }, { status: 201 });
  } catch (err) {
    logger.error({ err }, 'POST /api/transactions error');
    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
