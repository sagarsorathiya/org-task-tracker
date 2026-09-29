'use client';

import React, { useMemo, useState } from 'react';
import { DataTable } from '@/components/shared/DataTable';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { TaskStatusBadge } from './TaskStatusBadge';
import { AvatarInitials } from '@/components/ui/avatar-initials';
import { AvatarStack } from '@/components/ui/avatar-stack';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { Eye, Pencil, Trash2, RotateCcw, CheckCircle2 } from 'lucide-react';
import { parseDateInput, parseNameList, truncate, cn, categoryTint as deptColor, CATEGORY_TINTS } from '@/lib/utils';
import { relativeDate, urgencyClass } from '@/lib/relative-date';
import type { Task, ColumnDef } from '@/types';
import type { TaskStatus, TaskPriority } from '@/constants';

export const TOGGLEABLE_TASK_COLUMNS = [
  { key: 'id', label: 'ID' },
  { key: 'title', label: 'Title' },
  { key: 'assigned_to_name', label: 'Assigned To' },
  { key: 'assigned_by_name', label: 'Assigned By' },
  { key: 'dept_name', label: 'Department' },
  { key: 'status', label: 'Status' },
  { key: 'activity_start_date', label: 'Task Date' },
  { key: 'last_status_update_at', label: 'Last Update' },
  { key: 'next_reminder_at', label: 'Next Reminder' },
  { key: 'due_date', label: 'Due Date' },
] as const;

interface TaskTableProps {
  tasks: Task[];
  total: number;
  page: number;
  totalPages: number;
  loading: boolean;
  sortBy: string;
  sortDir: 'asc' | 'desc';
  showDeleted: boolean;
  canManage: boolean;
  hiddenColumns: string[];
  columnLabelOverrides?: Partial<Record<string, string>>;
  onPageChange: (page: number) => void;
  onSort: (key: string, dir: 'asc' | 'desc') => void;
  onRowClick: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  onRestore: (task: Task) => void;
  onComplete?: (task: Task) => void;
}

const priorityStrip: Record<string, string> = {
  high:     'bg-destructive',
  medium:   'bg-warning',
  low:      'bg-border',
  critical: 'bg-destructive',
};

const priorityDot: Record<string, string> = {
  high:     'bg-destructive',
  medium:   'bg-warning',
  low:      'bg-border',
  critical: 'bg-destructive',
};

export function TaskTable({
  tasks, total, page, totalPages, loading, sortBy, sortDir,
  showDeleted, canManage, hiddenColumns, columnLabelOverrides,
  onPageChange, onSort, onRowClick, onEdit, onDelete, onRestore, onComplete,
}: TaskTableProps) {
  const label = (key: string, fallback: string) => columnLabelOverrides?.[key] ?? fallback;
  const [confirmDelete, setConfirmDelete] = useState<Task | null>(null);

  // Memoize department colour lookups so the hash isn't recomputed every render.
  const deptColorCache = useMemo(() => new Map<string, (typeof CATEGORY_TINTS)[number]>(), []);

  const formatCompactDateTime = (value?: string | null, fallbackDateOnly = false) => {
    if (!value) return '—';
    const parsed = parseDateInput(value);
    if (!parsed) return '—';
    const hasTime = !fallbackDateOnly && /T|\d{2}:\d{2}/.test(value);
    if (!hasTime) return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: '2-digit' }).format(parsed);
    return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true }).format(parsed);
  };

  const renderTaskDateTime = (row: Task) => {
    if (!row.activity_start_date) return '—';
    if (row.activity_start_time) return formatCompactDateTime(`${row.activity_start_date.split('T')[0]}T${row.activity_start_time.slice(0, 5)}`);
    return formatCompactDateTime(row.activity_start_date, true);
  };

  const columns: ColumnDef<Task>[] = [
    {
      key: 'priority_strip',
      header: '',
      className: 'w-1 p-0',
      render: (row) => (
        <div className={cn('w-1 h-full min-h-[36px] rounded-sm', priorityStrip[(row.priority as string)?.toLowerCase()] || 'bg-border')} />
      ),
    },
    { key: 'id', header: 'ID', sortable: true, className: 'w-12 min-w-12', render: (row) => <span className="text-muted-foreground text-xs">{row.id}</span> },
    {
      key: 'title', header: 'Title', sortable: true, className: 'min-w-[160px]',
      render: (row) => (
        <div className="flex items-center gap-2">
          <div className={cn('h-1.5 w-1.5 rounded-full shrink-0', priorityDot[(row.priority as string)?.toLowerCase()] || 'bg-border')} />
          <span className="font-medium text-foreground">{truncate(row.title, 48)}</span>
        </div>
      ),
    },
    {
      key: 'assigned_to_name', header: 'Assigned To', className: 'min-w-[120px] whitespace-nowrap',
      render: (row) => {
        const names = parseNameList(row.assigned_to_name);
        if (names.length === 0) return <span className="text-muted-foreground">—</span>;
        if (names.length === 1) {
          return <div className="flex items-center gap-2"><AvatarInitials name={names[0]} size="xs" /><span className="text-sm">{truncate(names[0], 20)}</span></div>;
        }
        return (
          <TooltipProvider delayDuration={150}>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-2 cursor-default w-fit">
                  <AvatarStack names={names} size="xs" max={3} />
                  <span className="text-sm">{truncate(names[0], 14)} +{names.length - 1}</span>
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom">{names.join(', ')}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      },
    },
    {
      key: 'assigned_by_name', header: 'Assigned By', className: 'min-w-[120px] whitespace-nowrap',
      render: (row) => row.assigned_by_name
        ? <div className="flex items-center gap-2"><AvatarInitials name={row.assigned_by_name} size="xs" /><span className="text-sm">{truncate(row.assigned_by_name, 20)}</span></div>
        : <span className="text-muted-foreground">—</span>,
    },
    {
      key: 'dept_name', header: 'Department', className: 'min-w-[92px]',
      render: (row) => {
        if (!row.dept_name) return <span className="text-muted-foreground">—</span>;
        if (!deptColorCache.has(row.dept_name)) deptColorCache.set(row.dept_name, deptColor(row.dept_name));
        const c = deptColorCache.get(row.dept_name)!;
        return (
          <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium', c.bg, c.text, c.border)}>
            {truncate(row.dept_name, 16)}
          </span>
        );
      },
    },
    {
      key: 'status', header: 'Status', sortable: true, className: 'min-w-[96px]',
      render: (row) => (
        <TaskStatusBadge
          status={row.status as TaskStatus}
          displayStatus={row.display_status as TaskStatus | 'upcoming' | 'overdue' | undefined}
          activityStartDate={row.activity_start_date}
          activityStartTime={row.activity_start_time}
          dueDate={row.due_date}
          dueTime={row.due_time}
          lastStatusUpdateAt={row.last_status_update_at}
        />
      ),
    },
    { key: 'activity_start_date', header: label('activity_start_date', 'Task Date'), className: 'min-w-[110px] whitespace-nowrap', render: (row) => <span className="text-sm text-muted-foreground">{renderTaskDateTime(row)}</span> },
    { key: 'last_status_update_at', header: label('last_status_update_at', 'Last Update'), className: 'min-w-[110px] whitespace-nowrap', render: (row) => <span className="text-sm text-muted-foreground">{formatCompactDateTime(row.last_status_update_at || row.updated_at)}</span> },
    { key: 'next_reminder_at', header: 'Next Reminder', className: 'min-w-[108px] whitespace-nowrap', render: (row) => <span className="text-sm text-muted-foreground">{formatCompactDateTime(row.next_reminder_at || row.follow_up_date)}</span> },
    {
      key: 'due_date', header: 'Due Date', sortable: true, className: 'min-w-[88px] whitespace-nowrap',
      render: (row) => {
        if (!row.due_date) return <span className="text-muted-foreground">—</span>;
        if (row.status === 'completed' || row.status === 'cancelled') {
          return <span className="text-sm tabular-nums text-muted-foreground">{relativeDate(row.due_date).label.split(' ')[0]}</span>;
        }
        const rd = relativeDate(row.due_date);
        if (rd.urgency === 'today') {
          return <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-success/10 border border-success/25 text-success text-sm font-semibold tabular-nums animate-pulse">Today</span>;
        }
        if (rd.urgency === 'overdue') {
          return <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-destructive/10 border border-destructive/25 text-destructive text-sm font-semibold tabular-nums">{rd.label}</span>;
        }
        if (rd.urgency === 'soon') {
          return <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-warning/10 border border-warning/25 text-warning text-sm font-semibold tabular-nums">{rd.label}</span>;
        }
        return <span className={cn('text-sm tabular-nums', urgencyClass(rd.urgency))}>{rd.label}</span>;
      },
    },
    {
      key: 'actions', header: '', className: 'w-24 min-w-[88px]',
      render: (row) => (
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="View task" onClick={() => onRowClick(row)}>
            <Eye className="h-3.5 w-3.5" />
          </Button>
          {canManage && !row.is_deleted && row.status !== 'completed' && row.status !== 'cancelled' && (
            <>
              {onComplete && (
                <Button variant="ghost" size="icon" className="h-7 w-7 text-success hover:text-success hover:bg-success/10" aria-label="Mark complete" onClick={() => onComplete(row)}>
                  <CheckCircle2 className="h-3.5 w-3.5" />
                </Button>
              )}
              <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Edit task" onClick={() => onEdit(row)}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" aria-label="Delete task" onClick={() => setConfirmDelete(row)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
          {showDeleted && row.is_deleted && (
            <Button variant="ghost" size="icon" className="h-7 w-7 text-success" aria-label="Restore task" onClick={() => onRestore(row)}>
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  const visibleColumns = columns.filter((c) => !hiddenColumns.includes(c.key));

  return (
    <>
      <DataTable
        columns={visibleColumns}
        data={tasks}
        total={total}
        page={page}
        totalPages={totalPages}
        loading={loading}
        sortBy={sortBy}
        sortDir={sortDir}
        density="compact"
        onPageChange={onPageChange}
        onSort={onSort}
        onRowClick={onRowClick}
        emptyMessage="No tasks match your filters"
      />

      <ConfirmDialog
        open={!!confirmDelete}
        onOpenChange={(open) => !open && setConfirmDelete(null)}
        message={`Delete task "${confirmDelete?.title}"? This is a soft-delete and can be restored.`}
        onConfirm={() => { if (confirmDelete) { onDelete(confirmDelete); setConfirmDelete(null); } }}
      />
    </>
  );
}
