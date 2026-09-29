import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { logger } from '@/lib/logger';
import type { ApiResponse, PaginatedResponse } from '@/types';

export interface MailLogRow {
  id: number;
  event_type: string;
  recipient_email: string | null;
  recipient_name: string | null;
  subject: string;
  task_id: number | null;
  status: string;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  created_at: string;
  sent_at: string | null;
  next_attempt_at: string | null;
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
      return NextResponse.json<ApiResponse<PaginatedResponse<MailLogRow>>>({
        success: true,
        data: { items: [], total: 0, page, totalPages: 0 },
      });
    }

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '25', 10)));
    const offset = (page - 1) * limit;

    const status = (searchParams.get('status') || '').trim();
    const eventType = (searchParams.get('eventType') || '').trim();
    const recipient = (searchParams.get('recipient') || '').trim();
    const subject = (searchParams.get('subject') || '').trim();
    const from = safeDateValue(searchParams.get('from'));
    const to = safeDateValue(searchParams.get('to'));

    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (status) {
      conditions.push(`eo.status = $${idx}`);
      params.push(status);
      idx += 1;
    }

    if (eventType) {
      conditions.push(`eo.event_type ILIKE $${idx}`);
      params.push(`%${eventType}%`);
      idx += 1;
    }

    if (recipient) {
      conditions.push(
        `(COALESCE(eo.recipient_email, '') ILIKE $${idx} OR COALESCE(eo.recipient_name, '') ILIKE $${idx})`
      );
      params.push(`%${recipient}%`);
      idx += 1;
    }

    if (subject) {
      conditions.push(`eo.subject ILIKE $${idx}`);
      params.push(`%${subject}%`);
      idx += 1;
    }

    if (from) {
      conditions.push(`eo.created_at >= $${idx}::timestamptz`);
      params.push(from);
      idx += 1;
    }

    if (to) {
      conditions.push(`eo.created_at <= $${idx}::timestamptz`);
      params.push(to);
      idx += 1;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM email_outbox eo ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0]?.count || '0', 10);

    const rows = await query<MailLogRow>(
      `SELECT
         eo.id,
         eo.event_type,
         eo.recipient_email,
         eo.recipient_name,
         eo.subject,
         eo.task_id,
         eo.status,
         eo.attempts,
         eo.max_attempts,
         eo.last_error,
         eo.created_at,
         eo.sent_at,
         eo.next_attempt_at
       FROM email_outbox eo
       ${where}
       ORDER BY eo.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    );

    return NextResponse.json<ApiResponse<PaginatedResponse<MailLogRow>>>({
      success: true,
      data: {
        items: rows.rows,
        total,
        page,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    logger.error({ err }, 'GET /api/audit/mail-logs error');
    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
