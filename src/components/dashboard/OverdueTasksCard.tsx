'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AvatarInitials } from '@/components/ui/avatar-initials';
import { relativeDate } from '@/lib/relative-date';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Task } from '@/types';

interface OverdueTasksCardProps {
  refreshKey?: number;
}

const priorityStrip: Record<string, string> = {
  high:     'bg-destructive',
  medium:   'bg-warning',
  low:      'bg-border',
  critical: 'bg-destructive',
};


export function OverdueTasksCard({ refreshKey = 0 }: OverdueTasksCardProps) {
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch('/api/tasks?overdue=true&activeOnly=true&limit=50')
      .then((r) => r.json())
      .then((data) => { if (data.success) setTasks(data.data?.items || []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [refreshKey]);

  if (loading) return <div className="flex justify-center py-8"><LoadingSpinner /></div>;

  if (!tasks.length) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center">
        <div className="h-10 w-10 rounded-xl bg-muted flex items-center justify-center">
          <AlertTriangle className="h-5 w-5 text-muted-foreground" />
        </div>
        <p className="text-sm text-muted-foreground">No overdue tasks</p>
        <p className="text-xs text-muted-foreground/60">Everything is on track</p>
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
              <p className="text-sm font-medium text-foreground truncate leading-snug">{task.title}</p>
              {task.assigned_to_name && (
                <p className="text-[11px] text-muted-foreground truncate mt-0.5">{task.assigned_to_name}</p>
              )}
            </div>
            {rd.urgency === 'today' ? (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-success/10 border border-success/25 text-success text-sm font-semibold tabular-nums whitespace-nowrap shrink-0 animate-pulse">
                Today
              </span>
            ) : (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-destructive/10 border border-destructive/25 text-destructive text-sm font-semibold tabular-nums whitespace-nowrap shrink-0">
                {rd.label}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
