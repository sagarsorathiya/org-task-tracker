'use client';

import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import {
  Bell, Trash2, Plus, CheckCircle2, Circle, PlusCircle, Edit, CheckSquare,
  Clock, AlertCircle, Info,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePersonalTaskActivity, usePersonalTaskComments, usePersonalTasks } from '@/hooks/usePersonalTasks';
import type { PersonalTask, PersonalReminder, PersonalPriority } from '@/types';
import { Textarea } from '@/components/ui/textarea';
import { useSession } from 'next-auth/react';
import { Send } from 'lucide-react';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';

function fmtDate(iso: string) {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
}

function fmtDatetime(iso: string) {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min${mins > 1 ? 's' : ''} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs > 1 ? 's' : ''} ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days} day${days > 1 ? 's' : ''} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months > 1 ? 's' : ''} ago`;
  return `${Math.floor(months / 12)} year${Math.floor(months / 12) > 1 ? 's' : ''} ago`;
}

const PRIORITY_STYLES: Record<string, string> = {
  low: 'border-info/40 bg-info/10 text-info',
  medium: 'border-warning/40 bg-warning/10 text-warning',
  high: 'border-destructive/40 bg-destructive/10 text-destructive',
};

const PRIORITY_ACTIVE: Record<string, string> = {
  low: 'border-info bg-info/20 text-info',
  medium: 'border-warning bg-warning/20 text-warning',
  high: 'border-destructive bg-destructive/20 text-destructive',
};

const CHANNEL_LABEL: Record<string, string> = {
  in_app: 'In-App',
  email: 'Email',
  whatsapp: 'WhatsApp',
  both: 'Email + WhatsApp',
};

const CHANNEL_BADGE: Record<string, string> = {
  in_app: 'border-primary/40 bg-primary/10 text-primary',
  email: 'border-info/40 bg-info/10 text-info',
  whatsapp: 'border-success/40 bg-success/10 text-success',
  both: 'border-warning/40 bg-warning/10 text-warning',
};

const ACTION_ICONS: Record<string, React.ElementType> = {
  created: PlusCircle,
  updated_title: Edit,
  updated_status: CheckCircle2,
  updated_priority: AlertCircle,
  updated_notes: Edit,
  updated_due_date: Clock,
  subtask_added: CheckSquare,
  subtask_toggled: CheckSquare,
  reminder_added: Bell,
  reminder_deleted: Bell,
};

const ACTION_ICON_COLORS: Record<string, string> = {
  created: 'text-success',
  updated_title: 'text-warning',
  updated_status: 'text-info',
  updated_priority: 'text-destructive',
  updated_notes: 'text-warning',
  updated_due_date: 'text-info',
  subtask_added: 'text-primary',
  subtask_toggled: 'text-primary',
  reminder_added: 'text-info',
  reminder_deleted: 'text-destructive',
};

function actionLabel(action: string, meta: Record<string, unknown> | null): string {
  switch (action) {
    case 'created': return 'created this task';
    case 'updated_title': return `renamed to "${meta?.to ?? ''}"`;
    case 'updated_status': return `marked as ${meta?.to ?? ''}`;
    case 'updated_priority': return `changed priority to ${meta?.to ?? ''}`;
    case 'updated_notes': return 'updated notes';
    case 'updated_due_date': return `set due date to ${meta?.to ?? 'none'}`;
    case 'subtask_added': return `added subtask "${meta?.title ?? ''}"`;
    case 'subtask_toggled': return `${meta?.is_done ? 'checked' : 'unchecked'} subtask "${meta?.title ?? ''}"`;
    case 'reminder_added': return `added a ${CHANNEL_LABEL[String(meta?.channel)] ?? ''} reminder`;
    case 'reminder_deleted': return 'removed a reminder';
    default: return action.replace(/_/g, ' ');
  }
}

// ─── Details Tab ──────────────────────────────────────────────────────────────

interface DetailsTabProps { task: PersonalTask; statusFilter: string }
function DetailsTab({ task, statusFilter }: DetailsTabProps) {
  const { toggleDone, update } = usePersonalTasks(statusFilter as 'all' | 'pending' | 'done');
  const [updatingPriority, setUpdatingPriority] = useState(false);
  const [confirmComplete, setConfirmComplete] = useState(false);
  const [confirmReopen, setConfirmReopen] = useState(false);
  const isDone = task.status === 'done';

  async function handlePriority(p: PersonalPriority) {
    if (p === task.priority) return;
    setUpdatingPriority(true);
    try { await update(task.id, { priority: p }); } finally { setUpdatingPriority(false); }
  }

  return (
    <div className="space-y-4 py-2">
      {/* Status toggle */}
      <div>
        <p className="text-xs text-muted-foreground mb-1.5">Status</p>
        <button
          type="button"
          onClick={() => isDone ? setConfirmReopen(true) : setConfirmComplete(true)}
          className={cn(
            'flex items-center gap-2 px-3 py-1.5 rounded-md border text-sm font-medium transition-all',
            isDone
              ? 'border-success/40 bg-success/10 text-success hover:bg-success/20'
              : 'border-border/60 text-muted-foreground hover:border-border hover:text-foreground'
          )}
        >
          {isDone
            ? <CheckCircle2 className="h-3.5 w-3.5" />
            : <Circle className="h-3.5 w-3.5" />}
          {isDone ? 'Done — click to reopen' : 'Pending — click to complete'}
        </button>
      </div>

      <ConfirmDialog
        open={confirmComplete}
        onOpenChange={setConfirmComplete}
        title="Mark task as complete?"
        message={`"${task.title}" will be marked as done.${task.recurrence_rule !== 'none' ? ` A new ${task.recurrence_rule} occurrence will be created automatically.` : ''}`}
        confirmLabel="Complete"
        onConfirm={() => { toggleDone(task.id); setConfirmComplete(false); }}
      />

      <ConfirmDialog
        open={confirmReopen}
        onOpenChange={setConfirmReopen}
        title="Reopen task?"
        message={`"${task.title}" will be moved back to pending.`}
        confirmLabel="Reopen"
        onConfirm={() => { toggleDone(task.id); setConfirmReopen(false); }}
      />

      {/* Priority buttons */}
      <div>
        <p className="text-xs text-muted-foreground mb-1.5">Priority</p>
        <div className="flex gap-1.5">
          {(['low', 'medium', 'high'] as const).map((p) => (
            <button
              key={p}
              type="button"
              disabled={updatingPriority}
              onClick={() => handlePriority(p)}
              className={cn(
                'flex-1 py-1 rounded-md border text-xs font-semibold tracking-wide capitalize transition-all disabled:opacity-50',
                task.priority === p ? PRIORITY_ACTIVE[p] : PRIORITY_STYLES[p] + ' opacity-50 hover:opacity-100'
              )}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {task.notes && (
        <div>
          <p className="text-xs text-muted-foreground mb-1">Notes</p>
          <p className="text-sm whitespace-pre-wrap">{task.notes}</p>
        </div>
      )}

      {(task.due_date || task.due_time) && (
        <div>
          <p className="text-xs text-muted-foreground mb-1">Due</p>
          <p className="text-sm">
            {task.due_date ? fmtDate(task.due_date + 'T00:00:00') : ''}
            {task.due_time ? ` at ${task.due_time.slice(0, 5)}` : ''}
          </p>
        </div>
      )}

      <div className="text-xs text-muted-foreground pt-1 border-t border-border/50">
        Created {timeAgo(task.created_at)}
        {task.updated_at !== task.created_at && ` · Updated ${timeAgo(task.updated_at)}`}
      </div>
    </div>
  );
}

// ─── Subtasks Tab ─────────────────────────────────────────────────────────────

interface SubtasksTabProps { task: PersonalTask; statusFilter: string }
function SubtasksTab({ task, statusFilter }: SubtasksTabProps) {
  const { toggleSubtask, addSubtask } = usePersonalTasks(statusFilter as 'all' | 'pending' | 'done');
  const [newTitle, setNewTitle] = useState('');
  const [adding, setAdding] = useState(false);

  const done = task.subtasks.filter((s) => s.is_done).length;
  const total = task.subtasks.length;

  async function handleAdd() {
    const t = newTitle.trim();
    if (!t) return;
    setAdding(true);
    try {
      await addSubtask(task.id, t);
      setNewTitle('');
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="space-y-2 py-2">
      {total > 0 && (
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-muted-foreground">{done} of {total} completed</p>
          <Progress value={(done / total) * 100} className="h-1 w-28" />
        </div>
      )}

      <div className="space-y-1">
        {task.subtasks.map((s) => (
          <div
            key={s.id}
            className="flex items-center gap-2.5 px-2 py-1.5 rounded-md hover:bg-muted/60 transition-colors group cursor-pointer"
            onClick={() => toggleSubtask(task.id, s.id)}
          >
            <Checkbox
              checked={s.is_done}
              onCheckedChange={() => toggleSubtask(task.id, s.id)}
              className="shrink-0"
              onClick={(e) => e.stopPropagation()}
            />
            <span className={cn('text-sm flex-1 select-none', s.is_done && 'line-through text-muted-foreground')}>
              {s.title}
            </span>
          </div>
        ))}
      </div>

      {total === 0 && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
          <Info className="h-4 w-4 shrink-0" />
          No subtasks yet. Add one below.
        </div>
      )}

      {/* Add subtask */}
      <div className="pt-2 border-t border-border/50">
        <p className="text-xs font-medium mb-2">Add Subtask</p>
        <div className="flex gap-2">
          <Input
            placeholder="Subtask title..."
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAdd(); } }}
            className="text-sm h-8"
          />
          <Button size="sm" className="h-8 px-3" onClick={handleAdd} disabled={adding || !newTitle.trim()}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Status Tab ───────────────────────────────────────────────────────────────

interface StatusTabProps { taskId: number }
function StatusTab({ taskId }: StatusTabProps) {
  const { data: session } = useSession();
  const { comments, isLoading, postComment, deleteComment } = usePersonalTaskComments(taskId);
  const [body, setBody] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState('');

  async function handlePost() {
    if (!body.trim()) return;
    setPosting(true);
    setError('');
    try {
      await postComment(body.trim());
      setBody('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to post');
    } finally {
      setPosting(false);
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-3 py-2">
        {[1, 2].map((i) => (
          <div key={i} className="flex gap-3 animate-pulse">
            <div className="h-8 w-8 rounded-full bg-muted shrink-0" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 bg-muted rounded w-1/3" />
              <div className="h-3 bg-muted rounded w-3/4" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3 py-2">
      {/* Feed */}
      <div className="space-y-4">
        {comments.length === 0 && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
            <Info className="h-4 w-4 shrink-0" />
            No status updates yet.
          </div>
        )}
        {comments.map((c) => (
          <div key={c.id} className="flex gap-3 group">
            <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
              <span className="text-xs font-semibold text-primary">
                {(c.display_name || 'U').charAt(0).toUpperCase()}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium">{c.display_name}</span>
                <span className="text-xs text-muted-foreground">{timeAgo(c.created_at)}</span>
                {c.user_id === session?.user?.id && (
                  <button
                    type="button"
                    onClick={() => deleteComment(c.id)}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity ml-auto shrink-0"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
              <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap break-words">{c.body}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Compose */}
      <div className="pt-2 border-t border-border/50 space-y-2">
        <Textarea
          placeholder="Write a status update..."
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={2}
          className="text-sm resize-none"
        />
        <div className="flex items-center justify-between">
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            onClick={handlePost}
            disabled={posting || !body.trim()}
          >
            <Send className="h-3.5 w-3.5 mr-1.5" />
            Post Update
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Reminders Tab ────────────────────────────────────────────────────────────

interface RemindersTabProps { task: PersonalTask; statusFilter: string }
function RemindersTab({ task, statusFilter }: RemindersTabProps) {
  const { addReminder, deleteReminder } = usePersonalTasks(statusFilter as 'all' | 'pending' | 'done');
  const [newAt, setNewAt] = useState('');
  const [newChannel, setNewChannel] = useState<PersonalReminder['channel']>('in_app');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');

  async function handleAdd() {
    if (!newAt) { setError('Select a date and time'); return; }
    setAdding(true);
    setError('');
    try {
      await addReminder(task.id, new Date(newAt).toISOString(), newChannel);
      setNewAt('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add reminder');
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(reminderId: number) {
    try { await deleteReminder(task.id, reminderId); } catch { /* silent */ }
  }

  return (
    <div className="space-y-3 py-2">
      {task.reminders.length === 0 && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
          <Info className="h-4 w-4 shrink-0" />
          No active reminders for this task.
        </div>
      )}
      {task.reminders.map((r) => (
        <div key={r.id} className="flex items-center gap-3 p-2.5 rounded-md border border-border/50 bg-muted/30 group">
          <Bell className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm">{fmtDatetime(r.remind_at)}</p>
          </div>
          <Badge variant="outline" className={cn('text-xs shrink-0', CHANNEL_BADGE[r.channel])}>
            {CHANNEL_LABEL[r.channel]}
          </Badge>
          <button
            type="button"
            onClick={() => handleDelete(r.id)}
            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity shrink-0"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}

      <div className="pt-1 border-t border-border/50">
        <p className="text-xs font-medium mb-2">Add Reminder</p>
        <div className="flex items-end gap-2">
          <div className="flex-1 min-w-0">
            <Input type="datetime-local" value={newAt} onChange={(e) => setNewAt(e.target.value)} className="text-xs h-8" />
          </div>
          <div className="w-36">
            <Select value={newChannel} onValueChange={(v) => setNewChannel(v as PersonalReminder['channel'])}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(CHANNEL_LABEL).map(([val, lbl]) => (
                  <SelectItem key={val} value={val}>{lbl}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button size="sm" className="h-8 px-3" onClick={handleAdd} disabled={adding || !newAt}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
        {error && <p className="text-xs text-destructive mt-1">{error}</p>}
      </div>
    </div>
  );
}

// ─── Activity Tab ─────────────────────────────────────────────────────────────

interface ActivityTabProps { taskId: number }
function ActivityTab({ taskId }: ActivityTabProps) {
  const { activity, isLoading } = usePersonalTaskActivity(taskId);

  if (isLoading) {
    return (
      <div className="space-y-3 py-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex gap-3 animate-pulse">
            <div className="h-5 w-5 rounded-full bg-muted shrink-0 mt-0.5" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 bg-muted rounded w-3/4" />
              <div className="h-3 bg-muted rounded w-1/3" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (activity.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
        <Info className="h-4 w-4 shrink-0" />
        No activity recorded yet.
      </div>
    );
  }

  return (
    <div className="space-y-0 py-2">
      {activity.map((item, idx) => {
        const Icon = ACTION_ICONS[item.action] ?? Edit;
        const iconColor = ACTION_ICON_COLORS[item.action] ?? 'text-muted-foreground';
        const isLast = idx === activity.length - 1;
        return (
          <div key={item.id} className="flex gap-3 relative">
            {!isLast && <div className="absolute left-2.5 top-5 bottom-0 w-px bg-border/50" />}
            <div className={cn('h-5 w-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 bg-muted border border-border', iconColor)}>
              <Icon className="h-3 w-3" />
            </div>
            <div className="flex-1 pb-4 min-w-0">
              <p className="text-sm">
                <span className="font-medium">{item.display_name}</span>{' '}
                <span className="text-muted-foreground">{actionLabel(item.action, item.meta)}</span>
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">{timeAgo(item.created_at)}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────

interface Props {
  task: PersonalTask;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  statusFilter: string;
}

export function PersonalTaskDetailModal({ task, open, onOpenChange, statusFilter }: Props) {
  const subtaskDone = task.subtasks.filter((s) => s.is_done).length;
  const subtaskTotal = task.subtasks.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle className="text-base leading-snug pr-8">{task.title}</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="details" className="flex-1 flex flex-col min-h-0">
          <TabsList className="shrink-0">
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="subtasks">
              Subtasks
              {subtaskTotal > 0 && (
                <span className="ml-1.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary px-1">
                  {subtaskDone}/{subtaskTotal}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="status">Status</TabsTrigger>
            <TabsTrigger value="reminders">
              Reminders
              {task.reminders.length > 0 && (
                <span className="ml-1.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary px-1">
                  {task.reminders.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
          </TabsList>

          <div className="flex-1 overflow-y-auto">
            <TabsContent value="details" className="mt-0 px-0.5">
              <DetailsTab task={task} statusFilter={statusFilter} />
            </TabsContent>
            <TabsContent value="subtasks" className="mt-0 px-0.5">
              <SubtasksTab task={task} statusFilter={statusFilter} />
            </TabsContent>
            <TabsContent value="status" className="mt-0 px-0.5">
              <StatusTab taskId={task.id} />
            </TabsContent>
            <TabsContent value="reminders" className="mt-0 px-0.5">
              <RemindersTab task={task} statusFilter={statusFilter} />
            </TabsContent>
            <TabsContent value="activity" className="mt-0 px-0.5">
              <ActivityTab taskId={task.id} />
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
