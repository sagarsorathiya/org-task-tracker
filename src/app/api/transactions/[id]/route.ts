// ──────────────────────────────────────────────
// /api/transactions/[id] — GET detail, PUT update, DELETE soft-delete
// ──────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { logger } from '@/lib/logger';
import {
  canUserAccessTransactionReminderId,
  canUserModifyTransactionReminderId,
  resolveWritableTaskScope,
  canCreateTaskInScope,
} from '@/lib/authorization';
import { z } from 'zod';
import type { TransactionReminder, ApiResponse } from '@/types';

const updateSchema = z.object({
  type: z.enum(['subscription', 'payment']).optional(),
  partyName: z.string().trim().min(1).max(300).optional(),
  vendorCode: z.string().trim().max(100).optional().nullable(),
  place: z.string().trim().max(200).optional().nullable(),
  agreement: z.string().trim().max(5000).optional().nullable(),
  executionDate: z.string().optional().nullable(),
  billDate: z.string().optional().nullable(),
  reminderDate: z.string().min(1).optional(),
  reminderTime: z.string().min(1).optional(),
  recurrence: z.enum(['none', 'weekly', 'monthly', 'yearly']).optional(),
  reminderEmails: z.array(z.string().trim().email()).min(1).max(20).optional(),
  companyId: z.number().int().positive().optional().nullable(),
  deptId: z.number().int().positive().optional().nullable(),
});

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const id = parseInt(params.id, 10);
    if (Number.isNaN(id)) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Invalid ID' }, { status: 400 });
    }

    const canAccess = await canUserAccessTransactionReminderId(session.user, id);
    if (!canAccess) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const result = await query<TransactionReminder>(
      `SELECT tr.*, c.name as company_name, d.name as dept_name
       FROM transaction_reminders tr
       LEFT JOIN companies c ON tr.company_id = c.id
       LEFT JOIN departments d ON tr.dept_id = d.id
       WHERE tr.id = $1`,
      [id]
    );

    if (result.rowCount === 0) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json<ApiResponse<TransactionReminder>>({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error({ err }, 'GET /api/transactions/[id] error');
    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const id = parseInt(params.id, 10);
    if (Number.isNaN(id)) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Invalid ID' }, { status: 400 });
    }

    const canModify = await canUserModifyTransactionReminderId(session.user, id);
    if (!canModify) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const existingResult = await query<TransactionReminder>(
      'SELECT * FROM transaction_reminders WHERE id = $1 AND is_deleted = false',
      [id]
    );
    if (existingResult.rowCount === 0) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Not found' }, { status: 404 });
    }
    const existing = existingResult.rows[0];

    const body = await req.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: parsed.error.errors[0]?.message || 'Invalid input', errorCode: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const data = parsed.data;

    let companyId = existing.company_id;
    let deptId = existing.dept_id;
    if (data.companyId !== undefined || data.deptId !== undefined) {
      const requestedCompanyId = data.companyId !== undefined ? data.companyId : existing.company_id;
      const requestedDeptId = data.deptId !== undefined ? data.deptId : existing.dept_id;
      const writableScope = await resolveWritableTaskScope(session.user, requestedCompanyId, requestedDeptId);
      if (session.user.role !== 'admin' && !writableScope.companyId) {
        return NextResponse.json<ApiResponse<null>>({ success: false, error: 'No valid company/department assignment for this scope' }, { status: 403 });
      }
      const createPermission = await canCreateTaskInScope(session.user, writableScope.companyId, writableScope.deptId);
      if (session.user.role !== 'admin' && !createPermission.allowed) {
        return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Editing is not permitted in this scope.' }, { status: 403 });
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
      companyId = writableScope.companyId;
      deptId = writableScope.deptId;
    }

    const nextReminderDate = data.reminderDate ?? existing.reminder_date;
    const nextReminderTime = data.reminderTime ?? existing.reminder_time;
    const reminderDateTimeChanged = nextReminderDate !== existing.reminder_date || nextReminderTime !== existing.reminder_time;
    // Editing the reminder datetime on an already-sent record re-arms the one-shot —
    // otherwise a corrected date would silently never fire again.
    const resetReminderSent = existing.is_reminder_sent && reminderDateTimeChanged;

    const normalizedEmails = data.reminderEmails
      ? Array.from(new Set(data.reminderEmails.map((e) => e.trim().toLowerCase())))
      : existing.reminder_emails;

    const result = await query<TransactionReminder>(
      `UPDATE transaction_reminders SET
        type = $1,
        party_name = $2,
        vendor_code = $3,
        place = $4,
        agreement = $5,
        execution_date = $6,
        bill_date = $7,
        reminder_date = $8,
        reminder_time = $9,
        recurrence = $10,
        reminder_emails = $11,
        company_id = $12,
        dept_id = $13,
        is_reminder_sent = CASE WHEN $14 THEN false ELSE is_reminder_sent END,
        reminder_sent_at = CASE WHEN $14 THEN NULL ELSE reminder_sent_at END,
        updated_at = NOW()
       WHERE id = $15
       RETURNING *`,
      [
        data.type ?? existing.type,
        data.partyName?.trim() ?? existing.party_name,
        data.vendorCode !== undefined ? (data.vendorCode?.trim() || null) : existing.vendor_code,
        data.place !== undefined ? (data.place?.trim() || null) : existing.place,
        data.agreement !== undefined ? (data.agreement?.trim() || null) : existing.agreement,
        data.executionDate !== undefined ? (data.executionDate || null) : existing.execution_date,
        data.billDate !== undefined ? (data.billDate || null) : existing.bill_date,
        nextReminderDate,
        nextReminderTime,
        data.recurrence ?? existing.recurrence,
        normalizedEmails,
        companyId,
        deptId,
        resetReminderSent,
        id,
      ]
    );

    logger.info({ transactionId: id, userId: session.user.id }, 'Transaction reminder updated');
    return NextResponse.json<ApiResponse<TransactionReminder>>({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error({ err }, 'PUT /api/transactions/[id] error');
    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const id = parseInt(params.id, 10);
    if (Number.isNaN(id)) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Invalid ID' }, { status: 400 });
    }

    const canModify = await canUserModifyTransactionReminderId(session.user, id);
    if (!canModify) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const result = await query(
      'UPDATE transaction_reminders SET is_deleted = true, deleted_at = NOW() WHERE id = $1 AND is_deleted = false',
      [id]
    );

    if (result.rowCount === 0) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Not found' }, { status: 404 });
    }

    logger.info({ transactionId: id, userId: session.user.id }, 'Transaction reminder deleted');
    return NextResponse.json<ApiResponse<null>>({ success: true });
  } catch (err) {
    logger.error({ err }, 'DELETE /api/transactions/[id] error');
    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
