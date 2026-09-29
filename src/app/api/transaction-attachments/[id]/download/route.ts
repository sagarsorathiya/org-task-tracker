// ──────────────────────────────────────────────
// /api/transaction-attachments/[id]/download — Stream file download
// ──────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { loadTransactionAttachmentForUser } from '@/lib/transactionAttachments';
import { sanitizeFileName } from '@/lib/attachments';
import { readFile } from 'fs/promises';
import { join } from 'path';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const attachId = parseInt(params.id, 10);
    if (isNaN(attachId)) {
      return NextResponse.json({ success: false, error: 'Invalid ID' }, { status: 400 });
    }

    const access = await loadTransactionAttachmentForUser(session.user, attachId);
    if (!access.ok) {
      return NextResponse.json({ success: false, error: access.error }, { status: access.status });
    }
    const attachment = access.attachment;

    const filePath = join(process.cwd(), 'uploads', attachment.stored_name);

    try {
      const fileBuffer = await readFile(filePath);
      const safeName = sanitizeFileName(attachment.original_name);
      return new NextResponse(fileBuffer, {
        headers: {
          'Content-Type': attachment.mime_type,
          'Content-Disposition': `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`,
          'Content-Length': String(fileBuffer.length),
        },
      });
    } catch {
      return NextResponse.json({ success: false, error: 'File not found on disk' }, { status: 404 });
    }
  } catch (err) {
    logger.error({ err }, 'GET /api/transaction-attachments/[id]/download error');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
