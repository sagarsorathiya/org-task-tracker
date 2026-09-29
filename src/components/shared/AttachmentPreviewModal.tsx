'use client';

import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Loader2, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { sanitizeRichText } from '@/lib/sanitize';

interface MailPreview {
  kind: 'eml' | 'msg';
  from: string;
  to: string;
  cc: string;
  subject: string;
  date: string;
  isHtml: boolean;
  body: string;
}

interface SheetData {
  name: string;
  rows: (string | number)[][];
}

const TEXT_EXTENSIONS = new Set(['txt', 'csv', 'tsv', 'log', 'md', 'json', 'xml']);
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']);
const SPREADSHEET_EXTENSIONS = new Set(['xlsx', 'xls']);
const WORD_EXTENSIONS = new Set(['docx']);
const MSG_EXTENSIONS = new Set(['msg']);
const SHEET_ROW_LIMIT = 500;
const SHEET_COL_LIMIT = 50;

function getExtension(name: string): string {
  return name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
}

// Minimal shape shared by TaskAttachment and TransactionReminderAttachment —
// this modal is used by both features, keyed off whichever `basePath` is passed in.
export interface PreviewableAttachment {
  id: number;
  original_name: string;
  mime_type: string;
}

export function isPreviewable(attachment: PreviewableAttachment): boolean {
  const ext = getExtension(attachment.original_name);
  return (
    ext === 'eml' ||
    ext === 'pdf' ||
    IMAGE_EXTENSIONS.has(ext) ||
    TEXT_EXTENSIONS.has(ext) ||
    SPREADSHEET_EXTENSIONS.has(ext) ||
    WORD_EXTENSIONS.has(ext) ||
    MSG_EXTENSIONS.has(ext) ||
    attachment.mime_type.startsWith('image/') ||
    attachment.mime_type.startsWith('text/')
  );
}

interface Props {
  attachment: PreviewableAttachment | null;
  onClose: () => void;
  /** API path prefix for this attachment's view/download routes — e.g. `/api/attachments` (tasks, default) or `/api/transaction-attachments`. */
  basePath?: string;
}

export function AttachmentPreviewModal({ attachment, onClose, basePath = '/api/attachments' }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [emlContent, setEmlContent] = useState<MailPreview | null>(null);
  const [sheets, setSheets] = useState<SheetData[] | null>(null);
  const [activeSheetIdx, setActiveSheetIdx] = useState(0);
  const [docHtml, setDocHtml] = useState<string | null>(null);

  const ext = attachment ? getExtension(attachment.original_name) : '';
  const viewUrl = attachment ? `${basePath}/${attachment.id}/view` : '';

  useEffect(() => {
    setTextContent(null);
    setEmlContent(null);
    setSheets(null);
    setActiveSheetIdx(0);
    setDocHtml(null);
    setError(null);
    if (!attachment) return;

    if (ext === 'eml') {
      setLoading(true);
      fetch(viewUrl)
        .then((res) => res.json())
        .then((data) => {
          if (data.success) setEmlContent(data.data);
          else setError(data.error || 'Failed to load preview');
        })
        .catch(() => setError('Failed to load preview'))
        .finally(() => setLoading(false));
      return;
    }

    if (MSG_EXTENSIONS.has(ext)) {
      setLoading(true);
      fetch(viewUrl)
        .then((res) => {
          if (!res.ok) throw new Error();
          return res.arrayBuffer();
        })
        .then(async (buf) => {
          const { default: MsgReader } = await import('@kenjiuno/msgreader');
          const fields = new MsgReader(buf).getFileData();
          const recipients = fields.recipients || [];
          const to = recipients.filter((r) => r.recipType === 'to').map((r) => r.name || r.email).join('; ');
          const cc = recipients.filter((r) => r.recipType === 'cc').map((r) => r.name || r.email).join('; ');
          const from = [fields.senderName, fields.senderEmail].filter(Boolean).join(' ');
          const isHtml = !!fields.bodyHtml;
          const rawBody = fields.bodyHtml || fields.body || '';
          setEmlContent({
            kind: 'msg',
            from,
            to,
            cc,
            subject: fields.subject || '(no subject)',
            date: fields.clientSubmitTime || fields.messageDeliveryTime || '',
            isHtml,
            body: isHtml ? sanitizeRichText(rawBody) : rawBody,
          });
        })
        .catch(() => setError('Failed to load preview'))
        .finally(() => setLoading(false));
      return;
    }

    if (SPREADSHEET_EXTENSIONS.has(ext)) {
      setLoading(true);
      fetch(viewUrl)
        .then((res) => {
          if (!res.ok) throw new Error();
          return res.arrayBuffer();
        })
        .then(async (buf) => {
          const XLSX = await import('xlsx');
          const wb = XLSX.read(buf, { type: 'array' });
          const parsed: SheetData[] = wb.SheetNames.map((name) => ({
            name,
            rows: (XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: false }) as (string | number)[][])
              .slice(0, SHEET_ROW_LIMIT)
              .map((row) => row.slice(0, SHEET_COL_LIMIT)),
          }));
          setSheets(parsed);
        })
        .catch(() => setError('Failed to load preview'))
        .finally(() => setLoading(false));
      return;
    }

    if (WORD_EXTENSIONS.has(ext)) {
      setLoading(true);
      fetch(viewUrl)
        .then((res) => {
          if (!res.ok) throw new Error();
          return res.arrayBuffer();
        })
        .then(async (buf) => {
          const mammoth = await import('mammoth');
          const result = await mammoth.convertToHtml({ arrayBuffer: buf });
          setDocHtml(sanitizeRichText(result.value));
        })
        .catch(() => setError('Failed to load preview'))
        .finally(() => setLoading(false));
      return;
    }

    if (TEXT_EXTENSIONS.has(ext) || attachment.mime_type.startsWith('text/')) {
      setLoading(true);
      fetch(viewUrl)
        .then((res) => {
          if (!res.ok) throw new Error();
          return res.text();
        })
        .then(setTextContent)
        .catch(() => setError('Failed to load preview'))
        .finally(() => setLoading(false));
    }
  }, [attachment?.id]);

  if (!attachment) return null;

  const isImage = attachment.mime_type.startsWith('image/') || IMAGE_EXTENSIONS.has(ext);
  const isPdf = attachment.mime_type === 'application/pdf' || ext === 'pdf';
  const isText = TEXT_EXTENSIONS.has(ext) || attachment.mime_type.startsWith('text/');
  const activeSheet = sheets?.[activeSheetIdx];

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl w-[90vw] max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0 flex-row items-center justify-between gap-4 pr-8">
          <DialogTitle className="truncate">{attachment.original_name}</DialogTitle>
          <DialogDescription className="sr-only">File preview</DialogDescription>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" asChild>
            <a href={`${basePath}/${attachment.id}/download`} download>
              <Download className="h-4 w-4" />
            </a>
          </Button>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto rounded-xl">
          {loading && (
            <div className="flex items-center justify-center h-64 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          )}

          {error && !loading && (
            <p className="text-sm text-destructive p-4">{error}</p>
          )}

          {!loading && !error && isImage && (
            <div className="flex items-center justify-center p-2">
              <img src={viewUrl} alt={attachment.original_name} className="max-w-full max-h-[75vh] object-contain rounded-lg" />
            </div>
          )}

          {!loading && !error && isPdf && (
            <iframe src={viewUrl} title={attachment.original_name} className="w-full h-[78vh] rounded-lg border-0" />
          )}

          {!loading && !error && isText && textContent !== null && (
            <pre className="whitespace-pre-wrap break-words text-xs p-4 font-mono">{textContent}</pre>
          )}

          {!loading && !error && sheets && activeSheet && (
            <div className="flex flex-col h-full">
              {sheets.length > 1 && (
                <div className="shrink-0 flex gap-1 px-3 pt-2 overflow-x-auto">
                  {sheets.map((sheet, idx) => (
                    <button
                      key={sheet.name}
                      onClick={() => setActiveSheetIdx(idx)}
                      className={`text-xs font-medium px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
                        idx === activeSheetIdx ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-muted'
                      }`}
                    >
                      {sheet.name}
                    </button>
                  ))}
                </div>
              )}
              <div className="p-3 overflow-x-auto">
                <table className="text-xs border-collapse">
                  <tbody>
                    {activeSheet.rows.map((row, rIdx) => (
                      <tr key={rIdx}>
                        {row.map((cell, cIdx) => (
                          <td key={cIdx} className="border border-border px-2 py-1 whitespace-nowrap">
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {!loading && !error && docHtml !== null && (
            <div
              className="text-sm p-4 prose-table:border [&_table]:border [&_td]:border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:px-2 [&_th]:py-1"
              dangerouslySetInnerHTML={{ __html: docHtml }}
            />
          )}

          {!loading && !error && emlContent && (
            <div className="p-4 space-y-3">
              <div className="space-y-1 text-sm border-b border-border pb-3">
                <p><span className="font-semibold">Subject:</span> {emlContent.subject}</p>
                <p><span className="font-semibold">From:</span> {emlContent.from}</p>
                {emlContent.to && <p><span className="font-semibold">To:</span> {emlContent.to}</p>}
                {emlContent.cc && <p><span className="font-semibold">Cc:</span> {emlContent.cc}</p>}
                {emlContent.date && <p><span className="font-semibold">Date:</span> {emlContent.date}</p>}
              </div>
              {emlContent.isHtml ? (
                <div className="text-sm prose-table:border" dangerouslySetInnerHTML={{ __html: emlContent.body }} />
              ) : (
                <pre className="whitespace-pre-wrap break-words text-sm font-sans">{emlContent.body}</pre>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
