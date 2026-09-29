import { query } from '@/lib/db';
import { canUserAccessTaskId } from '@/lib/authorization';
import type { TaskAttachment } from '@/types';
import type { Session } from 'next-auth';

type AccessResult =
  | { ok: true; attachment: TaskAttachment }
  | { ok: false; status: 404 | 403; error: string };

export async function loadAttachmentForUser(
  user: Session['user'],
  attachId: number
): Promise<AccessResult> {
  const result = await query<TaskAttachment & { company_id: number | null; dept_id: number | null }>(
    `SELECT ta.*, t.company_id, t.dept_id
     FROM task_attachments ta
     JOIN tasks t ON ta.task_id = t.id
     WHERE ta.id = $1`,
    [attachId]
  );

  if (result.rowCount === 0) {
    return { ok: false, status: 404, error: 'Attachment not found' };
  }

  const attachment = result.rows[0];
  const canAccess = await canUserAccessTaskId(user, attachment.task_id);
  if (!canAccess) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }

  return { ok: true, attachment };
}

export function sanitizeFileName(value: string): string {
  return value.replace(/[\r\n"]/g, '_').trim() || 'download.bin';
}
