'use client';

import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Download, Eye, FileIcon, Loader2, Pencil, Repeat } from 'lucide-react';
import { formatDate, formatFileSize } from '@/lib/utils';
import { AttachmentPreviewModal, isPreviewable, type PreviewableAttachment } from '@/components/shared/AttachmentPreviewModal';
import { TRANSACTION_REMINDER_RECURRENCE_OPTIONS } from '@/constants';
import type { TransactionReminder, TransactionReminderAttachment } from '@/types';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  record: TransactionReminder | null;
  onEdit: () => void;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
      <p className="text-sm">{value ?? '—'}</p>
    </div>
  );
}

export function TransactionReminderDetailModal({ open, onOpenChange, record, onEdit }: Props) {
  const [attachments, setAttachments] = useState<TransactionReminderAttachment[]>([]);
  const [loadingAttachments, setLoadingAttachments] = useState(false);
  const [previewAttachment, setPreviewAttachment] = useState<PreviewableAttachment | null>(null);

  useEffect(() => {
    if (!open || !record?.id) {
      setAttachments([]);
      return;
    }
    setLoadingAttachments(true);
    fetch(`/api/transactions/${record.id}/attachments`)
      .then((r) => r.json())
      .then((d) => { if (d.success && Array.isArray(d.data)) setAttachments(d.data); })
      .catch(() => { /* non-blocking */ })
      .finally(() => setLoadingAttachments(false));
  }, [open, record?.id]);

  if (!record) return null;

  const recurrenceLabel = TRANSACTION_REMINDER_RECURRENCE_OPTIONS.find((r) => r.value === record.recurrence)?.label;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-[94vw] max-w-2xl flex flex-col max-h-[90vh] overflow-hidden">
          <DialogHeader className="shrink-0">
            <div className="flex items-center gap-2">
              <Badge variant={record.type === 'subscription' ? 'info' : 'secondary'}>
                {record.type === 'subscription' ? 'Subscription' : 'Payment'}
              </Badge>
              <DialogTitle className="truncate">{record.party_name}</DialogTitle>
            </div>
            <DialogDescription>View transaction reminder details and attachments.</DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-5 py-2 pr-1">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Vendor Code" value={record.vendor_code} />
              <Field label="Place" value={record.place} />
            </div>

            <Field label="Agreement" value={record.agreement} />

            <div className="grid grid-cols-2 gap-4">
              <Field label="Execution Date" value={formatDate(record.execution_date)} />
              <Field label="Bill Date" value={formatDate(record.bill_date)} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field
                label="Reminder Date & Time"
                value={`${formatDate(record.reminder_date)} ${record.reminder_time?.slice(0, 5)}`}
              />
              <Field
                label="Repeat"
                value={record.recurrence !== 'none' ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Repeat className="h-3.5 w-3.5 text-info" /> {recurrenceLabel}
                  </span>
                ) : 'Does not repeat'}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Company" value={record.company_name} />
              <Field label="Department" value={record.dept_name} />
            </div>

            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Reminder Emails</p>
              <div className="flex flex-wrap gap-1.5">
                {record.reminder_emails.map((email) => (
                  <span key={email} className="inline-flex items-center rounded-full bg-primary/12 text-primary px-2.5 py-1 text-xs font-medium">
                    {email}
                  </span>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Attachments ({attachments.length})
              </p>
              {loadingAttachments && (
                <div className="flex items-center justify-center py-6 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              )}
              {!loadingAttachments && attachments.length === 0 && (
                <p className="text-xs text-muted-foreground">No attachments on this record.</p>
              )}
              {!loadingAttachments && attachments.length > 0 && (
                <div className="max-h-56 overflow-y-auto pr-1 space-y-1">
                  {attachments.map((att) => {
                    const previewable = isPreviewable(att);
                    return (
                      <div
                        key={att.id}
                        className={`flex items-center gap-2.5 py-1.5 px-2.5 rounded-xl border border-transparent hover:border-border hover:bg-muted/50 group transition-all duration-150 ${previewable ? 'cursor-pointer' : ''}`}
                        onClick={() => previewable && setPreviewAttachment(att)}
                      >
                        <FileIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{att.original_name}</p>
                          <p className="text-[10px] text-muted-foreground">{formatFileSize(att.size_bytes)}</p>
                        </div>
                        <div className="flex gap-1">
                          {previewable && (
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); setPreviewAttachment(att); }}>
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
                            <a href={`/api/transaction-attachments/${att.id}/download`} download onClick={(e) => e.stopPropagation()}>
                              <Download className="h-3.5 w-3.5" />
                            </a>
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 shrink-0">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
            <Button onClick={onEdit} className="gap-1.5">
              <Pencil className="h-3.5 w-3.5" /> Edit
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AttachmentPreviewModal
        attachment={previewAttachment}
        onClose={() => setPreviewAttachment(null)}
        basePath="/api/transaction-attachments"
      />
    </>
  );
}
