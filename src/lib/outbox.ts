import { query } from './db';
import { logger } from './logger';
import { sendTaskEventEmail } from './mail';

const SHORT_DURATION_BLOCKED_EVENTS = new Set(['task_overdue']);

function parseTaskDateTime(datePart?: string | null, timePart?: string | null): Date | null {
  if (!datePart) return null;
  const normalizedDate = datePart.split('T')[0];
  const normalizedTime = (timePart || '00:00:00').slice(0, 8);
  const parsed = new Date(`${normalizedDate}T${normalizedTime}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isTaskDurationWithin24Hours(input: {
  activity_start_date?: string | null;
  activity_start_time?: string | null;
  due_date?: string | null;
  due_time?: string | null;
}): boolean {
  const startAt = parseTaskDateTime(input.activity_start_date, input.activity_start_time);
  const targetAt = parseTaskDateTime(input.due_date, input.due_time);
  if (!startAt || !targetAt) return false;

  const diffMs = targetAt.getTime() - startAt.getTime();
  if (diffMs <= 0) return false;
  return diffMs <= (24 * 60 * 60 * 1000);
}

async function shouldSuppressOutboxEmailForShortTask(input: { eventType?: string | null; taskId?: number | null }): Promise<boolean> {
  if (!input.eventType || !SHORT_DURATION_BLOCKED_EVENTS.has(input.eventType)) {
    return false;
  }
  if (!input.taskId) {
    return false;
  }

  const taskResult = await query<{
    activity_start_date: string | null;
    activity_start_time: string | null;
    due_date: string | null;
    due_time: string | null;
  }>(
    `SELECT activity_start_date, activity_start_time, due_date, due_time
     FROM tasks
     WHERE id = $1
     LIMIT 1`,
    [input.taskId]
  );

  if ((taskResult.rowCount || 0) === 0) {
    return false;
  }

  return isTaskDurationWithin24Hours(taskResult.rows[0]);
}

async function writeEmailAudit(input: {
  entityId: number;
  action: 'queued' | 'sent' | 'failed' | 'dead';
  actorId?: number | null;
  diff?: Record<string, unknown>;
}): Promise<void> {
  try {
    await query(
      `INSERT INTO audit_log (actor_id, entity_type, entity_id, action, diff)
       VALUES ($1, 'email_outbox', $2, $3, $4)`,
      [input.actorId ?? null, input.entityId, input.action, input.diff ? JSON.stringify(input.diff) : null]
    );
  } catch (err) {
    logger.warn({ err, emailOutboxId: input.entityId, action: input.action }, 'Failed to write email audit log');
  }
}

type EnqueueEmailInput = {
  eventType: string;
  recipientEmail: string | null;
  recipientName?: string | null;
  subject: string;
  message: string;
  taskId?: number | null;
  payload?: Record<string, unknown>;
};

export async function enqueueEmail(input: EnqueueEmailInput): Promise<void> {
  const recipientEmail = (input.recipientEmail || '').trim();
  if (!recipientEmail) {
    logger.warn(
      {
        eventType: input.eventType,
        subject: input.subject,
        taskId: input.taskId ?? null,
      },
      'Skipping email queue because recipient email is missing'
    );
    return;
  }

  // Prevent accidental duplicate queue entries for the exact same event payload
  // generated within a short interval (e.g., overlapping triggers/retries).
  const duplicateCheck = await query<{ id: number }>(
    `SELECT id
     FROM email_outbox
     WHERE event_type = $1
       AND recipient_email = $2
       AND COALESCE(task_id, 0) = COALESCE($3, 0)
       AND subject = $4
       AND message = $5
       AND status IN ('pending', 'failed', 'sent')
       AND created_at >= NOW() - INTERVAL '2 minutes'
     LIMIT 1`,
    [
      input.eventType,
      recipientEmail,
      input.taskId || null,
      input.subject,
      input.message,
    ]
  );

  if ((duplicateCheck.rowCount || 0) > 0) {
    logger.info(
      {
        eventType: input.eventType,
        recipientEmail,
        taskId: input.taskId ?? null,
        subject: input.subject,
      },
      'Skipping duplicate email queue entry'
    );
    return;
  }

  const inserted = await query<{ id: number }>(
    `INSERT INTO email_outbox (
      event_type, recipient_email, recipient_name, subject, message, task_id, payload
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id`,
    [
      input.eventType,
      recipientEmail,
      input.recipientName || null,
      input.subject,
      input.message,
      input.taskId || null,
      input.payload ? JSON.stringify(input.payload) : null,
    ]
  );

  const outboxId = inserted.rows[0]?.id;
  if (outboxId) {
    await writeEmailAudit(
      {
        entityId: outboxId,
        action: 'queued',
        diff: {
          eventType: input.eventType,
          recipientEmail: input.recipientEmail,
          subject: input.subject,
          taskId: input.taskId ?? null,
          status: 'pending',
        },
      }
    );
  }
}

export async function processEmailOutbox(limit: number = 25): Promise<{ sent: number; failed: number; dead: number }> {
  const summary = { sent: 0, failed: 0, dead: 0 };

  const rows = await query<{
    id: number;
    event_type: string;
    recipient_email: string | null;
    recipient_name: string | null;
    subject: string;
    message: string;
    task_id: number | null;
    payload: Record<string, unknown> | null;
    attempts: number;
    max_attempts: number;
  }>(
    `WITH picked AS (
       SELECT id
       FROM email_outbox
       WHERE status IN ('pending','failed')
         AND next_attempt_at <= NOW()
       ORDER BY created_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     ),
     claimed AS (
       UPDATE email_outbox eo
       SET next_attempt_at = NOW() + INTERVAL '1 minute'
       FROM picked
       WHERE eo.id = picked.id
       RETURNING eo.id, eo.event_type, eo.recipient_email, eo.recipient_name, eo.subject, eo.message, eo.task_id, eo.payload, eo.attempts, eo.max_attempts
     )
     SELECT id, event_type, recipient_email, recipient_name, subject, message, task_id, payload, attempts, max_attempts
     FROM claimed
     ORDER BY id ASC`,
    [limit]
  );

  for (const row of rows.rows) {
    const suppressForShortTask = await shouldSuppressOutboxEmailForShortTask({
      eventType: row.event_type,
      taskId: row.task_id,
    });
    if (suppressForShortTask) {
      await query(
        `UPDATE email_outbox
         SET status = 'dead',
             attempts = attempts + 1,
             last_error = 'Suppressed: task duration is less than or equal to 24 hours'
         WHERE id = $1`,
        [row.id]
      );

      await writeEmailAudit({
        entityId: row.id,
        action: 'dead',
        diff: {
          eventType: row.event_type,
          taskId: row.task_id,
          recipientEmail: row.recipient_email,
          attempts: row.attempts + 1,
          status: 'dead',
          error: 'Suppressed: task duration is less than or equal to 24 hours',
        },
      });

      summary.dead += 1;
      continue;
    }

    const recipientEmail = (row.recipient_email || '').trim();
    if (!recipientEmail) {
      await query(
        `UPDATE email_outbox
         SET status = 'dead',
             attempts = attempts + 1,
             last_error = 'No email address for user'
         WHERE id = $1`,
        [row.id]
      );

      await writeEmailAudit({
        entityId: row.id,
        action: 'dead',
        diff: {
          recipientEmail: row.recipient_email,
          subject: row.subject,
          taskId: row.task_id,
          attempts: row.attempts + 1,
          status: 'dead',
          error: 'No email address for user',
        },
      });

      summary.dead += 1;
      continue;
    }

    const payload = (row.payload || {}) as Record<string, unknown>;
    const taskTitle = typeof payload.taskTitle === 'string' ? payload.taskTitle : `Task #${row.task_id || 'N/A'}`;
    const dueDate = typeof payload.dueDate === 'string' ? payload.dueDate : null;
    const dueTime = typeof payload.dueTime === 'string' ? payload.dueTime : null;
    const activityStartDate = typeof payload.activityStartDate === 'string' ? payload.activityStartDate : null;
    const activityStartTime = typeof payload.activityStartTime === 'string' ? payload.activityStartTime : null;
    const taskStatus = typeof payload.taskStatus === 'string' ? payload.taskStatus : null;
    const commentBodyHtml = typeof payload.commentBodyHtml === 'string' ? payload.commentBodyHtml : null;
    const allAssigneeNames = Array.isArray(payload.allAssigneeNames)
      ? (payload.allAssigneeNames as string[]).filter((n): n is string => typeof n === 'string' && n.length > 0)
      : null;
    const result = await sendTaskEventEmail(
      { email: recipientEmail, display_name: row.recipient_name },
      { id: row.task_id || 0, title: taskTitle, due_date: dueDate, due_time: dueTime, activity_start_date: activityStartDate, activity_start_time: activityStartTime },
      { subject: row.subject, message: row.message, taskStatus, commentBodyHtml, allAssigneeNames }
    );

    if (result.success) {
      await query(
        `UPDATE email_outbox
         SET status = 'sent', sent_at = NOW(), attempts = attempts + 1, last_error = NULL
         WHERE id = $1`,
        [row.id]
      );
      await writeEmailAudit(
        {
          entityId: row.id,
          action: 'sent',
          diff: {
            recipientEmail: row.recipient_email,
            subject: row.subject,
            taskId: row.task_id,
            attempts: row.attempts + 1,
            status: 'sent',
          },
        }
      );
      summary.sent += 1;
      continue;
    }

    const nextAttempts = row.attempts + 1;
    const isDead = nextAttempts >= row.max_attempts;
    await query(
      `UPDATE email_outbox
       SET status = $1,
           attempts = attempts + 1,
           last_error = $2,
           next_attempt_at = CASE
             WHEN $1 = 'dead' THEN next_attempt_at
             ELSE NOW() + (LEAST(60, POWER(2, attempts + 1)::int) * INTERVAL '1 minute')
           END
       WHERE id = $3`,
      [isDead ? 'dead' : 'failed', result.error || 'Send failed', row.id]
    );

    await writeEmailAudit(
      {
        entityId: row.id,
        action: isDead ? 'dead' : 'failed',
        diff: {
          recipientEmail: row.recipient_email,
          subject: row.subject,
          taskId: row.task_id,
          attempts: nextAttempts,
          status: isDead ? 'dead' : 'failed',
          error: result.error || 'Send failed',
        },
      }
    );

    if (isDead) {
      summary.dead += 1;
    } else {
      summary.failed += 1;
    }
  }

  if (summary.sent || summary.failed || summary.dead) {
    logger.info({ summary }, 'Email outbox batch processed');
  }

  return summary;
}
