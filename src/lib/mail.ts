// ──────────────────────────────────────────────
// Nodemailer — SMTP Mail Service
// ──────────────────────────────────────────────

import nodemailer from 'nodemailer';
import { join } from 'path';
import { logger } from './logger';
import { getSecret } from './secrets';
import type { Task, User } from '@/types';

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    open: 'Open',
    in_progress: 'In Progress',
    completed: 'Completed',
    cancelled: 'Cancelled',
  };
  return map[status] ?? status;
}

// Strip dangerous constructs from HTML before embedding in email bodies
function sanitizeCommentHtml(html: string): string {
  return html
    // Remove script and style blocks
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    // Remove all on* event handlers (quoted or unquoted, with or without leading space)
    .replace(/\bon\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, '')
    // Strip javascript: and data: protocols from href/src/action attributes
    .replace(/(href|src|action)\s*=\s*["']?\s*(?:javascript|data|vbscript)\s*:/gi, '$1="#"')
    // Remove base tag (would rewrite all relative URLs in the email)
    .replace(/<base\b[^>]*>/gi, '');
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeHtmlWithLineBreaks(input: string): string {
  return escapeHtml(input).replace(/\r?\n/g, '<br />');
}

function formatDueDate(dueDate: string | null | undefined): string {
  if (!dueDate) return 'Not set';
  const dateOnly = dueDate.split('T')[0];
  const [year, month, day] = dateOnly.split('-').map((v) => Number(v));
  if (!year || !month || !day) return dueDate;

  const readable = new Date(year, month - 1, day);
  if (Number.isNaN(readable.getTime())) return dueDate;

  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(readable);
}

function formatDateTime(date: string | null | undefined, time: string | null | undefined): string {
  const dateStr = formatDueDate(date);
  if (!time || dateStr === 'Not set') return dateStr;
  const [h, m] = time.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return dateStr;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${dateStr}, ${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function renderEmailTemplate(options: {
  heading: string;
  title: string;
  message: string;
  infoRows: Array<{ label: string; value: string }>;
  ctaUrl: string;
  ctaText: string;
  commentBodyHtml?: string | null;
}): string {
  const heading = escapeHtml(options.heading);
  const title = escapeHtml(options.title);
  const message = escapeHtmlWithLineBreaks(options.message);
  const ctaUrl = escapeHtml(options.ctaUrl);
  const ctaText = escapeHtml(options.ctaText);

  const infoRowsHtml = options.infoRows.map((row, i) => {
    const isLast = i === options.infoRows.length - 1;
    return `
      <tr>
        <td style="padding:14px 16px;${isLast ? '' : 'border-bottom:1px solid #e5e7eb;'}">
          <p style="margin:0;color:#4B5563;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">${escapeHtml(row.label)}</p>
          <p style="margin:4px 0 0 0;color:#111827;font-weight:600;font-size:15px;">${escapeHtml(row.value)}</p>
        </td>
      </tr>`;
  }).join('');

  return `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>${heading}</title>
      </head>
      <body style="margin:0;padding:0;background:#F7F9FC;font-family:'Segoe UI',Tahoma,Arial,sans-serif;color:#111827;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#F7F9FC;padding:24px 12px;">
          <tr>
            <td align="center">
              <table role="presentation" width="640" cellspacing="0" cellpadding="0" style="width:100%;max-width:640px;background:#ffffff;border:1px solid #E5E7EB;border-radius:14px;overflow:hidden;">
                <tr>
                  <td style="background:linear-gradient(135deg,#111827,#1e3a8a);padding:20px 24px;">
                    <p style="margin:0;color:#93c5fd;font-size:12px;letter-spacing:0.6px;text-transform:uppercase;">Organization Activity Tracker</p>
                    <h1 style="margin:8px 0 0 0;color:#ffffff;font-size:22px;line-height:1.3;">${heading}</h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding:24px;">
                    <h2 style="margin:0 0 10px 0;font-size:24px;line-height:1.3;color:#111827;">${title}</h2>
                    <p style="margin:0 0 18px 0;color:#4B5563;font-size:15px;line-height:1.6;">${message}</p>

                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e5e7eb;border-radius:10px;background:#F3F4F6;">
                      ${infoRowsHtml}
                    </table>

                    ${options.commentBodyHtml ? `
                    <div style="margin-top:16px;padding:14px 16px;border:1px solid #e5e7eb;border-radius:10px;background:#F3F4F6;">
                      <p style="margin:0 0 8px 0;color:#4B5563;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Comment</p>
                      <div style="color:#111827;font-size:14px;line-height:1.6;overflow-x:auto;">
                        <style>table{border-collapse:collapse;width:100%;font-size:13px}td,th{border:1px solid #e5e7eb;padding:6px 10px}th{background:#f1f5f9;font-weight:600}</style>
                        ${options.commentBodyHtml}
                      </div>
                    </div>` : ''}

                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-top:22px;">
                      <tr>
                        <td align="left">
                          <!--[if mso]>
                          <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml"
                            href="${ctaUrl}"
                            style="height:44px;v-text-anchor:middle;width:180px;"
                            arcsize="16%"
                            stroke="f"
                            fillcolor="#2563eb">
                            <w:anchorlock/>
                            <center style="color:#ffffff;font-family:Segoe UI,Arial,sans-serif;font-size:15px;font-weight:700;">
                              ${ctaText}
                            </center>
                          </v:roundrect>
                          <![endif]-->
                          <!--[if !mso]><!-- -->
                          <a
                            href="${ctaUrl}"
                            target="_blank"
                            rel="noopener noreferrer"
                            style="
                              background:#2563eb;
                              border:1px solid #1d4ed8;
                              border-radius:10px;
                              color:#ffffff !important;
                              display:inline-block;
                              font-family:'Segoe UI',Tahoma,Arial,sans-serif;
                              font-size:15px;
                              font-weight:700;
                              line-height:44px;
                              min-width:180px;
                              text-align:center;
                              text-decoration:none;
                              -webkit-text-size-adjust:none;
                            "
                          >${ctaText}</a>
                          <!--<![endif]-->
                        </td>
                      </tr>
                      <tr>
                        <td style="padding-top:10px;">
                          <p style="margin:0;color:#4B5563;font-size:12px;line-height:1.5;word-break:break-all;">If the button does not work, open this link: <a href="${ctaUrl}" target="_blank" rel="noopener noreferrer" style="color:#2563eb;text-decoration:underline;">${ctaUrl}</a></p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="border-top:1px solid #e5e7eb;padding:14px 24px;background:#F3F4F6;">
                    <p style="margin:0;text-align:center;color:#4B5563;font-size:12px;">Organization Activity Tracker - Internal Use Only</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;
}

function createTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: getSecret('SMTP_PASSWORD') }
      : undefined,
  });
}

function resolvePortalUrl(): string {
  const raw =
    process.env.PORTAL_URL
    || process.env.APP_BASE_URL
    || process.env.NEXT_PUBLIC_APP_URL
    || process.env.NEXTAUTH_URL
    || 'http://localhost:4000';

  return raw.replace(/\/+$/, '');
}

export async function sendTaskReminder(
  user: Pick<User, 'email' | 'display_name'>,
  task: Pick<Task, 'id' | 'title' | 'due_date'> & {
    activity_start_date?: string | null;
    activity_start_time?: string | null;
    due_time?: string | null;
  }
): Promise<{ success: boolean; error?: string }> {
  if (!user.email) {
    return { success: false, error: 'No email address for user' };
  }

  if (!process.env.SMTP_HOST) {
    return { success: false, error: 'SMTP not configured' };
  }

  try {
    const transport = createTransport();
    const portalUrl = resolvePortalUrl();
    const safeTitle = task.title || 'Task';
    const safeAssignee = user.display_name || 'You';
    const startDateTime = formatDateTime(task.activity_start_date, task.activity_start_time);
    const dueDateTime = formatDateTime(task.due_date, task.due_time);
    const ctaUrl = `${portalUrl}/tasks/${task.id}`;

    // Determine if the task has already started so the subject/body reflects reality
    let taskStarted = false;
    if (task.activity_start_date) {
      const normalizedDate = task.activity_start_date.split('T')[0];
      const normalizedTime = (task.activity_start_time || '00:00:00').slice(0, 8);
      const startAt = new Date(`${normalizedDate}T${normalizedTime}`);
      if (!isNaN(startAt.getTime())) taskStarted = new Date() >= startAt;
    }

    const subject = taskStarted ? `Task Reminder: ${safeTitle}` : `Upcoming Task Reminder: ${safeTitle}`;
    const heading = taskStarted ? 'Task Reminder' : 'Upcoming Task Reminder';
    const message = taskStarted
      ? 'This task is currently in progress. Please ensure it is completed before the due date.'
      : 'This is a reminder for your upcoming task. Please be prepared.';

    const infoRows = [
      ...(task.activity_start_date ? [{ label: 'Start Date & Time', value: startDateTime }] : []),
      { label: 'Due Date & Time', value: dueDateTime },
      { label: 'Assigned To', value: safeAssignee },
    ];

    const textBody = [
      `${subject}`,
      '',
      message,
      '',
      ...(task.activity_start_date ? [`Start: ${startDateTime}`] : []),
      `Due: ${dueDateTime}`,
      `Assigned To: ${safeAssignee}`,
      '',
      `View Task: ${ctaUrl}`,
    ].join('\n');

    await transport.sendMail({
      from: process.env.SMTP_FROM || 'noreply@organization.local',
      to: user.email,
      subject,
      text: textBody,
      html: renderEmailTemplate({
        heading,
        title: safeTitle,
        message,
        infoRows,
        ctaUrl,
        ctaText: 'Open Task',
      }),
    });

    logger.info({ taskId: task.id, email: user.email, subject }, 'Reminder email sent');
    return { success: true };
  } catch (err) {
    logger.error({ err, taskId: task.id }, 'Failed to send reminder email');
    return { success: false, error: String(err) };
  }
}

export async function sendOverdueDailyDigestEmail(
  user: Pick<User, 'email' | 'display_name'>,
  tasks: Array<{
    task_id: number;
    task_title: string;
    due_date: string;
    due_time: string | null;
    priority: string;
  }>
): Promise<{ success: boolean; error?: string }> {
  if (!user.email) {
    return { success: false, error: 'No email address for user' };
  }

  if (!process.env.SMTP_HOST) {
    return { success: false, error: 'SMTP not configured' };
  }

  try {
    const transport = createTransport();
    const portalUrl = resolvePortalUrl();
    const safeRecipient = user.display_name || 'User';
    const count = tasks.length;
    const ctaUrl = `${portalUrl}/tasks`;

    const priorityLabel: Record<string, string> = {
      critical: 'Critical',
      high: 'High',
      medium: 'Medium',
      low: 'Low',
    };

    const priorityColor: Record<string, string> = {
      critical: '#EF4444',
      high: '#EF4444',
      medium: '#F59E0B',
      low: '#4B5563',
    };

    const tableRows = tasks
      .map((t) => {
        const dueStr = formatDateTime(t.due_date, t.due_time);
        const pLabel = priorityLabel[t.priority] ?? t.priority;
        const pColor = priorityColor[t.priority] ?? '#4B5563';
        return `
          <tr style="border-bottom:1px solid #e5e7eb;">
            <td style="padding:10px 14px;font-size:14px;color:#111827;font-weight:500;">${escapeHtml(t.task_title)}</td>
            <td style="padding:10px 14px;font-size:13px;color:#EF4444;white-space:nowrap;">${escapeHtml(dueStr)}</td>
            <td style="padding:10px 14px;white-space:nowrap;">
              <span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;color:#ffffff;background:${pColor};">${escapeHtml(pLabel)}</span>
            </td>
            <td style="padding:10px 14px;">
              <a href="${escapeHtml(portalUrl)}/tasks/${t.task_id}" target="_blank" rel="noopener noreferrer" style="color:#2563eb;text-decoration:underline;font-size:13px;">Open</a>
            </td>
          </tr>`;
      })
      .join('');

    const htmlBody = `
      <!doctype html>
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width,initial-scale=1" />
          <title>Overdue Tasks Digest</title>
        </head>
        <body style="margin:0;padding:0;background:#F7F9FC;font-family:'Segoe UI',Tahoma,Arial,sans-serif;color:#111827;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#F7F9FC;padding:24px 12px;">
            <tr>
              <td align="center">
                <table role="presentation" width="640" cellspacing="0" cellpadding="0" style="width:100%;max-width:640px;background:#ffffff;border:1px solid #E5E7EB;border-radius:14px;overflow:hidden;">
                  <tr>
                    <td style="background:linear-gradient(135deg,#111827,#7f1d1d);padding:20px 24px;">
                      <p style="margin:0;color:#fca5a5;font-size:12px;letter-spacing:0.6px;text-transform:uppercase;">Organization Activity Tracker</p>
                      <h1 style="margin:8px 0 0 0;color:#ffffff;font-size:22px;line-height:1.3;">⚠ Overdue Tasks Digest</h1>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:24px;">
                      <p style="margin:0 0 6px 0;font-size:15px;color:#4B5563;">Hi <strong>${escapeHtml(safeRecipient)}</strong>,</p>
                      <p style="margin:0 0 20px 0;font-size:15px;color:#4B5563;line-height:1.6;">
                        You have <strong style="color:#EF4444;">${count} overdue task${count !== 1 ? 's' : ''}</strong> that require${count === 1 ? 's' : ''} your attention. Please review and take action.
                      </p>

                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
                        <thead>
                          <tr style="background:#F3F4F6;">
                            <th style="padding:10px 14px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#4B5563;font-weight:600;">Task</th>
                            <th style="padding:10px 14px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#4B5563;font-weight:600;">Was Due</th>
                            <th style="padding:10px 14px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#4B5563;font-weight:600;">Priority</th>
                            <th style="padding:10px 14px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#4B5563;font-weight:600;"></th>
                          </tr>
                        </thead>
                        <tbody>${tableRows}</tbody>
                      </table>

                      <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-top:22px;">
                        <tr>
                          <td>
                            <!--[if mso]>
                            <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml"
                              href="${escapeHtml(ctaUrl)}"
                              style="height:44px;v-text-anchor:middle;width:200px;"
                              arcsize="16%"
                              stroke="f"
                              fillcolor="#EF4444">
                              <w:anchorlock/>
                              <center style="color:#ffffff;font-family:Segoe UI,Arial,sans-serif;font-size:15px;font-weight:700;">View All Tasks</center>
                            </v:roundrect>
                            <![endif]-->
                            <!--[if !mso]><!-- -->
                            <a href="${escapeHtml(ctaUrl)}" target="_blank" rel="noopener noreferrer"
                              style="background:#EF4444;border:1px solid #b91c1c;border-radius:10px;color:#ffffff !important;display:inline-block;font-family:'Segoe UI',Tahoma,Arial,sans-serif;font-size:15px;font-weight:700;line-height:44px;min-width:200px;text-align:center;text-decoration:none;-webkit-text-size-adjust:none;">View All Tasks</a>
                            <!--<![endif]-->
                          </td>
                        </tr>
                        <tr>
                          <td style="padding-top:10px;">
                            <p style="margin:0;color:#4B5563;font-size:12px;line-height:1.5;word-break:break-all;">If the button does not work, open: <a href="${escapeHtml(ctaUrl)}" target="_blank" rel="noopener noreferrer" style="color:#2563eb;text-decoration:underline;">${escapeHtml(ctaUrl)}</a></p>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td style="border-top:1px solid #e5e7eb;padding:14px 24px;background:#F3F4F6;">
                      <p style="margin:0;text-align:center;color:#4B5563;font-size:12px;">Organization Activity Tracker - Internal Use Only</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
      </html>
    `;

    const textBody = [
      `Overdue Tasks Digest — ${count} task${count !== 1 ? 's' : ''} overdue`,
      '',
      `Hi ${safeRecipient},`,
      '',
      'The following tasks are overdue:',
      '',
      ...tasks.map((t) => `• ${t.task_title} — Was Due: ${formatDateTime(t.due_date, t.due_time)} — ${priorityLabel[t.priority] ?? t.priority} priority — ${portalUrl}/tasks/${t.task_id}`),
      '',
      `View all tasks: ${ctaUrl}`,
    ].join('\n');

    await transport.sendMail({
      from: process.env.SMTP_FROM || 'noreply@organization.local',
      to: user.email,
      subject: `Overdue Tasks Digest: ${count} task${count !== 1 ? 's' : ''} need your attention`,
      text: textBody,
      html: htmlBody,
    });

    logger.info({ email: user.email, count }, 'Overdue daily digest email sent');
    return { success: true };
  } catch (err) {
    logger.error({ err, email: user.email }, 'Failed to send overdue daily digest email');
    return { success: false, error: String(err) };
  }
}

export async function sendTaskEventEmail(
  user: Pick<User, 'email' | 'display_name'>,
  task: Pick<Task, 'id' | 'title' | 'due_date'> & {
    activity_start_date?: string | null;
    activity_start_time?: string | null;
    due_time?: string | null;
  },
  options: {
    subject: string;
    message: string;
    taskStatus?: string | null;
    commentBodyHtml?: string | null;
    allAssigneeNames?: string[] | null;
  }
): Promise<{ success: boolean; error?: string }> {
  if (!user.email) {
    return { success: false, error: 'No email address for user' };
  }

  if (!process.env.SMTP_HOST) {
    return { success: false, error: 'SMTP not configured' };
  }

  try {
    const transport = createTransport();
    const portalUrl = resolvePortalUrl();
    const taskPath = task.id && task.id > 0 ? `/tasks/${task.id}` : '/tasks';
    const ctaUrl = `${portalUrl}${taskPath}`;
    const safeTitle = task.title || 'Task Update';
    const safeRecipient = user.display_name || 'User';
    const startDateTime = formatDateTime(task.activity_start_date, task.activity_start_time);
    const dueDateTime = formatDateTime(task.due_date, task.due_time);
    const textBody = [
      options.subject,
      '',
      options.message,
      '',
      `Task: ${safeTitle}`,
      ...(task.activity_start_date ? [`Start: ${startDateTime}`] : []),
      `Due: ${dueDateTime}`,
      `Recipient: ${safeRecipient}`,
      '',
      `View Task: ${ctaUrl}`,
    ].join('\n');

    await transport.sendMail({
      from: process.env.SMTP_FROM || 'noreply@organization.local',
      to: user.email,
      subject: options.subject,
      text: textBody,
      html: renderEmailTemplate({
        heading: 'Task Notification',
        title: safeTitle,
        message: options.message,
        infoRows: [
          ...(options.taskStatus ? [{ label: 'Status', value: statusLabel(options.taskStatus) }] : []),
          ...(task.activity_start_date ? [{ label: 'Start Date & Time', value: startDateTime }] : []),
          { label: 'Due Date & Time', value: dueDateTime },
          ...(options.allAssigneeNames?.length
            ? [{ label: 'Assigned To', value: options.allAssigneeNames.join(', ') }]
            : [{ label: 'Recipient', value: safeRecipient }]),
        ],
        ctaUrl,
        ctaText: 'View Task',
        commentBodyHtml: options.commentBodyHtml ? sanitizeCommentHtml(options.commentBodyHtml) : null,
      }),
    });

    logger.info({ taskId: task.id, email: user.email, subject: options.subject }, 'Task event email sent');
    return { success: true };
  } catch (err) {
    logger.error({ err, taskId: task.id, subject: options.subject }, 'Failed to send task event email');
    return { success: false, error: String(err) };
  }
}

export async function sendTransactionReminderEmail(
  recipientEmails: string[],
  record: {
    id: number;
    type: 'subscription' | 'payment';
    party_name: string;
    vendor_code?: string | null;
    place?: string | null;
    agreement?: string | null;
    execution_date?: string | null;
    bill_date?: string | null;
    recurrence?: 'none' | 'weekly' | 'monthly' | 'yearly';
  },
  attachments: Array<{ original_name: string; stored_name: string }>
): Promise<{ success: boolean; error?: string }> {
  const validEmails = recipientEmails.map((e) => e.trim()).filter(Boolean);
  if (validEmails.length === 0) {
    return { success: false, error: 'No recipient emails on record' };
  }

  if (!process.env.SMTP_HOST) {
    return { success: false, error: 'SMTP not configured' };
  }

  try {
    const transport = createTransport();
    const typeLabel = record.type === 'subscription' ? 'Subscription' : 'Payment';
    const subject = `Transaction Reminder (${typeLabel}): ${record.party_name}`;
    const infoRows = [
      { label: 'Type', value: typeLabel },
      { label: 'Party Name', value: record.party_name },
      ...(record.vendor_code ? [{ label: 'Vendor Code', value: record.vendor_code }] : []),
      ...(record.place ? [{ label: 'Place', value: record.place }] : []),
      ...(record.agreement ? [{ label: 'Agreement', value: record.agreement }] : []),
      { label: 'Execution Date', value: formatDueDate(record.execution_date) },
      { label: 'Bill Date', value: formatDueDate(record.bill_date) },
      ...(record.recurrence && record.recurrence !== 'none'
        ? [{ label: 'Recurs', value: record.recurrence.charAt(0).toUpperCase() + record.recurrence.slice(1) }]
        : []),
    ];

    const textBody = [
      subject,
      '',
      'This is a reminder regarding the following transaction/agreement.',
      '',
      ...infoRows.map((row) => `${row.label}: ${row.value}`),
    ].join('\n');

    const mailAttachments = attachments.map((a) => ({
      filename: a.original_name,
      path: join(process.cwd(), 'uploads', a.stored_name),
    }));

    await transport.sendMail({
      from: process.env.SMTP_FROM || 'noreply@organization.local',
      to: validEmails.join(', '),
      subject,
      text: textBody,
      html: renderEmailTemplate({
        heading: 'Transaction Reminder',
        title: record.party_name,
        message: 'This is a reminder regarding the following transaction/agreement.',
        infoRows,
        ctaUrl: `${resolvePortalUrl()}/transactions`,
        ctaText: 'View Reminders',
      }),
      attachments: mailAttachments.length > 0 ? mailAttachments : undefined,
    });

    logger.info(
      { transactionId: record.id, recipients: validEmails.length, attachmentCount: attachments.length },
      'Transaction reminder email sent'
    );
    return { success: true };
  } catch (err) {
    logger.error({ err, transactionId: record.id }, 'Failed to send transaction reminder email');
    return { success: false, error: String(err) };
  }
}
