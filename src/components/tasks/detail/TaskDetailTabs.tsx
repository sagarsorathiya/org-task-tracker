'use client';

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { SubtasksTab } from './SubtasksTab';
import { CommentsTab } from './CommentsTab';
import { AttachmentsTab } from './AttachmentsTab';
import { RemindersTab } from './RemindersTab';
import { ActivityTab } from './ActivityTab';
import { TaskStatusBadge } from '../TaskStatusBadge';
import { TaskPriorityBadge } from '../TaskPriorityBadge';
import { AvatarStack } from '@/components/ui/avatar-stack';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { formatDateTime, parseDateInput, parseNameList } from '@/lib/utils';
import { sanitizeRichText } from '@/lib/sanitize';
import { CalendarDays, UserRound, Flag, CircleDot, Building2, Bell, TrendingUp, Info } from 'lucide-react';
import type { Task, Subtask, TaskComment, TaskActivity, TaskAttachment, ReminderRule, User } from '@/types';
import type { TaskStatus, TaskPriority } from '@/constants';

interface Props {
  task: Task;
  subtasks: Subtask[];
  comments: TaskComment[];
  activity: TaskActivity[];
  attachments: TaskAttachment[];
  reminders: ReminderRule[];
  assignedUsers?: Array<Pick<User, 'id' | 'username' | 'display_name'>>;
  onRefresh: () => void;
}

function computeNextReminderDate(task: Task, reminders: ReminderRule[]): string | null {
  const timedReminder = reminders
    .filter((r) => r.is_active && !!r.remind_at)
    .map((r) => r.remind_at as string)
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

  if (timedReminder.length > 0) {
    const now = new Date().getTime();
    const upcoming = timedReminder.find((d) => new Date(d).getTime() >= now);
    return upcoming || timedReminder[timedReminder.length - 1];
  }

  if (task.follow_up_date) {
    return task.follow_up_date;
  }

  if (!task.due_date || reminders.length === 0) {
    return null;
  }

  const due = parseDateInput(task.due_date);
  if (!due) {
    return null;
  }

  const candidates = reminders
    .filter((r) => r.is_active)
    .map((r) => {
      const d = new Date(due);
      d.setDate(d.getDate() - r.offset_days);
      return d;
    })
    .filter((d) => !Number.isNaN(d.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());

  if (candidates.length === 0) {
    return null;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const upcoming = candidates.find((d) => d.getTime() >= today.getTime());
  return (upcoming || candidates[candidates.length - 1]).toISOString();
}

function AttributeRow({ icon: Icon, label, children }: { icon: React.ElementType; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className="h-7 w-7 rounded-lg bg-border/70 flex items-center justify-center shrink-0 text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
      </div>
      <span className="text-xs text-muted-foreground w-[72px] shrink-0">{label}</span>
      <div className="flex-1 min-w-0 text-sm font-medium truncate">{children}</div>
    </div>
  );
}

export function TaskDetailTabs({ task, subtasks, comments, activity, attachments, reminders, assignedUsers = [], onRefresh }: Props) {
  const nextReminderDate = computeNextReminderDate(task, reminders);
  const targetCompletionDateTime = task.due_date
    ? `${task.due_date.split('T')[0]}T${(task.due_time || '00:00:00').slice(0, 5)}`
    : null;
  const assignedNames = parseNameList((task as unknown as Record<string, unknown>).assigned_to_name as string | null);
  const doneCount = subtasks.filter((s) => s.is_done).length;
  const progressPct = subtasks.length > 0 ? Math.round((doneCount / subtasks.length) * 100) : 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Main column — Description, Attachments, Status Updates, Subtasks, Reminders, Activity */}
      <div className="lg:col-span-2 space-y-6">
        <Card>
          <CardContent className="p-6">
            <h3 className="flex items-center gap-2 font-semibold mb-3"><span className="h-4 w-1 rounded-full bg-primary" aria-hidden="true" />Description</h3>
            <div className="max-h-72 overflow-y-auto pr-1">
              {task.description ? (
                /<[a-zA-Z][\s\S]*?>/.test(task.description) ? (
                  <div
                    className="text-sm text-muted-foreground prose prose-sm max-w-none break-words
                      [&_table]:w-full [&_table]:border-collapse [&_table]:my-2 [&_table]:text-xs
                      [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1
                      [&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:bg-muted [&_th]:font-semibold
                      [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5
                      [&_strong]:font-semibold [&_em]:italic [&_u]:underline"
                    dangerouslySetInnerHTML={{ __html: sanitizeRichText(task.description) }}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap break-words">{task.description}</p>
                )
              ) : (
                <p className="text-sm text-muted-foreground">No description provided.</p>
              )}
            </div>
          </CardContent>
        </Card>

        <AttachmentsTab taskId={task.id} attachments={attachments} onRefresh={onRefresh} />
        <CommentsTab taskId={task.id} comments={comments} onRefresh={onRefresh} />
        <SubtasksTab taskId={task.id} subtasks={subtasks} onRefresh={onRefresh} />
        <RemindersTab taskId={task.id} reminders={reminders} onRefresh={onRefresh} />
        <ActivityTab taskId={task.id} activity={activity} assignedUsers={assignedUsers} />
      </div>

      {/* Attributes side panel */}
      <div className="space-y-6">
        <Card>
          <CardContent className="p-6">
            <p className="text-xs text-muted-foreground">
              Assigned By <span className="font-medium text-foreground">{(task as unknown as Record<string, unknown>).assigned_by_name as string || '—'}</span>
              {task.created_at && <> · {formatDateTime(task.created_at).split(',')[0]}</>}
            </p>
            <div className="h-px bg-border my-3" />
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground mb-1">Attributes</h3>
            <div className="divide-y divide-border">
              <AttributeRow icon={CalendarDays} label="Target Date">{formatDateTime(targetCompletionDateTime)}</AttributeRow>
              <AttributeRow icon={UserRound} label="Assigned to">
                {assignedNames.length === 0 ? (
                  '—'
                ) : assignedNames.length === 1 ? (
                  assignedNames[0]
                ) : (
                  <TooltipProvider delayDuration={150}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex items-center gap-2 cursor-default w-fit">
                          <AvatarStack names={assignedNames} size="xs" max={3} />
                          <span>{assignedNames.length} assignees</span>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">
                        {assignedNames.join(', ')}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </AttributeRow>
              {!!(task as unknown as Record<string, unknown>).information_to_name && (
                <AttributeRow icon={Info} label="Information">
                  {(task as unknown as Record<string, unknown>).information_to_name as string}
                </AttributeRow>
              )}
              <AttributeRow icon={Flag} label="Priority">
                <TaskPriorityBadge priority={task.priority as TaskPriority} />
              </AttributeRow>
              <AttributeRow icon={CircleDot} label="Status">
                <TaskStatusBadge
                  status={task.status as TaskStatus}
                  activityStartDate={task.activity_start_date}
                  activityStartTime={task.activity_start_time}
                  dueDate={task.due_date}
                  dueTime={task.due_time}
                  lastStatusUpdateAt={task.last_status_update_at}
                />
              </AttributeRow>
              <AttributeRow icon={Building2} label="Department">{task.dept_name || '—'}</AttributeRow>
              <AttributeRow icon={Bell} label="Reminder">{formatDateTime(nextReminderDate)}</AttributeRow>
              {subtasks.length > 0 && (
                <AttributeRow icon={TrendingUp} label="Progress">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${progressPct}%` }} />
                    </div>
                    <span className="text-xs tabular-nums text-muted-foreground shrink-0">{progressPct}%</span>
                  </div>
                </AttributeRow>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
