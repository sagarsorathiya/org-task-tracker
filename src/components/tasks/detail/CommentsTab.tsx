'use client';

import React, { useRef, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MessageSquare, Send, Trash2, Bold, Italic, Underline, List } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { formatDateTime } from '@/lib/utils';
import toast from 'react-hot-toast';
import { sanitizeRichText } from '@/lib/sanitize';
import type { TaskComment } from '@/types';

interface Props {
  taskId: number;
  comments: TaskComment[];
  onRefresh: () => void;
}

function isHtmlContent(str: string): boolean {
  return /<[a-zA-Z][\s\S]*?>/.test(str);
}

// Apply execCommand-based formatting (bold/italic/underline/list)
function execFmt(cmd: string) {
  document.execCommand(cmd, false, undefined);
}

export function CommentsTab({ taskId, comments, onRefresh }: Props) {
  const { data: session } = useSession();
  const editorRef = useRef<HTMLDivElement>(null);
  const [hasContent, setHasContent] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleInput = () => {
    const text = editorRef.current?.textContent ?? '';
    setHasContent(text.trim().length > 0);
  };

  const clearEditor = () => {
    if (editorRef.current) editorRef.current.innerHTML = '';
    setHasContent(false);
  };

  // Ctrl+Enter submits
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void postComment();
    }
  };

  const postComment = async () => {
    const htmlBody = editorRef.current?.innerHTML ?? '';
    const textContent = editorRef.current?.textContent ?? '';
    if (!textContent.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: htmlBody }),
      });
      const data = await res.json();
      if (data.success) {
        clearEditor();
        onRefresh();
      } else {
        toast.error(data.error);
      }
    } catch { toast.error('Failed'); }
    finally { setLoading(false); }
  };

  const deleteComment = async (commentId: number) => {
    try {
      await fetch(`/api/tasks/${taskId}/comments?commentId=${commentId}`, { method: 'DELETE' });
      onRefresh();
    } catch { toast.error('Failed'); }
  };

  return (
    <Card className="mt-4">
      <CardContent className="p-6 space-y-4">
        <h3 className="flex items-center gap-2 font-semibold"><MessageSquare className="h-4 w-4 text-primary" aria-hidden="true" />Status Updates ({comments.length})</h3>
        <div className="space-y-4 max-h-[400px] overflow-y-auto">
          {comments.length === 0 && (
            <p className="text-muted-foreground text-sm text-center py-8">No status updates yet</p>
          )}
          {comments.map((c) => (
            <div key={c.id} className="flex gap-3 group">
              <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-xs font-semibold text-primary">
                  {(c.user_display_name || c.user_name || 'U').charAt(0).toUpperCase()}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{c.user_display_name || c.user_name}</span>
                  <span className="text-xs text-muted-foreground">{formatDateTime(c.created_at)}</span>
                  {(c.user_id === session?.user?.id || session?.user?.role === 'admin') && (
                    <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 text-destructive" onClick={() => deleteComment(c.id)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </div>
                {isHtmlContent(c.body) ? (
                  <div
                    className="text-sm text-muted-foreground mt-1.5 rounded-xl rounded-tl-sm bg-muted/50 border border-border/70 px-3 py-2 prose prose-sm max-w-none break-words
                      [&_table]:w-full [&_table]:border-collapse [&_table]:my-2 [&_table]:text-xs
                      [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1
                      [&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:bg-muted [&_th]:font-semibold
                      [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5
                      [&_strong]:font-semibold [&_em]:italic [&_u]:underline"
                    dangerouslySetInnerHTML={{ __html: sanitizeRichText(c.body) }}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground mt-1.5 rounded-xl rounded-tl-sm bg-muted/50 border border-border/70 px-3 py-2 whitespace-pre-wrap break-words">{c.body}</p>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="pt-2 border-t space-y-2">
          {/* Formatting toolbar */}
          <div className="flex items-center gap-0.5 border border-border rounded-lg px-1 py-0.5 w-fit bg-muted/70">
            <button
              type="button"
              onMouseDown={(e) => { e.preventDefault(); execFmt('bold'); }}
              className="h-7 w-7 flex items-center justify-center rounded hover:bg-card text-muted-foreground hover:text-foreground"
              title="Bold (Ctrl+B)"
            >
              <Bold className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onMouseDown={(e) => { e.preventDefault(); execFmt('italic'); }}
              className="h-7 w-7 flex items-center justify-center rounded hover:bg-card text-muted-foreground hover:text-foreground"
              title="Italic (Ctrl+I)"
            >
              <Italic className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onMouseDown={(e) => { e.preventDefault(); execFmt('underline'); }}
              className="h-7 w-7 flex items-center justify-center rounded hover:bg-card text-muted-foreground hover:text-foreground"
              title="Underline (Ctrl+U)"
            >
              <Underline className="h-3.5 w-3.5" />
            </button>
            <div className="w-px h-4 bg-border mx-0.5" />
            <button
              type="button"
              onMouseDown={(e) => { e.preventDefault(); execFmt('insertUnorderedList'); }}
              className="h-7 w-7 flex items-center justify-center rounded hover:bg-card text-muted-foreground hover:text-foreground"
              title="Bullet list"
            >
              <List className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <div className="md:col-span-2">
              {/* contenteditable rich-text area - supports pasting HTML tables */}
              <div
                ref={editorRef}
                contentEditable
                suppressContentEditableWarning
                onInput={handleInput}
                onKeyDown={handleKeyDown}
                data-placeholder="Write a status update... (Ctrl+Enter to send)"
                className="min-h-[72px] max-h-[220px] overflow-y-auto rounded-xl border border-border bg-input px-3 py-2 text-sm ring-offset-background transition-all duration-200 hover:border-primary/30 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/15 focus-visible:border-primary/60
                  empty:before:content-[attr(data-placeholder)] empty:before:text-muted-foreground empty:before:pointer-events-none
                  [&_table]:w-full [&_table]:border-collapse [&_table]:my-1 [&_table]:text-xs
                  [&_td]:border [&_td]:border-border [&_td]:px-1.5 [&_td]:py-0.5
                  [&_th]:border [&_th]:border-border [&_th]:px-1.5 [&_th]:py-0.5 [&_th]:bg-muted [&_th]:font-semibold
                  [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5"
              />
            </div>
            <div className="space-y-2">
              <Button
                onClick={postComment}
                disabled={loading || !hasContent}
                className="w-full"
                id="add-comment-btn"
                variant="outline"
              >
                <Send className="h-4 w-4 mr-2" />
                Post Update
              </Button>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">Ctrl+Enter to send &middot; Paste tables from Excel/Word directly</p>
        </div>
      </CardContent>
    </Card>
  );
}

