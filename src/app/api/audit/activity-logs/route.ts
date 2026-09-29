import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { logger } from '@/lib/logger';
import type { ApiResponse, PaginatedResponse } from '@/types';

export interface ActivityLogRow {
  id: number;
  actor_id: number | null;
  entity_type: string;
  entity_id: number;
  action: string;
  created_at: string;
  diff: Record<string, unknown> | null;
  actor_username: string | null;
  actor_name: string | null;
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
      return NextResponse.json<ApiResponse<PaginatedResponse<ActivityLogRow>>>({
        success: true,
        data: { items: [], total: 0, page, totalPages: 0 },
      });
    }

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '25', 10)));
    const offset = (page - 1) * limit;

    const actor = (searchParams.get('actor') || '').trim();
    const entityType = (searchParams.get('entityType') || '').trim();
    const action = (searchParams.get('action') || '').trim();
    const from = safeDateValue(searchParams.get('from'));
    const to = safeDateValue(searchParams.get('to'));

    // Exclude auth and email_outbox — those have dedicated tabs
    const conditions: string[] = ["al.entity_type NOT IN ('auth', 'email_outbox')"];
    const params: unknown[] = [];
    let idx = 1;

    if (actor) {
      conditions.push(
        `(COALESCE(u.display_name, '') ILIKE $${idx} OR COALESCE(u.username, '') ILIKE $${idx})`
      );
      params.push(`%${actor}%`);
      idx += 1;
    }

    if (entityType) {
      conditions.push(`al.entity_type ILIKE $${idx}`);
      params.push(`%${entityType}%`);
      idx += 1;
    }

    if (action) {
      conditions.push(`al.action ILIKE $${idx}`);
      params.push(`%${action}%`);
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
      `SELECT COUNT(*)::text AS count FROM audit_log al LEFT JOIN users u ON u.id = al.actor_id ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0]?.count || '0', 10);

    const rows = await query<ActivityLogRow>(
      `SELECT
         al.id,
         al.actor_id,
         al.entity_type,
         al.entity_id,
         al.action,
         al.created_at,
         al.diff,
         u.username AS actor_username,
         COALESCE(u.display_name, u.username) AS actor_name
       FROM audit_log al
       LEFT JOIN users u ON u.id = al.actor_id
       ${where}
       ORDER BY al.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    );

    return NextResponse.json<ApiResponse<PaginatedResponse<ActivityLogRow>>>({
      success: true,
      data: {
        items: rows.rows,
        total,
        page,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    logger.error({ err }, 'GET /api/audit/activity-logs error');
    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
