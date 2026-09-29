import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { logger } from '@/lib/logger';
import type { ApiResponse, AuditLog, PaginatedResponse } from '@/types';

interface MailAuditRow extends AuditLog {
  actor_username?: string | null;
  recipient_email?: string | null;
  subject?: string | null;
  task_id?: string | null;
  attempts?: string | null;
  delivery_status?: string | null;
  error?: string | null;
}

function safeDateValue(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== 'admin') {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    if (Number(session.user.id) === -1) {
      const page = Math.max(1, parseInt(new URL(req.url).searchParams.get('page') || '1', 10));
      return NextResponse.json<ApiResponse<PaginatedResponse<MailAuditRow>>>(
        { success: true, data: { items: [], total: 0, page, totalPages: 0 } }
      );
    }

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '25', 10)));
    const offset = (page - 1) * limit;

    const action = (searchParams.get('action') || '').trim();
    const recipient = (searchParams.get('recipient') || '').trim();
    const subject = (searchParams.get('subject') || '').trim();
    const from = safeDateValue(searchParams.get('from'));
    const to = safeDateValue(searchParams.get('to'));

    const conditions: string[] = ["al.entity_type = 'email_outbox'"];
    const params: unknown[] = [];
    let idx = 1;

    if (action) {
      conditions.push(`al.action ILIKE $${idx}`);
      params.push(`%${action}%`);
      idx += 1;
    }

    if (recipient) {
      conditions.push(`COALESCE(al.diff->>'recipientEmail', '') ILIKE $${idx}`);
      params.push(`%${recipient}%`);
      idx += 1;
    }

    if (subject) {
      conditions.push(`COALESCE(al.diff->>'subject', '') ILIKE $${idx}`);
      params.push(`%${subject}%`);
      idx += 1;
    }

    if (from) {
      conditions.push(`al.created_at >= $${idx}::timestamptz`);
      params.push(from);
      idx += 1;
    }

    if (to) {
      conditions.push(`al.created_at <= $${idx}::timestamptz`);
      params.push(to);
      idx += 1;
    }

    const where = `WHERE ${conditions.join(' AND ')}`;

    const countResult = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM audit_log al
       ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0]?.count || '0', 10);

    const rows = await query<MailAuditRow>(
      `SELECT
         al.*,
         u.username as actor_username,
         COALESCE(al.diff->>'recipientEmail', '') as recipient_email,
         COALESCE(al.diff->>'subject', '') as subject,
         COALESCE(al.diff->>'taskId', '') as task_id,
         COALESCE(al.diff->>'attempts', '') as attempts,
         COALESCE(al.diff->>'status', al.action) as delivery_status,
         COALESCE(al.diff->>'error', '') as error
       FROM audit_log al
       LEFT JOIN users u ON u.id = al.actor_id
       ${where}
       ORDER BY al.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    );

    return NextResponse.json<ApiResponse<PaginatedResponse<MailAuditRow>>>(
      {
        success: true,
        data: {
          items: rows.rows,
          total,
          page,
          totalPages: Math.ceil(total / limit),
        },
      }
    );
  } catch (err) {
    logger.error({ err }, 'GET /api/config/mail-audit error');
    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
