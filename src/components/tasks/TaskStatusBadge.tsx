'use client';

import React from 'react';
import { Badge } from '@/components/ui/badge';
import type { TaskStatus } from '@/constants';
import { deriveDisplayTaskStatus, type DisplayTaskStatus as SharedDisplayTaskStatus } from '@/lib/taskStatus';

type DisplayStatus = SharedDisplayTaskStatus;

const statusConfig: Record<DisplayStatus, { label: string; variant: 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'info' }> = {
  open: { label: 'Open', variant: 'info' },
  upcoming: { label: 'Upcoming', variant: 'info' },
  in_progress: { label: 'In Progress', variant: 'warning' },
  completed: { label: 'Completed', variant: 'success' },
  cancelled: { label: 'Cancelled', variant: 'secondary' },
  overdue: { label: 'Overdue', variant: 'destructive' },
};

export function TaskStatusBadge({
  status,
  displayStatus,
  activityStartDate,
  activityStartTime,
  dueDate,
  dueTime,
}: {
  status: TaskStatus;
  displayStatus?: DisplayStatus;
  activityStartDate?: string | null;
  activityStartTime?: string | null;
  dueDate?: string | null;
  dueTime?: string | null;
  lastStatusUpdateAt?: string | null;
}) {
  const resolvedDisplayStatus = displayStatus || deriveDisplayTaskStatus({
    status,
    activityStartDate,
    activityStartTime,
    dueDate,
    dueTime,
  });
  const config = statusConfig[resolvedDisplayStatus] || { label: resolvedDisplayStatus, variant: 'secondary' as const };
  return <Badge variant={config.variant}>{config.label}</Badge>;
}
