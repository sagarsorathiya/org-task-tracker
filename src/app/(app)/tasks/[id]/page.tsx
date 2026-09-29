'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { TaskStatusBadge } from '@/components/tasks/TaskStatusBadge';
import { TaskPriorityBadge } from '@/components/tasks/TaskPriorityBadge';
import { TaskDetailTabs } from '@/components/tasks/detail/TaskDetailTabs';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { ArrowLeft, Loader2, Pencil, Check } from 'lucide-react';
import { TaskForm } from '@/components/tasks/TaskForm';
import { useTaskDetail } from '@/hooks/useTaskDetail';
import { mutate as globalMutate } from 'swr';
import toast from 'react-hot-toast';
import type { TaskStatus, TaskPriority } from '@/constants';

export default function TaskDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const {
    task, subtasks, comments, activity, attachments, reminders, assignedUsers,
    isLoading, isError, notFound, apiError, mutate,
  } = useTaskDetail(params.id);

  const [editOpen, setEditOpen] = useState(false);
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [statusComment, setStatusComment] = useState('');
  const [reopenTargetDate, setReopenTargetDate] = useState('');
  const [statusSubmitting, setStatusSubmitting] = useState(false);

  useEffect(() => {
    if (notFound) {
      toast.error(apiError || 'Task not found');
      router.push('/tasks');
    }
  }, [notFound, apiError, router]);

  useEffect(() => {
    if (isError) {
      toast.error('Failed to load task');
    }
  }, [isError]);

  if (isLoading) return <LoadingSpinner className="py-32" size="lg" />;
  if (!task) return null;

  const isCompleted = task.status === 'completed';
  const canShowStatusAction = task.status !== 'cancelled';
  const targetAt = (() => {
    if (!task.due_date) return null;
    const datePart = task.due_date.split('T')[0];
    const timePart = (task.due_time || '00:00:00').slice(0, 8);
    const parsed = new Date(`${datePart}T${timePart}`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  })();
  const reopenNeedsNewTarget = isCompleted && !!targetAt && Date.now() > targetAt.getTime();
  const nowLocalDateTime = (() => {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  })();

  const openStatusDialog = () => {
    setStatusComment('');
    setReopenTargetDate('');
    setStatusDialogOpen(true);
  };

  const submitStatusChange = async () => {
    const trimmed = statusComment.trim();
    if (!trimmed) {
      toast.error(isCompleted ? 'Please add a reopen comment' : 'Please add a closing comment');
      return;
    }

    if (reopenNeedsNewTarget && !reopenTargetDate) {
      toast.error('Target date has passed. Please set a new target date before reopening.');
      return;
    }

    setStatusSubmitting(true);
    try {
      if (reopenNeedsNewTarget) {
        const targetRes = await fetch(`/api/tasks/${task.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetCompletionDate: reopenTargetDate }),
        });
        const targetJson = await targetRes.json();
        if (!targetJson.success) {
          toast.error(targetJson.error || 'Failed to update target date');
          return;
        }
      }

      const status = isCompleted ? 'in_progress' : 'completed';
      const res = await fetch(`/api/tasks/${task.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: trimmed, status }),
      });
      const json = await res.json();
      if (!json.success) {
        toast.error(json.error || 'Failed to update status');
        return;
      }

      toast.success(isCompleted ? 'Task reopened' : 'Task marked as completed');
      setStatusDialogOpen(false);
      setStatusComment('');
      setReopenTargetDate('');
      void globalMutate('/api/dashboard/stats');
      await mutate();
    } catch {
      toast.error('Failed to update task status');
    } finally {
      setStatusSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between pb-4 mb-2 border-b border-border">
        <div className="flex items-start gap-3 min-w-0">
          <span className="mt-1.5 h-6 w-1 rounded-full bg-primary shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => canShowStatusAction && openStatusDialog()}
                disabled={!canShowStatusAction}
                className={`h-5 w-5 shrink-0 rounded-md border-2 flex items-center justify-center transition-colors ${
                  isCompleted ? 'bg-primary border-primary text-primary-foreground' : 'border-border hover:border-primary/50 disabled:opacity-40'
                }`}
                aria-label={isCompleted ? 'Reopen task' : 'Mark task as complete'}
                title={isCompleted ? 'Reopen task' : 'Mark task as complete'}
              >
                {isCompleted && <Check className="h-3.5 w-3.5" />}
              </button>
              <h1 className={`text-xl font-bold tracking-tight leading-tight ${isCompleted ? 'line-through text-muted-foreground' : ''}`}>
                {task.title}
              </h1>
            </div>
            <p className="text-sm text-muted-foreground mt-1">Task #{task.id}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <TaskStatusBadge
            status={task.status as TaskStatus}
            activityStartDate={task.activity_start_date}
            activityStartTime={task.activity_start_time}
            dueDate={task.due_date}
            dueTime={task.due_time}
          />
          <TaskPriorityBadge priority={task.priority as TaskPriority} />
          <Button variant="outline" size="sm" onClick={() => router.push('/tasks')} className="gap-1.5">
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </Button>
          {!isCompleted && (
            <Button size="sm" onClick={() => setEditOpen(true)} className="gap-1.5">
              <Pencil className="h-3.5 w-3.5" /> Edit
            </Button>
          )}
          {canShowStatusAction && (
            <Button
              id="task-status-action-btn"
              size="sm"
              variant={isCompleted ? 'secondary' : 'default'}
              onClick={openStatusDialog}
              className="gap-1.5"
            >
              {isCompleted ? 'Reopen' : 'Complete'}
            </Button>
          )}
        </div>
      </div>

      <TaskDetailTabs
        task={task}
        subtasks={subtasks}
        comments={comments}
        activity={activity}
        attachments={attachments}
        reminders={reminders}
        assignedUsers={assignedUsers}
        onRefresh={() => mutate()}
      />

      <TaskForm
        open={editOpen}
        onOpenChange={setEditOpen}
        task={task}
        onSuccess={() => { setEditOpen(false); void mutate(); }}
      />

      <Dialog open={statusDialogOpen} onOpenChange={setStatusDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{isCompleted ? 'Reopen Task' : 'Mark Task as Complete'}</DialogTitle>
            <DialogDescription>
              {isCompleted
                ? 'Add a reopen comment and confirm to set this task back to In Progress.'
                : 'Add a closing comment and confirm to mark this task as Completed.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <label className="text-sm font-medium">Comment</label>
            <Textarea
              value={statusComment}
              onChange={(e) => setStatusComment(e.target.value)}
              placeholder={isCompleted ? 'Write why this task is being reopened...' : 'Write closing remarks...'}
              rows={4}
            />
          </div>

          {reopenNeedsNewTarget && (
            <div className="space-y-2">
              <label className="text-sm font-medium">New Target Date *</label>
              <input
                type="datetime-local"
                className="flex h-10 w-full rounded-xl border border-border bg-input px-3 py-2 text-sm ring-offset-background transition-all duration-200 hover:border-primary/30 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/15 focus-visible:border-primary/60"
                min={nowLocalDateTime}
                value={reopenTargetDate}
                onChange={(e) => setReopenTargetDate(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Previous target date is already exceeded. Set a new target to reopen this task.</p>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setStatusDialogOpen(false)} disabled={statusSubmitting}>
              Cancel
            </Button>
            <Button onClick={submitStatusChange} disabled={statusSubmitting || !statusComment.trim() || (reopenNeedsNewTarget && !reopenTargetDate)}>
              {statusSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isCompleted ? 'Reopen Task' : 'Mark as Complete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
