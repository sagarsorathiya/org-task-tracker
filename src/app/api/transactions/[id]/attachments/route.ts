// ──────────────────────────────────────────────
// /api/transactions/[id]/attachments — Upload and manage files
// ──────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { logger } from '@/lib/logger';
import { canUserAccessTransactionReminderId, canUserModifyTransactionReminderId } from '@/lib/authorization';
import { isAllowedAttachment, detectDangerousContent } from '@/lib/attachmentValidation';
import { MAX_FILE_SIZE_BYTES } from '@/constants';
import { v4 as uuidv4 } from 'uuid';
import { writeFile, mkdir, unlink } from 'fs/promises';
import { join } from 'path';
import type { TransactionReminderAttachment, ApiResponse } from '@/types';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Unauthorized' }, { status: 401 });

    const transactionId = parseInt(params.id, 10);
    if (Number.isNaN(transactionId)) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Invalid ID' }, { status: 400 });
    }

    const canAccess = await canUserAccessTransactionReminderId(session.user, transactionId);
    if (!canAccess) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const result = await query<TransactionReminderAttachment>(
      `SELECT tra.*, u.display_name as uploaded_by_name
       FROM transaction_reminder_attachments tra JOIN users u ON tra.uploaded_by = u.id
       WHERE tra.transaction_id = $1 ORDER BY tra.created_at DESC`,
      [transactionId]
    );

    return NextResponse.json<ApiResponse<TransactionReminderAttachment[]>>({ success: true, data: result.rows });
  } catch (err) {
    logger.error({ err }, 'GET /api/transactions/[id]/attachments error');
    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Unauthorized' }, { status: 401 });

    const transactionId = parseInt(params.id, 10);
    if (Number.isNaN(transactionId)) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Invalid ID' }, { status: 400 });
    }

    const canModify = await canUserModifyTransactionReminderId(session.user, transactionId);
    if (!canModify) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'No file provided' }, { status: 400 });
    }

    if (!isAllowedAttachment(file)) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: `File type not allowed: ${file.type || 'unknown'}` },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'File exceeds 30MB limit' }, { status: 400 });
    }

    const ext = file.name.split('.').pop() || 'bin';
    const storedName = `${uuidv4()}.${ext}`;
    const uploadsDir = join(process.cwd(), 'uploads');
    await mkdir(uploadsDir, { recursive: true });

    const buffer = Buffer.from(await file.arrayBuffer());

    const dangerousType = detectDangerousContent(buffer);
    if (dangerousType) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, error: `File content not allowed: ${dangerousType}` },
        { status: 400 }
      );
    }

    await writeFile(join(uploadsDir, storedName), buffer);

    const result = await query<TransactionReminderAttachment>(
      `INSERT INTO transaction_reminder_attachments (transaction_id, uploaded_by, original_name, stored_name, mime_type, size_bytes)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [transactionId, session.user.id, file.name, storedName, file.type, file.size]
    );

    logger.info({ transactionId, fileName: file.name }, 'Transaction attachment uploaded');
    return NextResponse.json<ApiResponse<TransactionReminderAttachment>>({ success: true, data: result.rows[0] }, { status: 201 });
  } catch (err) {
    logger.error({ err }, 'POST /api/transactions/[id]/attachments error');
    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Unauthorized' }, { status: 401 });

    const transactionId = parseInt(params.id, 10);
    if (Number.isNaN(transactionId)) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Invalid ID' }, { status: 400 });
    }

    const canModify = await canUserModifyTransactionReminderId(session.user, transactionId);
    if (!canModify) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const attachId = parseInt(searchParams.get('attachId') || '', 10);
    if (!attachId) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'attachId is required' }, { status: 400 });
    }

    const existing = await query<{ stored_name: string }>(
      'SELECT stored_name FROM transaction_reminder_attachments WHERE id = $1 AND transaction_id = $2',
      [attachId, transactionId]
    );
    if (existing.rowCount === 0) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Attachment not found' }, { status: 404 });
    }

    const storedName = existing.rows[0].stored_name;
    const filePath = join(process.cwd(), 'uploads', storedName);
    try {
      await unlink(filePath);
    } catch {
      // File may already be missing; still remove DB row.
    }

    const result = await query('DELETE FROM transaction_reminder_attachments WHERE id = $1 AND transaction_id = $2', [attachId, transactionId]);
    if (result.rowCount === 0) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Attachment not found' }, { status: 404 });
    }

    return NextResponse.json<ApiResponse<null>>({ success: true });
  } catch (err) {
    logger.error({ err }, 'DELETE /api/transactions/[id]/attachments error');
    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
