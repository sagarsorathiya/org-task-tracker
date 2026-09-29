// ──────────────────────────────────────────────
// Reminder Scheduler — node-schedule cron job
// ──────────────────────────────────────────────

import schedule from 'node-schedule';
import { query } from './db';
import { sendTaskReminder } from './mail';
import { sendTaskEventEmail, sendOverdueDailyDigestEmail, sendTransactionReminderEmail } from './mail';
import { sendWhatsAppReminder } from './whatsapp';
import { logger } from './logger';
import { enqueueEmail, processEmailOutbox } from './outbox';

let schedulerJob: schedule.Job | null = null;
let outboxJob: schedule.Job | null = null;
let realtimeSweepJob: schedule.Job | null = null;
let sweepInProgress = false;

type ReminderSweepOptions = {
  force?: boolean;
};

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

async function hasRecentOutboxEvent(input: {
  eventType: string;
  taskId: number;
  recipientEmail: string;
}): Promise<boolean> {
  const result = await query<{ id: number }>(
    `SELECT id
     FROM email_outbox
     WHERE event_type = $1
       AND task_id = $2
       AND recipient_email = $3
       AND status IN ('pending', 'failed', 'sent')
       AND created_at >= NOW() - INTERVAL '2 hours'
     LIMIT 1`,
    [input.eventType, input.taskId, input.recipientEmail]
  );

  return (result.rowCount || 0) > 0;
}

/**
 * Run the reminder sweep — check all active tasks with reminder rules
 */
export async function runReminderSweep(options: ReminderSweepOptions = {}): Promise<{ sent: number; failed: number; skipped: number }> {
  const summary = { sent: 0, failed: 0, skipped: 0 };
  const force = options.force === true;

  try {
    // Convert stale 'pending' log entries (>5 min old) to 'failed' so crashed-before-send
    // reminders become eligible for retry on the next sweep cycle.
    await query(
      `UPDATE reminder_logs
       SET status = 'failed', error_msg = 'Interrupted by process restart'
       WHERE status = 'pending'
         AND sent_at < NOW() - INTERVAL '5 minutes'`
    );

    // Find active, non-completed, non-deleted tasks with reminder rules
    const rules = await query<{
      rule_id: number;
      task_id: number;
      task_title: string;
      activity_start_date: string | null;
      activity_start_time: string | null;
      due_date: string;
      due_time: string | null;
      offset_days: number;
      remind_at: string | null;
      channel: string;
      assigned_by: number | null;
      assigned_to: number | null;
      assigned_to_ids: number[] | null;
      information_ids: number[] | null;
    }>(
      `SELECT
        rr.id as rule_id,
        t.id as task_id,
        t.title as task_title,
        t.activity_start_date,
        t.activity_start_time,
        t.due_date,
        t.due_time,
        rr.offset_days,
        rr.remind_at,
        rr.channel,
        t.assigned_by,
        t.assigned_to,
        t.assigned_to_ids,
        t.information_ids
       FROM reminder_rules rr
       JOIN tasks t ON rr.task_id = t.id
       WHERE rr.is_active = true
         AND t.is_deleted = false
         AND t.status NOT IN ('completed', 'cancelled')
         AND (
           (rr.remind_at IS NOT NULL AND NOW() >= rr.remind_at)
           OR
           (rr.remind_at IS NULL AND t.due_date IS NOT NULL AND CURRENT_DATE >= (t.due_date - rr.offset_days * INTERVAL '1 day'))
         )
         AND (
           t.due_date IS NULL
           OR NOW() <= (t.due_date::timestamp + COALESCE(t.due_time, '23:59:59'::time))
         )
       LIMIT 500`
    );
    if ((rules.rowCount ?? 0) >= 500) {
      logger.warn('reminder_rules sweep hit LIMIT 500 — some rules may be deferred to the next cycle');
    }

    // Pre-fetch sent/pending logs for every rule — avoids N per-rule roundtrips.
    // 'pending' entries count as in-flight and block re-sends just like 'sent'.
    const allRuleIds = rules.rows.map((r) => r.rule_id);
    const todayReminderLogs = allRuleIds.length > 0
      ? (await query<{ rule_id: number; channel: string; recipient: string | null }>(
          `SELECT rule_id, channel, recipient
           FROM reminder_logs
           WHERE rule_id = ANY($1::int[])
             AND sent_at >= NOW() - INTERVAL '23 hours'
             AND status IN ('sent', 'pending')`,
          [allRuleIds]
        )).rows
      : [];

    const sentByRule = new Map<number, { email: Set<string>; whatsapp: Set<string> }>();
    for (const log of todayReminderLogs) {
      if (!sentByRule.has(log.rule_id)) sentByRule.set(log.rule_id, { email: new Set(), whatsapp: new Set() });
      const entry = sentByRule.get(log.rule_id)!;
      if (log.channel === 'email') entry.email.add(log.recipient || '');
      else if (log.channel === 'whatsapp') entry.whatsapp.add(log.recipient || '');
    }

    for (const rule of rules.rows) {
      const wantsEmail = rule.channel === 'email' || rule.channel === 'both';
      const wantsWhatsApp = rule.channel === 'whatsapp' || rule.channel === 'both';

      const assigneeIds = rule.assigned_to_ids?.length
        ? rule.assigned_to_ids
        : (rule.assigned_to ? [rule.assigned_to] : []);
      const infoIds = rule.information_ids?.length ? rule.information_ids : [];
      const recipientIds = Array.from(new Set([...(rule.assigned_by ? [rule.assigned_by] : []), ...assigneeIds, ...infoIds]));

      const recipients = recipientIds.length > 0
        ? (await query<{ id: number; email: string | null; mobile_number: string | null; display_name: string | null }>(
            'SELECT id, email, mobile_number, display_name FROM users WHERE id = ANY($1::int[])',
            [recipientIds]
          )).rows
        : [];

      // Use pre-fetched data (empty sets when force=true so all sends proceed).
      const ruleLogs = !force
        ? (sentByRule.get(rule.rule_id) ?? { email: new Set<string>(), whatsapp: new Set<string>() })
        : { email: new Set<string>(), whatsapp: new Set<string>() };
      const sentEmailRecipients = ruleLogs.email;
      const sentWhatsAppRecipients = ruleLogs.whatsapp;

      if (!force) {
        const allRequestedChannelsAlreadySent = recipients.length > 0 && recipients.every((recipient) => {
          const emailDone = !wantsEmail || sentEmailRecipients.has(recipient.email || '');
          const waDone = !wantsWhatsApp || sentWhatsAppRecipients.has(recipient.mobile_number || '');
          return emailDone && waDone;
        });

        if (allRequestedChannelsAlreadySent) {
          summary.skipped++;
          continue;
        }
      }

      const task = {
        id: rule.task_id,
        title: rule.task_title,
        due_date: rule.due_date,
        due_time: rule.due_time,
        activity_start_date: rule.activity_start_date,
        activity_start_time: rule.activity_start_time,
      };
      let emailSent = false;
      let waSent = false;

      // Send via channel — write 'pending' log BEFORE sending so a process crash
      // between send and log-write cannot produce an unrecorded delivery.
      if (wantsEmail) {
        for (const assignee of recipients) {
          if (!force && sentEmailRecipients.has(assignee.email || '')) {
            continue;
          }

          const pendingLog = await query<{ id: number }>(
            `INSERT INTO reminder_logs (task_id, rule_id, channel, recipient, status)
             VALUES ($1, $2, 'email', $3, 'pending')
             RETURNING id`,
            [rule.task_id, rule.rule_id, assignee.email]
          );
          const logId = pendingLog.rows[0]?.id;

          const emailResult = await sendTaskReminder(
            { email: assignee.email, display_name: assignee.display_name },
            task
          );

          if (logId) {
            await query(
              `UPDATE reminder_logs SET status = $1, error_msg = $2 WHERE id = $3`,
              [emailResult.success ? 'sent' : 'failed', emailResult.error || null, logId]
            );
          }

          emailSent = emailSent || emailResult.success;
        }
      }

      if (wantsWhatsApp) {
        for (const assignee of recipients) {
          if (!force && sentWhatsAppRecipients.has(assignee.mobile_number || '')) {
            continue;
          }

          const pendingLog = await query<{ id: number }>(
            `INSERT INTO reminder_logs (task_id, rule_id, channel, recipient, status)
             VALUES ($1, $2, 'whatsapp', $3, 'pending')
             RETURNING id`,
            [rule.task_id, rule.rule_id, assignee.mobile_number]
          );
          const logId = pendingLog.rows[0]?.id;

          const waResult = await sendWhatsAppReminder(assignee.mobile_number || '', task);

          if (logId) {
            await query(
              `UPDATE reminder_logs SET status = $1, error_msg = $2 WHERE id = $3`,
              [waResult.success ? 'sent' : 'failed', waResult.error || null, logId]
            );
          }

          waSent = waSent || waResult.success;
        }
      }

      if (emailSent || waSent) {
        summary.sent++;

        // One-shot rules (remind_at IS NOT NULL) should fire exactly once — deactivate
        // after the first successful send so the 23-hour dedup window expiring overnight
        // cannot cause a duplicate the next day.
        if (rule.remind_at !== null) {
          await query(
            `UPDATE reminder_rules SET is_active = false WHERE id = $1`,
            [rule.rule_id]
          );
        }

        // Create notification
        for (const assigneeId of recipientIds) {
          await query(
            `INSERT INTO notifications (user_id, type, message, ref_task_id)
             VALUES ($1, 'reminder_sent', $2, $3)`,
            [assigneeId, `Reminder: ${rule.task_title} is due on ${rule.due_date}`, rule.task_id]
          );
        }
      } else {
        summary.failed++;
      }
    }

    // Auto-email when task crosses start datetime (Upcoming -> In Progress), first time only.
    const inProgressTransitionTasks = await query<{
      task_id: number;
      task_title: string;
      activity_start_date: string | null;
      activity_start_time: string | null;
      due_date: string | null;
      due_time: string | null;
      assigned_by: number | null;
      assigned_to: number | null;
      assigned_to_ids: number[] | null;
      information_ids: number[] | null;
    }>(
      `SELECT
        t.id as task_id,
        t.title as task_title,
        t.activity_start_date,
        t.activity_start_time,
        t.due_date,
        t.due_time,
        t.assigned_by,
        t.assigned_to,
        t.assigned_to_ids,
        t.information_ids
       FROM tasks t
       WHERE t.is_deleted = false
         AND t.status NOT IN ('completed', 'cancelled')
         AND t.activity_start_date IS NOT NULL
         AND NOW() >= (t.activity_start_date::timestamp + COALESCE(t.activity_start_time, '00:00:00'::time))
         AND (
           t.due_date IS NULL
           OR NOW() <= (t.due_date::timestamp + COALESCE(t.due_time, '23:59:59'::time))
         )
         AND NOT EXISTS (
           SELECT 1 FROM task_activity ta
           WHERE ta.task_id = t.id
             AND ta.action = 'in_progress_mail_sent'
         )
       LIMIT 200`
    );

    for (const taskRow of inProgressTransitionTasks.rows) {
      const assigneeIds = taskRow.assigned_to_ids?.length
        ? taskRow.assigned_to_ids
        : (taskRow.assigned_to ? [taskRow.assigned_to] : []);
      const infoIds = taskRow.information_ids?.length ? taskRow.information_ids : [];
      const recipientIds = Array.from(new Set([...(taskRow.assigned_by ? [taskRow.assigned_by] : []), ...assigneeIds, ...infoIds]));
      if (recipientIds.length === 0) continue;

      const recipients = await query<{ id: number; email: string | null; display_name: string | null }>(
        'SELECT id, email, display_name FROM users WHERE id = ANY($1::int[])',
        [recipientIds]
      );

      let anyQueued = false;
      for (const recipient of recipients.rows) {
        const recipientEmail = (recipient.email || '').trim();
        if (!recipientEmail) {
          logger.warn(
            { taskId: taskRow.task_id, userId: recipient.id },
            'in_progress_transition: skipping recipient with no email address'
          );
          continue;
        }

        const alreadyQueued = await hasRecentOutboxEvent({
          eventType: 'task_in_progress_transition',
          taskId: taskRow.task_id,
          recipientEmail,
        });
        if (alreadyQueued) {
          continue;
        }

        await enqueueEmail({
          eventType: 'task_in_progress_transition',
          recipientEmail,
          recipientName: recipient.display_name,
          subject: `Task In Progress: ${taskRow.task_title}`,
          message: 'Task status has moved from Upcoming to In Progress.',
          taskId: taskRow.task_id,
          payload: { taskTitle: taskRow.task_title, dueDate: taskRow.due_date, dueTime: taskRow.due_time, activityStartDate: taskRow.activity_start_date, activityStartTime: taskRow.activity_start_time },
        });
        anyQueued = true;
      }

      if (anyQueued) {
        for (const recipientId of recipientIds) {
          await query(
            `INSERT INTO notifications (user_id, type, message, ref_task_id)
             VALUES ($1, 'task_status_changed', $2, $3)`,
            [recipientId, `Task moved to In Progress: ${taskRow.task_title}`, taskRow.task_id]
          );
        }

        await query(
          `INSERT INTO task_activity (task_id, user_id, action, meta)
           VALUES ($1, NULL, 'in_progress_mail_sent', $2)`,
          [taskRow.task_id, JSON.stringify({ at: new Date().toISOString() })]
        );
      }
    }

    // Auto-email 24 hours before target date/time for non-completed tasks.
    const auto24hTasks = await query<{
      task_id: number;
      task_title: string;
      activity_start_date: string | null;
      activity_start_time: string | null;
      due_date: string;
      due_time: string | null;
      target_at: string;
      assigned_by: number | null;
      assigned_to: number | null;
      assigned_to_ids: number[] | null;
      information_ids: number[] | null;
    }>(
      `SELECT
        t.id as task_id,
        t.title as task_title,
        t.activity_start_date,
        t.activity_start_time,
        t.due_date,
        t.due_time,
        (t.due_date::timestamp + COALESCE(t.due_time, '00:00:00'::time)) as target_at,
        t.assigned_by,
        t.assigned_to,
        t.assigned_to_ids,
        t.information_ids
       FROM tasks t
       WHERE t.is_deleted = false
         AND t.status NOT IN ('completed', 'cancelled')
         AND t.due_date IS NOT NULL
         AND NOW() >= ((t.due_date::timestamp + COALESCE(t.due_time, '00:00:00'::time)) - INTERVAL '24 hours')
         AND NOW() < (t.due_date::timestamp + COALESCE(t.due_time, '00:00:00'::time))
       LIMIT 200`
    );

    for (const taskRow of auto24hTasks.rows) {
      if (isTaskDurationWithin24Hours(taskRow)) {
        summary.skipped++;
        continue;
      }

      if (!force) {
        const alreadySent = await query<{ id: number }>(
          `SELECT id
           FROM reminder_logs
           WHERE task_id = $1
             AND rule_id IS NULL
             AND channel = 'email'
             AND status = 'sent'
             AND sent_at >= ($2::timestamp - INTERVAL '24 hours')
             AND sent_at < $2::timestamp
           LIMIT 1`,
          [taskRow.task_id, taskRow.target_at]
        );

        if ((alreadySent.rowCount || 0) > 0) {
          summary.skipped++;
          continue;
        }
      }

      const assigneeIds = taskRow.assigned_to_ids?.length
        ? taskRow.assigned_to_ids
        : (taskRow.assigned_to ? [taskRow.assigned_to] : []);
      const infoIds = taskRow.information_ids?.length ? taskRow.information_ids : [];
      const recipientIds = Array.from(new Set([...(taskRow.assigned_by ? [taskRow.assigned_by] : []), ...assigneeIds, ...infoIds]));
      const recipients = recipientIds.length > 0
        ? (await query<{ id: number; email: string | null; display_name: string | null }>(
            'SELECT id, email, display_name FROM users WHERE id = ANY($1::int[])',
            [recipientIds]
          )).rows
        : [];

      let anySent = false;
      for (const recipient of recipients) {
        const emailResult = await sendTaskEventEmail(
          { email: recipient.email, display_name: recipient.display_name },
          { id: taskRow.task_id, title: taskRow.task_title, due_date: taskRow.due_date, due_time: taskRow.due_time, activity_start_date: taskRow.activity_start_date, activity_start_time: taskRow.activity_start_time },
          {
            subject: `Reminder (24h): ${taskRow.task_title}`,
            message: 'This task is due within 24 hours and is not marked as completed yet.',
          }
        );

        await query(
          `INSERT INTO reminder_logs (task_id, rule_id, channel, recipient, status, error_msg)
           VALUES ($1, NULL, 'email', $2, $3, $4)`,
          [taskRow.task_id, recipient.email, emailResult.success ? 'sent' : 'failed', emailResult.error || null]
        );

        anySent = anySent || emailResult.success;
      }

      if (anySent) {
        summary.sent++;
        for (const assigneeId of recipientIds) {
          await query(
            `INSERT INTO notifications (user_id, type, message, ref_task_id)
             VALUES ($1, 'reminder_sent', $2, $3)`,
            [assigneeId, `Reminder: ${taskRow.task_title} is due in less than 24 hours`, taskRow.task_id]
          );
        }
      } else {
        summary.failed++;
      }
    }

    // Auto-email when task turns overdue (first time) to creator and assignees.
    const overdueTasks = await query<{
      task_id: number;
      task_title: string;
      description: string | null;
      activity_start_date: string | null;
      activity_start_time: string | null;
      due_date: string;
      due_time: string | null;
      assigned_by: number | null;
      assigned_to: number | null;
      assigned_to_ids: number[] | null;
      information_ids: number[] | null;
    }>(
      `SELECT
        t.id as task_id,
        t.title as task_title,
        t.description,
        t.activity_start_date,
        t.activity_start_time,
        t.due_date,
        t.due_time,
        t.assigned_by,
        t.assigned_to,
        t.assigned_to_ids,
        t.information_ids
       FROM tasks t
       WHERE t.is_deleted = false
         AND t.status NOT IN ('completed', 'cancelled')
         AND t.due_date IS NOT NULL
         AND (
           t.due_date < CURRENT_DATE
           OR (t.due_date = CURRENT_DATE AND t.due_time IS NOT NULL AND t.due_time < CURRENT_TIME)
         )
         AND NOT EXISTS (
           SELECT 1 FROM task_activity ta
           WHERE ta.task_id = t.id
             AND ta.action = 'overdue_mail_sent'
         )
       LIMIT 200`
    );

    for (const taskRow of overdueTasks.rows) {
      if (isTaskDurationWithin24Hours(taskRow)) {
        summary.skipped++;
        continue;
      }

      const assigneeIds = taskRow.assigned_to_ids?.length
        ? taskRow.assigned_to_ids
        : (taskRow.assigned_to ? [taskRow.assigned_to] : []);
      const infoIds = taskRow.information_ids?.length ? taskRow.information_ids : [];
      const recipientIds = Array.from(new Set([...(taskRow.assigned_by ? [taskRow.assigned_by] : []), ...assigneeIds, ...infoIds]));
      if (recipientIds.length === 0) continue;

      const recipients = await query<{ id: number; email: string | null; display_name: string | null }>(
        'SELECT id, email, display_name FROM users WHERE id = ANY($1::int[])',
        [recipientIds]
      );

      // Send directly (not via outbox queue) so the email goes out immediately.
      // Only mark overdue_mail_sent in task_activity after at least one successful send —
      // this way SMTP failures are retried on the next sweep cycle.
      let anySent = false;
      for (const recipient of recipients.rows) {
        const recipientEmail = (recipient.email || '').trim();
        if (!recipientEmail) {
          logger.warn(
            { taskId: taskRow.task_id, userId: recipient.id },
            'overdue_mail: skipping recipient with no email address'
          );
          continue;
        }

        const emailResult = await sendTaskEventEmail(
          { email: recipientEmail, display_name: recipient.display_name },
          {
            id: taskRow.task_id,
            title: taskRow.task_title,
            due_date: taskRow.due_date,
            due_time: taskRow.due_time,
            activity_start_date: taskRow.activity_start_date,
            activity_start_time: taskRow.activity_start_time,
          },
          {
            subject: `Task Overdue: ${taskRow.task_title}`,
            message: 'This task is now overdue and needs your immediate attention.',
          }
        );

        await query(
          `INSERT INTO reminder_logs (task_id, rule_id, channel, recipient, status, error_msg)
           VALUES ($1, NULL, 'email', $2, $3, $4)`,
          [taskRow.task_id, recipientEmail, emailResult.success ? 'sent' : 'failed', emailResult.error || null]
        );

        if (emailResult.success) anySent = true;
      }

      if (anySent) {
        summary.sent++;
        await query(
          `INSERT INTO task_activity (task_id, user_id, action, meta)
           VALUES ($1, NULL, 'overdue_mail_sent', $2)`,
          [taskRow.task_id, JSON.stringify({ at: new Date().toISOString() })]
        );
      } else {
        summary.failed++;
      }
    }

    logger.info({ summary }, 'Reminder sweep completed');

    // Process pending/retry emails as part of scheduled sweeps.
    await processEmailOutbox(50);
  } catch (err) {
    logger.error({ err }, 'Reminder sweep failed');
  }

  return summary;
}

async function runPersonalTaskReminderSweep(): Promise<void> {
  const due = await query<{
    reminder_id: number;
    task_id: number;
    user_id: number;
    title: string;
    channel: string;
    email: string | null;
    mobile_number: string | null;
    display_name: string | null;
  }>(
    `SELECT ptr.id AS reminder_id, pt.id AS task_id, pt.user_id, pt.title,
            ptr.channel, u.email, u.mobile_number, u.display_name
     FROM personal_task_reminders ptr
     JOIN personal_tasks pt ON pt.id = ptr.task_id
     JOIN users u ON u.id = ptr.user_id
     WHERE ptr.is_fired = false
       AND ptr.remind_at <= NOW()
       AND pt.status = 'pending'`
  );

  for (const row of due.rows) {
    try {
      const channel = row.channel;

      if ((channel === 'email' || channel === 'both') && row.email?.trim()) {
        await enqueueEmail({
          eventType: 'personal_reminder',
          recipientEmail: row.email.trim(),
          recipientName: row.display_name,
          subject: `Reminder: ${row.title}`,
          message: `This is a personal reminder for: ${row.title}`,
          taskId: null as unknown as number,
          payload: { personalTaskId: row.task_id, title: row.title },
        });
      }

      if ((channel === 'whatsapp' || channel === 'both') && row.mobile_number?.trim()) {
        await sendWhatsAppReminder(
          row.mobile_number.trim(),
          { id: row.task_id, title: row.title, due_date: null }
        );
      }

      await query(
        `INSERT INTO notifications (user_id, type, message, ref_task_id)
         VALUES ($1, 'personal_reminder', $2, NULL)`,
        [row.user_id, `Personal reminder: ${row.title}`]
      );

      // Mark as fired (keep history)
      await query(
        `UPDATE personal_task_reminders SET is_fired = true WHERE id = $1`,
        [row.reminder_id]
      );

      logger.info({ reminderId: row.reminder_id, taskId: row.task_id, channel }, 'Personal task reminder fired');
    } catch (err) {
      logger.error({ err, reminderId: row.reminder_id }, 'Failed to send personal task reminder');
    }
  }
}

/**
 * Send a daily overdue digest email to every user who has at least one overdue task.
 * Runs at 00:05 every night. Deduped: skips a recipient who already received the
 * digest in the last 23 hours (guards against accidental double-fire).
 */
async function runOverdueDailyDigest(): Promise<void> {
  logger.info('Running overdue daily digest...');

  try {
    const overdueTasks = await query<{
      task_id: number;
      task_title: string;
      due_date: string;
      due_time: string | null;
      priority: string;
      assigned_by: number | null;
      assigned_to: number | null;
      assigned_to_ids: number[] | null;
      information_ids: number[] | null;
    }>(
      `SELECT
        t.id          AS task_id,
        t.title       AS task_title,
        t.due_date,
        t.due_time,
        t.priority,
        t.assigned_by,
        t.assigned_to,
        t.assigned_to_ids,
        t.information_ids
       FROM tasks t
       WHERE t.is_deleted = false
         AND t.status NOT IN ('completed', 'cancelled')
         AND t.due_date IS NOT NULL
         AND (
           t.due_date < CURRENT_DATE
           OR (t.due_date = CURRENT_DATE AND t.due_time IS NOT NULL AND t.due_time < CURRENT_TIME)
         )
       ORDER BY t.due_date ASC, t.id ASC
       LIMIT 500`
    );

    if ((overdueTasks.rowCount ?? 0) >= 500) {
      logger.warn('Overdue daily digest hit LIMIT 500 — some tasks may be missing from digest');
    }

    if ((overdueTasks.rowCount || 0) === 0) {
      logger.info('Overdue daily digest: no overdue tasks — skipping');
      return;
    }

    // Group tasks by recipient user ID
    type DigestTask = {
      task_id: number;
      task_title: string;
      due_date: string;
      due_time: string | null;
      priority: string;
    };

    const recipientTasksMap = new Map<number, DigestTask[]>();

    for (const task of overdueTasks.rows) {
      const assigneeIds = task.assigned_to_ids?.length
        ? task.assigned_to_ids
        : (task.assigned_to ? [task.assigned_to] : []);
      const infoIds = task.information_ids?.length ? task.information_ids : [];
      const recipientIds = Array.from(
        new Set([...(task.assigned_by ? [task.assigned_by] : []), ...assigneeIds, ...infoIds])
      );

      for (const userId of recipientIds) {
        if (!recipientTasksMap.has(userId)) recipientTasksMap.set(userId, []);
        recipientTasksMap.get(userId)!.push({
          task_id: task.task_id,
          task_title: task.task_title,
          due_date: task.due_date,
          due_time: task.due_time,
          priority: task.priority,
        });
      }
    }

    if (recipientTasksMap.size === 0) return;

    // Fetch user details for all recipients in one query
    const allUserIds = Array.from(recipientTasksMap.keys());
    const usersResult = await query<{ id: number; email: string | null; display_name: string | null }>(
      'SELECT id, email, display_name FROM users WHERE id = ANY($1::int[])',
      [allUserIds]
    );
    const userMap = new Map(usersResult.rows.map((u) => [u.id, u]));

    let digestSent = 0;
    let digestFailed = 0;
    let digestSkipped = 0;

    for (const [userId, tasks] of recipientTasksMap) {
      const user = userMap.get(userId);
      if (!user?.email?.trim()) {
        digestSkipped++;
        continue;
      }

      const recipientEmail = user.email.trim();

      // Guard: skip if we already sent a digest to this recipient in the last 23 hours
      const alreadySent = await query<{ id: number }>(
        `SELECT id FROM email_outbox
         WHERE event_type = 'overdue_daily_digest'
           AND recipient_email = $1
           AND created_at >= NOW() - INTERVAL '23 hours'
           AND status IN ('pending', 'sent')
         LIMIT 1`,
        [recipientEmail]
      );

      if ((alreadySent.rowCount || 0) > 0) {
        digestSkipped++;
        continue;
      }

      const result = await sendOverdueDailyDigestEmail(
        { email: recipientEmail, display_name: user.display_name },
        tasks
      );

      // Record in email_outbox for audit trail (status already final — no retry via queue)
      await query(
        `INSERT INTO email_outbox (event_type, recipient_email, recipient_name, subject, message, task_id, payload, status, sent_at, attempts)
         VALUES ($1, $2, $3, $4, $5, NULL, $6, $7, $8, 1)`,
        [
          'overdue_daily_digest',
          recipientEmail,
          user.display_name || null,
          `Overdue Tasks Digest: ${tasks.length} task${tasks.length !== 1 ? 's' : ''} need your attention`,
          `You have ${tasks.length} overdue task${tasks.length !== 1 ? 's' : ''}.`,
          JSON.stringify({ taskCount: tasks.length, taskIds: tasks.map((t) => t.task_id) }),
          result.success ? 'sent' : 'failed',
          result.success ? new Date().toISOString() : null,
        ]
      );

      if (result.success) {
        digestSent++;
      } else {
        digestFailed++;
        logger.warn({ userId, email: recipientEmail, error: result.error }, 'Overdue digest send failed');
      }
    }

    logger.info(
      { sent: digestSent, failed: digestFailed, skipped: digestSkipped },
      'Overdue daily digest completed'
    );
  } catch (err) {
    logger.error({ err }, 'Overdue daily digest failed');
  }
}

/**
 * Fire the one-shot (or recurring) Transaction Reminder email for records
 * whose reminder date+time has arrived. Claimed (is_reminder_sent flipped
 * to true) BEFORE sending so a crash mid-send cannot produce a duplicate;
 * the tradeoff is a missed send (not a duplicate) on crash, which is the
 * safer failure mode for vendor-facing correspondence. For records with
 * `recurrence !== 'none'`, a successful send immediately advances
 * `reminder_date`/`bill_date` to the next occurrence and resets
 * `is_reminder_sent = false` so the record fires again next cycle without
 * the user having to re-create it.
 */
const RECURRENCE_INTERVAL: Record<'weekly' | 'monthly' | 'yearly', string> = {
  weekly: '7 days',
  monthly: '1 month',
  yearly: '1 year',
};

async function runTransactionReminderSweep(): Promise<{ sent: number; failed: number }> {
  const summary = { sent: 0, failed: 0 };

  try {
    const due = await query<{
      id: number;
      type: 'subscription' | 'payment';
      party_name: string;
      vendor_code: string | null;
      place: string | null;
      agreement: string | null;
      execution_date: string | null;
      bill_date: string | null;
      recurrence: 'none' | 'weekly' | 'monthly' | 'yearly';
      reminder_emails: string[];
    }>(
      `SELECT id, type, party_name, vendor_code, place, agreement, execution_date, bill_date, recurrence, reminder_emails
       FROM transaction_reminders
       WHERE is_reminder_sent = false
         AND is_deleted = false
         AND (reminder_date::timestamp + reminder_time) <= NOW()
       ORDER BY reminder_date ASC, reminder_time ASC
       LIMIT 200`
    );

    if ((due.rowCount ?? 0) >= 200) {
      logger.warn('transaction_reminders sweep hit LIMIT 200 — some records deferred to next cycle');
    }

    for (const row of due.rows) {
      const claim = await query(
        `UPDATE transaction_reminders SET is_reminder_sent = true, reminder_sent_at = NOW()
         WHERE id = $1 AND is_reminder_sent = false`,
        [row.id]
      );
      if (claim.rowCount === 0) continue;

      const attachments = await query<{ original_name: string; stored_name: string }>(
        'SELECT original_name, stored_name FROM transaction_reminder_attachments WHERE transaction_id = $1',
        [row.id]
      );

      const result = await sendTransactionReminderEmail(row.reminder_emails, row, attachments.rows);

      if (result.success) {
        summary.sent++;

        if (row.recurrence !== 'none') {
          const interval = RECURRENCE_INTERVAL[row.recurrence];
          await query(
            `UPDATE transaction_reminders SET
              reminder_date = (reminder_date + $1::interval)::date,
              bill_date = CASE WHEN bill_date IS NOT NULL THEN (bill_date + $1::interval)::date ELSE bill_date END,
              is_reminder_sent = false
             WHERE id = $2`,
            [interval, row.id]
          );
        }
      } else {
        summary.failed++;
        logger.error({ transactionId: row.id, error: result.error }, 'Transaction reminder email failed after claim');
      }
    }
  } catch (err) {
    logger.error({ err }, 'Transaction reminder sweep failed');
  }

  return summary;
}

async function runSweepSafely(source: string): Promise<void> {
  if (sweepInProgress) {
    logger.warn({ source }, 'Reminder sweep skipped because previous run is still in progress');
    return;
  }

  sweepInProgress = true;
  try {
    await runReminderSweep();
    await runPersonalTaskReminderSweep();
    await runTransactionReminderSweep();
  } catch (err) {
    logger.error({ err, source }, 'Scheduled reminder sweep failed');
  } finally {
    sweepInProgress = false;
  }
}

/**
 * Initialize the scheduler cron job
 */
export function initScheduler(): void {
  if (process.env.REMINDER_SCHEDULER_ENABLED !== 'true') {
    logger.info('Reminder scheduler is disabled');
    return;
  }

  const cron = process.env.REMINDER_CRON || '*/1 * * * *';
  const realtimeCron = process.env.REMINDER_REALTIME_CRON || '*/1 * * * *';

  // Run once at startup so overdue/in-progress/reminder emails are not delayed until next cron tick.
  void runSweepSafely('startup');

  schedulerJob = schedule.scheduleJob(cron, async () => {
    logger.info({ cron }, 'Running scheduled reminder sweep...');
    await runSweepSafely('configured-cron');
  });

  if (realtimeCron !== cron) {
    realtimeSweepJob = schedule.scheduleJob(realtimeCron, async () => {
      await runSweepSafely('realtime-cron');
    });
    logger.info({ realtimeCron }, 'Realtime reminder sweep initialized');
  }

  outboxJob = schedule.scheduleJob('*/5 * * * *', async () => {
    await processEmailOutbox(50);
  });

  // Daily overdue digest — runs every night at 00:05
  schedule.scheduleJob('5 0 * * *', async () => {
    logger.info('Triggering overdue daily digest (00:05 cron)');
    await runOverdueDailyDigest();
  });

  logger.info({ cron }, 'Reminder scheduler initialized');
}

/**
 * Shutdown the scheduler gracefully
 */
export function shutdownScheduler(): void {
  if (schedulerJob) {
    schedulerJob.cancel();
    schedulerJob = null;
    logger.info('Reminder scheduler stopped');
  }

  if (outboxJob) {
    outboxJob.cancel();
    outboxJob = null;
    logger.info('Email outbox scheduler stopped');
  }

  if (realtimeSweepJob) {
    realtimeSweepJob.cancel();
    realtimeSweepJob = null;
    logger.info('Realtime reminder scheduler stopped');
  }
}
