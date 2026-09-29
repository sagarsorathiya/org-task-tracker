// ──────────────────────────────────────────────
// /api/integrations/addin/import-event
// Bearer token authenticated (no NextAuth session — Outlook task pane context)
// Creates a task from an Outlook calendar appointment pushed by the add-in
// ──────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { logger } from '@/lib/logger';
import { sanitizeRichText } from '@/lib/sanitize';
import { z } from 'zod';
import crypto from 'crypto';
import type { ApiResponse } from '@/types';

const importSchema = z.object({
  outlookItemId: z.string().max(1000).default(''),
  subject: z.string().max(500).default('(No Subject)'),
  body: z.string().max(10000).optional().default(''),
  startDateTime: z.string().min(1),
  endDateTime: z.string().min(1).optional(),
  isAllDay: z.boolean().optional().default(false),
  reminderSet: z.boolean().optional().default(false),
  reminderMinutes: z.number().int().min(0).max(40320).optional().default(0),
});

function normalizeDateTime(iso: string): string {
  // VBA Format() uses the Windows locale time separator (may be '.' instead of ':')
  // e.g. "2026-05-21T22.30.00" → "2026-05-21T22:30:00"
  const tIdx = iso.indexOf('T');
  if (tIdx === -1) return iso;
  const datePart = iso.slice(0, tIdx);
  const timePart = iso.slice(tIdx + 1).replace(/\./g, ':');
  return `${datePart}T${timePart}`;
}

function splitDateTime(iso: string): { date: string; time: string } {
  const normalized = normalizeDateTime(iso);
  const d = new Date(normalized);
  if (isNaN(d.getTime())) {
    const parts = normalized.split('T');
    return { date: parts[0] ?? normalized, time: parts[1]?.slice(0, 8) ?? '00:00:00' };
  }
  const date = d.toISOString().slice(0, 10);
  const time = d.toTimeString().slice(0, 8);
  return { date, time };
}

export async function POST(req: NextRequest) {
  try {
    // Bearer token auth — no NextAuth session available in add-in context
    const authHeader = req.headers.get('authorization') || '';
    const rawToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!rawToken) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Unauthorized', errorCode: 'AUTH_UNAUTHORIZED' }, { status: 401 });
    }

    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    // Check new multi-device addin_tokens table first
    let userResult = await query<{ id: number; company_id: number | null; dept_id: number | null; token_id: number | null }>(
      `SELECT u.id, u.company_id, u.dept_id, t.id AS token_id
       FROM addin_tokens t
       JOIN users u ON u.id = t.user_id
       WHERE t.token_hash = $1 AND u.is_active = true`,
      [tokenHash]
    );

    // Backward compat: fall back to legacy users.addin_token_hash column
    if (!userResult.rows.length) {
      const legacyResult = await query<{ id: number; company_id: number | null; dept_id: number | null }>(
        `SELECT id, company_id, dept_id FROM users WHERE addin_token_hash = $1 AND is_active = true`,
        [tokenHash]
      );
      if (!legacyResult.rows.length) {
        return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Invalid token', errorCode: 'AUTH_UNAUTHORIZED' }, { status: 401 });
      }
      userResult = { rows: legacyResult.rows.map(r => ({ ...r, token_id: null })), rowCount: legacyResult.rowCount } as typeof userResult;
    } else {
      // Update last_used_at for the matched token
      const tokenId = userResult.rows[0].token_id;
      if (tokenId !== null) {
        void query(`UPDATE addin_tokens SET last_used_at = NOW() WHERE id = $1`, [tokenId]);
      }
    }

    const user = userResult.rows[0];

    // Parse body
    const raw = await req.json();
    const parsed = importSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: parsed.error.errors[0]?.message ?? 'Invalid request' },
        { status: 400 }
      );
    }

    let { outlookItemId, subject, body, startDateTime, endDateTime, isAllDay, reminderSet, reminderMinutes } = parsed.data;

    // Fallback key when EntryID is unavailable (e.g. received meeting invitations from Zimbra)
    if (!outlookItemId) {
      outlookItemId = `fallback:${subject}:${startDateTime}`;
    }

    // Deduplication — already imported; update schedule if times have changed
    const existing = await query<{ task_id: number | null }>(
      `SELECT task_id FROM calendar_event_imports WHERE user_id = $1 AND outlook_item_id = $2`,
      [user.id, outlookItemId]
    );
    if (existing.rows.length && existing.rows[0].task_id !== null) {
      const existingTaskId = existing.rows[0].task_id;
      const updStart = splitDateTime(startDateTime);
      const updEnd = endDateTime ? splitDateTime(endDateTime) : updStart;
      await query(
        `UPDATE tasks SET
           activity_start_date = $1, activity_start_time = $2,
           due_date = $3, due_time = $4,
           follow_up_date = $1, follow_up_time = $2,
           updated_at = NOW()
         WHERE id = $5`,
        [
          isAllDay ? updStart.date : updStart.date,
          isAllDay ? null : updStart.time,
          updEnd.date,
          isAllDay ? null : updEnd.time,
          existingTaskId,
        ]
      );
      // Update reminder rule to match new start time
      if (reminderSet && reminderMinutes > 0 && !isAllDay) {
        const startMs = new Date(`${updStart.date}T${updStart.time}`).getTime();
        const remindAt = new Date(startMs - reminderMinutes * 60 * 1000).toISOString();
        const updated = await query(
          `UPDATE reminder_rules SET remind_at = $1 WHERE task_id = $2 AND is_active = true`,
          [remindAt, existingTaskId]
        );
        if ((updated.rowCount ?? 0) === 0) {
          await query(
            `INSERT INTO reminder_rules (task_id, offset_days, remind_at, channel, is_active, created_by)
             VALUES ($1, 0, $2, 'email', true, $3)`,
            [existingTaskId, remindAt, user.id]
          );
        }
      }
      return NextResponse.json<ApiResponse<{ taskId: number; alreadyImported: boolean }>>({
        success: true,
        data: { taskId: existingTaskId, alreadyImported: true },
      });
    }

    // Map event times to DB columns
    const start = splitDateTime(startDateTime);
    const end = endDateTime ? splitDateTime(endDateTime) : start;

    // Truncate subject for title
    const title = subject.length > 500 ? subject.slice(0, 497) + '...' : subject;

    // Insert task
    const taskResult = await query<{ id: number }>(
      `INSERT INTO tasks (
        title, description,
        activity_start_date, activity_start_time,
        due_date, due_time,
        follow_up_date, follow_up_time,
        priority, status,
        assigned_to, assigned_by,
        company_id, dept_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'medium','open',$9,$9,$10,$11)
      RETURNING id`,
      [
        title,
        body ? sanitizeRichText(body) : null,
        isAllDay ? start.date : start.date,
        isAllDay ? null : start.time,
        end.date,
        isAllDay ? null : end.time,
        start.date,
        isAllDay ? null : start.time,
        user.id,
        user.company_id,
        user.dept_id,
      ]
    );

    const taskId = taskResult.rows[0].id;

    // Outlook reminder → create a reminder rule at (start - reminderMinutes)
    if (reminderSet && reminderMinutes > 0 && !isAllDay) {
      const startMs = new Date(`${start.date}T${start.time}`).getTime();
      const remindAt = new Date(startMs - reminderMinutes * 60 * 1000).toISOString();
      await query(
        `INSERT INTO reminder_rules (task_id, offset_days, remind_at, channel, is_active, created_by)
         VALUES ($1, 0, $2, 'email', true, $3)`,
        [taskId, remindAt, user.id]
      );
    }

    // Activity log
    await query(
      `INSERT INTO task_activity (task_id, user_id, action, meta) VALUES ($1, $2, 'created', $3)`,
      [taskId, user.id, JSON.stringify({ source: 'addin_push', outlookItemId, title })]
    );

    // Audit log
    await query(
      `INSERT INTO audit_log (actor_id, entity_type, entity_id, action) VALUES ($1, 'task', $2, 'created')`,
      [user.id, taskId]
    );

    // Record import to prevent duplicates
    await query(
      `INSERT INTO calendar_event_imports (user_id, outlook_item_id, task_id, event_subject, event_start)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, outlook_item_id) DO UPDATE SET task_id = EXCLUDED.task_id`,
      [user.id, outlookItemId, taskId, subject, startDateTime]
    );

    logger.info({ userId: user.id, taskId, outlookItemId }, 'Task created from Outlook add-in');

    return NextResponse.json<ApiResponse<{ taskId: number; alreadyImported: boolean }>>(
      { success: true, data: { taskId, alreadyImported: false } },
      { status: 201 }
    );
  } catch (err) {
    logger.error({ err }, 'import-event failed');
    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
