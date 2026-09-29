// ──────────────────────────────────────────────
// /api/attachments/[id]/view — Inline preview (images, PDF, text/code, eml)
// ──────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { loadAttachmentForUser, sanitizeFileName } from '@/lib/attachments';
import { parseEml } from '@/lib/eml-parser';
import { readFile } from 'fs/promises';
import { join } from 'path';

const TEXT_PREVIEW_EXTENSIONS = new Set(['txt', 'csv', 'tsv', 'log', 'md', 'json', 'xml']);
const IMAGE_PREVIEW_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']);
const SPREADSHEET_PREVIEW_EXTENSIONS = new Set(['xlsx', 'xls']);
const WORD_PREVIEW_EXTENSIONS = new Set(['docx']);
const MSG_PREVIEW_EXTENSIONS = new Set(['msg']);

function getExtension(name: string): string {
  return name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
}

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

    const access = await loadAttachmentForUser(session.user, attachId);
    if (!access.ok) {
      return NextResponse.json({ success: false, error: access.error }, { status: access.status });
    }
    const attachment = access.attachment;
    const ext = getExtension(attachment.original_name);
    const filePath = join(process.cwd(), 'uploads', attachment.stored_name);

    const fileBuffer = await readFile(filePath).catch(() => null);
    if (!fileBuffer) {
      return NextResponse.json({ success: false, error: 'File not found on disk' }, { status: 404 });
    }

    if (ext === 'eml') {
      const parsed = parseEml(fileBuffer);
      return NextResponse.json({ success: true, data: { kind: 'eml', ...parsed } });
    }

    const isImage = attachment.mime_type.startsWith('image/') || IMAGE_PREVIEW_EXTENSIONS.has(ext);
    const isPdf = attachment.mime_type === 'application/pdf' || ext === 'pdf';
    const isText = attachment.mime_type.startsWith('text/') || TEXT_PREVIEW_EXTENSIONS.has(ext);
    const isSpreadsheet = SPREADSHEET_PREVIEW_EXTENSIONS.has(ext);
    const isWord = WORD_PREVIEW_EXTENSIONS.has(ext);
    const isMsg = MSG_PREVIEW_EXTENSIONS.has(ext);

    if (!isImage && !isPdf && !isText && !isSpreadsheet && !isWord && !isMsg) {
      return NextResponse.json({ success: false, error: 'Preview not available for this file type' }, { status: 415 });
    }

    const safeName = sanitizeFileName(attachment.original_name);
    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': attachment.mime_type || 'application/octet-stream',
        'Content-Disposition': `inline; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`,
        'Content-Length': String(fileBuffer.length),
      },
    });
  } catch (err) {
    logger.error({ err }, 'GET /api/attachments/[id]/view error');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
