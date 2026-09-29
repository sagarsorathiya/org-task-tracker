'use client';

import React, { useRef, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Upload, Download, Trash2, FileIcon, Eye, X, Paperclip } from 'lucide-react';
import { formatDate, formatFileSize } from '@/lib/utils';
import toast from 'react-hot-toast';
import type { TaskAttachment } from '@/types';
import { AttachmentPreviewModal, isPreviewable } from '@/components/shared/AttachmentPreviewModal';

interface Props { taskId: number; attachments: TaskAttachment[]; onRefresh: () => void; }

interface UploadingFile { name: string; progress: number; xhr: XMLHttpRequest; }

export function AttachmentsTab({ taskId, attachments, onRefresh }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingFile, setUploadingFile] = useState<UploadingFile | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [previewAttachment, setPreviewAttachment] = useState<TaskAttachment | null>(null);
  const uploading = uploadingFile !== null;

  const uploadFile = (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const xhr = new XMLHttpRequest();
    setUploadingFile({ name: file.name, progress: 0, xhr });

    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      setUploadingFile((prev) => (prev ? { ...prev, progress: Math.round((e.loaded / e.total) * 100) } : prev));
    };

    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300 && data.success) {
          toast.success('File uploaded');
          onRefresh();
        } else {
          toast.error(data.error || 'Upload failed');
        }
      } catch {
        toast.error('Upload failed');
      } finally {
        setUploadingFile(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };

    xhr.onerror = () => {
      toast.error('Upload failed');
      setUploadingFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    };

    xhr.onabort = () => {
      setUploadingFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    };

    xhr.open('POST', `/api/tasks/${taskId}/attachments`);
    xhr.send(formData);
  };

  const cancelUpload = () => uploadingFile?.xhr.abort();

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) uploadFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); };

  const deleteAttachment = async (attachId: number) => {
    try {
      await fetch(`/api/tasks/${taskId}/attachments?attachId=${attachId}`, { method: 'DELETE' });
      toast.success('Attachment deleted');
      onRefresh();
    } catch {
      toast.error('Failed');
    }
  };

  return (
    <Card className="mt-4">
      <CardContent className="p-6 space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="flex items-center gap-2 font-semibold"><Paperclip className="h-4 w-4 text-primary" aria-hidden="true" />Attachments ({attachments.length})</h3>
          <div>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={handleFileInput}
              id="file-upload-input"
              accept="image/*,.eml,.msg,.pdf,.doc,.docx,.dotx,.docm,.xls,.xlsx,.xlsm,.xlsb,.xltx,.ppt,.pptx,.pptm,.potx,.rtf,.odt,.ods,.odp,.csv,.tsv,.txt,.log,.md,.json,.xml"
            />
            <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploading} className="gap-1.5" id="upload-btn">
              <Upload className="h-3.5 w-3.5" /> {uploading ? 'Uploading...' : 'Upload'}
            </Button>
          </div>
        </div>

        {/* Drag-and-drop zone — always visible, doubles as empty state */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => !uploading && fileInputRef.current?.click()}
          className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 cursor-pointer transition-colors select-none ${
            isDragging
              ? 'border-primary bg-primary/5 text-primary'
              : 'border-primary/20 bg-accent/30 hover:border-primary/45 hover:bg-accent/50 text-muted-foreground hover:text-foreground'
          }`}
        >
          <Upload className="h-7 w-7" />
          <p className="text-sm font-medium">
            {isDragging ? 'Drop file to upload' : uploading ? 'Uploading…' : 'Drag & drop or click to upload'}
          </p>
          <p className="text-xs">PDF, Word, Excel, PowerPoint, images and more — up to 30 MB</p>
        </div>

        {uploadingFile && (
          <div className="flex items-center gap-2.5 py-1.5 px-2.5 rounded-xl border border-primary/20 bg-primary/5">
            <FileIcon className="h-4 w-4 text-primary shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate">{uploadingFile.name}</p>
              <div className="mt-1 h-1.5 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-150"
                  style={{ width: `${uploadingFile.progress}%` }}
                />
              </div>
            </div>
            <span className="text-[11px] font-semibold tabular-nums text-primary shrink-0">{uploadingFile.progress}%</span>
            <button
              type="button"
              title="Cancel upload"
              className="h-6 w-6 flex items-center justify-center rounded-md text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 transition-all shrink-0"
              onClick={cancelUpload}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {attachments.length > 0 && (
          <div className="max-h-80 overflow-y-auto pr-1 space-y-2">
            {attachments.map((att) => {
              const previewable = isPreviewable(att);
              return (
                <div
                  key={att.id}
                  className={`flex items-center gap-3 py-2 px-3 rounded-xl border border-transparent hover:border-border hover:bg-muted/50 group transition-all duration-150 ${previewable ? 'cursor-pointer' : ''}`}
                  onClick={() => previewable && setPreviewAttachment(att)}
                >
                  <FileIcon className="h-5 w-5 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{att.original_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatFileSize(att.size_bytes)} · {att.uploaded_by_name} · {formatDate(att.created_at)}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    {previewable && (
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); setPreviewAttachment(att); }}>
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                      <a href={`/api/attachments/${att.id}/download`} download onClick={(e) => e.stopPropagation()}>
                        <Download className="h-3.5 w-3.5" />
                      </a>
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive opacity-0 group-hover:opacity-100" onClick={(e) => { e.stopPropagation(); deleteAttachment(att.id); }}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
      <AttachmentPreviewModal attachment={previewAttachment} onClose={() => setPreviewAttachment(null)} />
    </Card>
  );
}
