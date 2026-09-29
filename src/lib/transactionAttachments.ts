import { query } from '@/lib/db';
import { canUserAccessTransactionReminderId } from '@/lib/authorization';
import type { TransactionReminderAttachment } from '@/types';
import type { Session } from 'next-auth';

type AccessResult =
  | { ok: true; attachment: TransactionReminderAttachment }
  | { ok: false; status: 404 | 403; error: string };

export async function loadTransactionAttachmentForUser(
  user: Session['user'],
  attachId: number
): Promise<AccessResult> {
  const result = await query<TransactionReminderAttachment & { company_id: number | null; dept_id: number | null }>(
    `SELECT tra.*, tr.company_id, tr.dept_id
     FROM transaction_reminder_attachments tra
     JOIN transaction_reminders tr ON tra.transaction_id = tr.id
     WHERE tra.id = $1`,
    [attachId]
  );

  if (result.rowCount === 0) {
    return { ok: false, status: 404, error: 'Attachment not found' };
  }

  const attachment = result.rows[0];
  const canAccess = await canUserAccessTransactionReminderId(user, attachment.transaction_id);
  if (!canAccess) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }

  return { ok: true, attachment };
}
