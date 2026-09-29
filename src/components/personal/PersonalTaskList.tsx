'use client';

import React, { useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { PersonalTaskFormModal, type PersonalTaskFormData } from './PersonalTaskFormModal';
import { PersonalTaskDetailModal } from './PersonalTaskDetailModal';
import {
  Pencil, Trash2, Eye, RefreshCw, Search, X, CheckSquare, ClipboardList,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { relativeDate, urgencyClass } from '@/lib/relative-date';
import { usePersonalTasks, type PersonalStatusFilter } from '@/hooks/usePersonalTasks';
import type { PersonalTask } from '@/types';

const PRIORITY_ACCENT: Record<string, string> = {
  low:    'border-l-border',
  medium: 'border-l-warning',
  high:   'border-l-destructive',
};

const RECURRENCE_LABEL: Record<string, string> = {
  daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly',
};

function isOverdue(task: PersonalTask): boolean {
  if (task.status === 'done' || !task.due_date) return false;
  return new Date(task.due_date + 'T23:59:59') < new Date();
}

function groupTasks(tasks: PersonalTask[]) {
  const urgent: PersonalTask[] = [];
  const thisWeek: PersonalTask[] = [];
  const later: PersonalTask[] = [];

  for (const t of tasks) {
    if (t.status === 'done') { later.push(t); continue; }
    if (isOverdue(t)) { urgent.push(t); continue; }
    if (!t.due_date) { later.push(t); continue; }
    const rd = relativeDate(t.due_date);
    if (rd.urgency === 'today' || rd.urgency === 'soon') { thisWeek.push(t); continue; }
    later.push(t);
  }

  return { urgent, thisWeek, later };
}

interface TaskCardProps {
  task: PersonalTask;
  statusFilter: PersonalStatusFilter;
  onToggleDone: (id: number) => void;
  onToggleSubtask: (taskId: number, subtaskId: number) => void;
  onEdit: (task: PersonalTask) => void;
  onDelete: (id: number) => void;
  muted?: boolean;
}

function TaskCard({ task, statusFilter, onToggleDone, onToggleSubtask, onEdit, onDelete, muted }: TaskCardProps) {
  const [detailOpen, setDetailOpen] = useState(false);
  const [confirmComplete, setConfirmComplete] = useState(false);
  const [confirmReopen, setConfirmReopen] = useState(false);
  const [expandedSubtasks, setExpandedSubtasks] = useState(false);

  const isDone = task.status === 'done';
  const overdue = isOverdue(task);
  const rd = task.due_date ? relativeDate(task.due_date) : null;
  const doneSubtasks = task.subtasks.filter((s) => s.is_done).length;
  const totalSubtasks = task.subtasks.length;
  const accent = overdue ? 'border-l-destructive' : PRIORITY_ACCENT[task.priority] || 'border-l-border';

  return (
    <>
      <div className={cn('group rounded-xl glass-card border-l-4 transition-colors hover:bg-muted/50', accent, muted && 'opacity-50')}>
        {/* Main row */}
        <div className="flex items-center gap-3 px-3 py-2.5 min-h-[44px]">
          <Checkbox
            checked={isDone}
            onCheckedChange={() => isDone ? setConfirmReopen(true) : setConfirmComplete(true)}
            className="shrink-0"
          />

          <span className={cn('flex-1 min-w-0 text-sm font-medium truncate', isDone && 'line-through text-muted-foreground')}>
            {task.title}
          </span>

          {/* Inline meta chips */}
          <div className="flex items-center gap-2 shrink-0">
            {task.recurrence_rule !== 'none' && (
              <Badge variant="outline" className="text-[10px] py-0 h-5 border-primary/30 bg-primary/10 text-primary gap-1">
                <RefreshCw className="h-2.5 w-2.5" /> {RECURRENCE_LABEL[task.recurrence_rule]}
              </Badge>
            )}

            {totalSubtasks > 0 && (
              <button
                type="button"
                onClick={() => setExpandedSubtasks((e) => !e)}
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              >
                <CheckSquare className="h-3 w-3" />
                {doneSubtasks}/{totalSubtasks}
              </button>
            )}

            {rd && (
              <span className={cn('text-[11px] tabular-nums font-medium', urgencyClass(rd.urgency))}>
                {rd.label}
              </span>
            )}
          </div>

          {/* Hover actions */}
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150 shrink-0">
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={() => setDetailOpen(true)}>
              <Eye className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={() => onEdit(task)}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => onDelete(task.id)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Expanded subtasks */}
        {expandedSubtasks && totalSubtasks > 0 && (
          <div className="px-10 pb-2.5 space-y-1.5 border-t border-border/50 pt-2">
            {task.subtasks.map((s) => (
              <div key={s.id} className="flex items-center gap-2">
                <Checkbox checked={s.is_done} onCheckedChange={() => onToggleSubtask(task.id, s.id)} className="h-3.5 w-3.5 shrink-0" />
                <span className={cn('text-xs', s.is_done && 'line-through text-muted-foreground')}>{s.title}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <PersonalTaskDetailModal task={task} open={detailOpen} onOpenChange={setDetailOpen} statusFilter={statusFilter} />

      <ConfirmDialog open={confirmComplete} onOpenChange={setConfirmComplete}
        title="Mark task as complete?"
        message={`"${task.title}" will be marked as done.${task.recurrence_rule !== 'none' ? ` A new ${task.recurrence_rule} occurrence will be created automatically.` : ''}`}
        confirmLabel="Complete"
        onConfirm={() => { onToggleDone(task.id); setConfirmComplete(false); }}
      />
      <ConfirmDialog open={confirmReopen} onOpenChange={setConfirmReopen}
        title="Reopen task?"
        message={`"${task.title}" will be moved back to pending.`}
        confirmLabel="Reopen"
        onConfirm={() => { onToggleDone(task.id); setConfirmReopen(false); }}
      />
    </>
  );
}

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-2 mb-2 mt-4 first:mt-0">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      <span className="text-[10px] text-muted-foreground/60">({count})</span>
      <div className="flex-1 h-px bg-border/50" />
    </div>
  );
}

interface Props {
  statusFilter: PersonalStatusFilter;
}

export function PersonalTaskList({ statusFilter }: Props) {
  const { tasks, isLoading, toggleDone, toggleSubtask, remove, update, addSubtask, addReminder, deleteReminder } = usePersonalTasks(statusFilter);

  const [search, setSearch] = useState('');
  const [editingTask, setEditingTask] = useState<PersonalTask | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  const filtered = search.trim()
    ? tasks.filter((t) => t.title.toLowerCase().includes(search.toLowerCase()))
    : tasks;

  const { urgent, thisWeek, later } = groupTasks(filtered);
  const useGrouping = statusFilter !== 'done';

  async function handleSave(data: PersonalTaskFormData) {
    if (!editingTask) return;
    const { subtasks, reminders, removedReminderIds } = data;
    await update(editingTask.id, {
      title: data.title, notes: data.notes, priority: data.priority,
      due_date: data.due_date, due_time: data.due_time, recurrence_rule: data.recurrence_rule,
    });
    const existingTitles = new Set(editingTask.subtasks.map((s) => s.title));
    for (const s of subtasks) { if (!existingTitles.has(s.title)) await addSubtask(editingTask.id, s.title); }
    for (const rid of removedReminderIds) await deleteReminder(editingTask.id, rid);
    for (const r of reminders) { if (!r.existingId) await addReminder(editingTask.id, r.remind_at, r.channel); }
  }

  async function handleDelete() {
    if (!deleteId) return;
    setDeleting(true);
    try { await remove(deleteId); } finally { setDeleting(false); setDeleteId(null); }
  }

  const cardProps = (task: PersonalTask, muted?: boolean) => ({
    task, statusFilter,
    onToggleDone: toggleDone, onToggleSubtask: toggleSubtask,
    onEdit: (t: PersonalTask) => { setEditingTask(t); setFormOpen(true); },
    onDelete: setDeleteId, muted,
  });

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => <div key={i} className="rounded-xl glass-subtle animate-pulse h-11" />)}
      </div>
    );
  }

  return (
    <>
      {tasks.length > 0 && (
        <div className="relative mb-3">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input placeholder="Search tasks..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 pr-8 h-8 text-sm" />
          {search && (
            <button type="button" onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          {search ? (
            <><Search className="h-8 w-8 text-muted-foreground/40 mb-3" /><p className="text-sm text-muted-foreground">No tasks match &ldquo;{search}&rdquo;</p></>
          ) : (
            <>
              <div className="h-12 w-12 rounded-xl bg-muted flex items-center justify-center mb-3">
                <ClipboardList className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium text-foreground">{statusFilter === 'done' ? 'No completed tasks' : 'No tasks yet'}</p>
              <p className="text-xs text-muted-foreground mt-1">{statusFilter === 'done' ? 'Complete some tasks to see them here.' : 'Create your first task to get started.'}</p>
            </>
          )}
        </div>
      ) : useGrouping ? (
        <div>
          {urgent.length > 0 && (
            <>
              <SectionHeader label="Needs Attention" count={urgent.length} />
              <div className="space-y-1.5">
                {urgent.map((t) => <TaskCard key={t.id} {...cardProps(t)} />)}
              </div>
            </>
          )}
          {thisWeek.length > 0 && (
            <>
              <SectionHeader label="This Week" count={thisWeek.length} />
              <div className="space-y-1.5">
                {thisWeek.map((t) => <TaskCard key={t.id} {...cardProps(t)} />)}
              </div>
            </>
          )}
          {later.length > 0 && (
            <>
              <SectionHeader label="Later" count={later.length} />
              <div className="space-y-1.5">
                {later.map((t) => <TaskCard key={t.id} {...cardProps(t)} />)}
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-1.5">
          {filtered.map((t) => <TaskCard key={t.id} {...cardProps(t, true)} />)}
        </div>
      )}

      <PersonalTaskFormModal
        open={formOpen}
        onOpenChange={(v) => { setFormOpen(v); if (!v) setEditingTask(null); }}
        task={editingTask}
        onSave={handleSave}
      />

      <ConfirmDialog
        open={deleteId !== null}
        onOpenChange={(v) => { if (!v) setDeleteId(null); }}
        title="Delete personal task?"
        message="This task and all its subtasks will be permanently deleted."
        confirmLabel="Delete"
        onConfirm={handleDelete}
        loading={deleting}
      />
    </>
  );
}
