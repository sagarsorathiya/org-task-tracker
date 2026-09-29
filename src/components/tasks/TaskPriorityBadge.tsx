'use client';

import React from 'react';
import { Badge } from '@/components/ui/badge';
import type { TaskPriority } from '@/constants';

const priorityConfig: Record<TaskPriority, { label: string; variant: 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'info' }> = {
  low: { label: 'Low', variant: 'secondary' },
  medium: { label: 'Medium', variant: 'info' },
  high: { label: 'High', variant: 'warning' },
  critical: { label: 'Critical', variant: 'destructive' },
};

export function TaskPriorityBadge({ priority }: { priority: TaskPriority }) {
  const config = priorityConfig[priority] || { label: priority, variant: 'secondary' as const };
  return <Badge variant={config.variant}>{config.label}</Badge>;
}
