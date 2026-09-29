'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AvatarInitials } from '@/components/ui/avatar-initials';
import { TaskStatusBadge } from '@/components/tasks/TaskStatusBadge';
import { relativeDate, urgencyClass } from '@/lib/relative-date';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { CalendarDays } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Task } from '@/types';
import type { TaskStatus } from '@/constants';

interface UpcomingTableProps {
  days?: number;
  refreshKey?: number;
}

const priorityStrip: Record<string, string> = {
  high:     'bg-destructive',
  medium:   'bg-warning',
  low:      'bg-border',
  critical: 'bg-destructive',
};

export function UpcomingTable({ days = 7, refreshKey = 0 }: UpcomingTableProps) {
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/dashboard/upcoming?days=${days}&limit=50`)
      .then((r) => r.json())
      .then((data) => { if (data.success) setTasks(data.data || []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [days, refreshKey]);

  if (loading) return <div className="flex justify-center py-8"><LoadingSpinner /></div>;

  if (!tasks.length) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center">
        <div className="h-10 w-10 rounded-xl bg-muted flex items-center justify-center">
          <CalendarDays className="h-5 w-5 text-muted-foreground" />
        </div>
        <p className="text-sm text-muted-foreground">No tasks with a target date in the next {days} days</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-border/50">
      {tasks.map((task) => {
        const rd = relativeDate(task.due_date || task.follow_up_date);
        const strip = priorityStrip[task.priority?.toLowerCase() || 'low'] || 'bg-border';
        return (
          <button
            key={task.id}
            type="button"
            onClick={() => router.push(`/tasks/${task.id}`)}
            className="group w-full flex items-center gap-3 px-1 py-2.5 text-left transition-all duration-150 hover:bg-accent/35 hover:translate-x-0.5 rounded-lg"
          >
            <div className={cn('w-1 self-stretch rounded-full shrink-0', strip)} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{task.title}</p>
            </div>
            {task.assigned_to_name && (
              <AvatarInitials name={task.assigned_to_name} size="xs" className="shrink-0" />
            )}
            <TaskStatusBadge
              status={task.status as TaskStatus}
              activityStartDate={task.activity_start_date}
              activityStartTime={task.activity_start_time}
              dueDate={task.due_date}
              dueTime={task.due_time}
              lastStatusUpdateAt={task.last_status_update_at}
            />
            {(task.due_date || task.follow_up_date) && (
              rd.urgency === 'today' ? (
                <span className="shrink-0 inline-flex items-center px-2 py-0.5 rounded-full bg-success/10 border border-success/25 text-success text-sm font-semibold tabular-nums animate-pulse">
                  Today
                </span>
              ) : rd.urgency === 'overdue' ? (
                <span className="shrink-0 inline-flex items-center px-2 py-0.5 rounded-full bg-destructive/10 border border-destructive/25 text-destructive text-sm font-semibold tabular-nums">
                  {rd.label}
                </span>
              ) : rd.urgency === 'soon' ? (
                <span className="shrink-0 inline-flex items-center px-2 py-0.5 rounded-full bg-warning/10 border border-warning/25 text-warning text-sm font-semibold tabular-nums">
                  {rd.label}
                </span>
              ) : (
                <span className={cn('text-xs tabular-nums shrink-0 min-w-[56px] text-right', urgencyClass(rd.urgency))}>
                  {rd.label}
                </span>
              )
            )}
          </button>
        );
      })}
    </div>
  );
}
