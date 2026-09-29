'use client';

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { formatDateTime } from '@/lib/utils';
import {
  PlusCircle, Edit, MessageCircle, Paperclip, CheckSquare, Trash2, RotateCcw, Activity, Mail,
} from 'lucide-react';
import type { TaskActivity, User } from '@/types';

const actionIcons: Record<string, React.ReactNode> = {
  created: <PlusCircle className="h-4 w-4 text-success" />,
  commented: <MessageCircle className="h-4 w-4 text-info" />,
  status_changed: <Edit className="h-4 w-4 text-primary" />,
  attachment_added: <Paperclip className="h-4 w-4 text-primary" />,
  subtask_added: <CheckSquare className="h-4 w-4 text-warning" />,
  soft_deleted: <Trash2 className="h-4 w-4 text-destructive" />,
  restored: <RotateCcw className="h-4 w-4 text-success" />,
  in_progress_mail_sent: <Mail className="h-4 w-4 text-info" />,
  overdue_mail_sent: <Mail className="h-4 w-4 text-destructive" />,
};

function getIcon(action: string) {
  if (action.startsWith('updated_')) return <Edit className="h-4 w-4 text-warning" />;
  return actionIcons[action] || <Activity className="h-4 w-4 text-muted-foreground" />;
}

const FIELD_LABELS: Record<string, string> = {
  title: 'Title',
  description: 'Description',
  activity_start_date: 'Start Date',
  activity_start_time: 'Start Time',
  assigned_to: 'Assigned To',
  assigned_to_ids: 'Assigned To',
  information_ids: 'Information Recipients',
  company_id: 'Company',
  dept_id: 'Department',
  status: 'Status',
  priority: 'Priority',
  last_follow_up_date: 'Last Follow-up Date',
  due_date: 'Due Date',
  due_time: 'Due Time',
  follow_up_date: 'Reminder Date',
  follow_up_time: 'Reminder Time',
  remarks_action_taken: 'Remarks / Action Taken',
};

const STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const PRIORITY_LABELS: Record<string, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};

function fmtDate(val: unknown): string {
  if (!val || val === 'null') return '—';
  const s = String(val).trim().split('T')[0];
  if (!s) return '—';
  const d = new Date(`${s}T00:00:00`);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtTime(val: unknown): string {
  if (!val || val === 'null') return '—';
  const s = String(val).trim();
  if (!s) return '—';
  const parts = s.split(':');
  if (parts.length < 2) return s;
  let h = parseInt(parts[0], 10);
  const m = (parts[1] ?? '00').padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
}

function fmtFieldValue(field: string, val: unknown): string {
  if (val === null || val === undefined || val === '' || val === 'null' || val === 'undefined') return '—';
  const s = String(val).trim();
  if (!s) return '—';
  if (field === 'status') return STATUS_LABELS[s] ?? s;
  if (field === 'priority') return PRIORITY_LABELS[s] ?? s;
  if (field === 'due_date' || field.endsWith('_date')) return fmtDate(val);
  if (field === 'due_time' || field.endsWith('_time')) return fmtTime(val);
  return s;
}

function normalizeIdList(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value
      .map((v) => Number(v))
      .filter((v) => Number.isInteger(v) && v > 0);
  }
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return [value];
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((v) => Number(v.trim()))
      .filter((v) => Number.isInteger(v) && v > 0);
  }
  return [];
}

function resolveNames(ids: number[], users: Array<Pick<User, 'id' | 'username' | 'display_name'>>): string {
  if (ids.length === 0) return '—';
  const map = new Map<number, string>(users.map((u) => [u.id, u.display_name || u.username]));
  return ids.map((id) => map.get(id) || `User #${id}`).join(', ');
}

function resolveActivityNames(
  ids: unknown,
  cachedNames: string[] | undefined,
  users: Array<Pick<User, 'id' | 'username' | 'display_name'>>
): string {
  if (cachedNames && cachedNames.length > 0) return cachedNames.join(', ');
  const idList = normalizeIdList(ids);
  if (idList.length === 0) return '—';
  return resolveNames(idList, users);
}

function formatAction(
  action: string,
  meta: Record<string, unknown> | null,
  assignedUsers: Array<Pick<User, 'id' | 'username' | 'display_name'>>
): string {
  if (action === 'created') return 'Created this task';
  if (action === 'commented') return 'Added a comment';
  if (action === 'attachment_added') return `Uploaded attachment: ${meta?.fileName ?? 'file'}`;
  if (action === 'subtask_added') return `Added subtask: "${meta?.title ?? ''}"`;
  if (action === 'soft_deleted') return 'Deleted this task';
  if (action === 'restored') return 'Restored this task';
  if (action === 'in_progress_mail_sent') return 'System sent "Task In Progress" notification email';
  if (action === 'overdue_mail_sent') return 'System sent overdue notification email';

  if (action === 'status_changed') {
    const to = String(meta?.to ?? '');
    const toLabel = STATUS_LABELS[to] ?? to;
    const via = meta?.via === 'comment' ? ' via comment' : '';
    if (to === 'completed') return `Marked task as Completed${via}`;
    if (to === 'in_progress') return `Started work on task${via}`;
    if (to === 'cancelled') return `Cancelled task${via}`;
    if (to === 'open') return `Reopened task${via}`;
    return `Changed Status to ${toLabel}${via}`;
  }

  if (action.startsWith('updated_')) {
    const field = action.replace('updated_', '');
    const label = FIELD_LABELS[field] ?? field.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

    if (field === 'description') {
      const hadBefore = meta?.from && meta.from !== 'null' && meta.from !== '';
      return hadBefore ? 'Updated description' : 'Added description';
    }

    if (field === 'remarks_action_taken') {
      const to = meta?.to;
      if (!to || to === 'null') return `Cleared ${label}`;
      return `Updated ${label}`;
    }

    if (field === 'assigned_to_ids' || field === 'assigned_to') {
      const fromStr = resolveActivityNames(
        meta?.from,
        meta?.fromNames as string[] | undefined,
        assignedUsers,
      );
      const toStr = resolveActivityNames(
        meta?.to,
        meta?.toNames as string[] | undefined,
        assignedUsers,
      );
      return `Updated ${label}: ${fromStr} → ${toStr}`;
    }

    if (field === 'information_ids') {
      const fromNames = meta?.fromNames as string[] | undefined;
      const toNames = meta?.toNames as string[] | undefined;
      const fromStr = fromNames?.length
        ? fromNames.join(', ')
        : (normalizeIdList(meta?.from).map((id) => `User #${id}`).join(', ') || 'None');
      const toStr = toNames?.length
        ? toNames.join(', ')
        : (normalizeIdList(meta?.to).map((id) => `User #${id}`).join(', ') || 'None');
      return `Updated ${label}: ${fromStr} → ${toStr}`;
    }

    if (field === 'company_id') {
      if (!meta?.from && meta?.to) return 'Set Company';
      if (meta?.from && !meta?.to) return 'Cleared Company';
      return 'Updated Company';
    }

    if (field === 'dept_id') {
      if (!meta?.from && meta?.to) return 'Set Department';
      if (meta?.from && !meta?.to) return 'Cleared Department';
      return 'Updated Department';
    }

    const fromVal = fmtFieldValue(field, meta?.from);
    const toVal = fmtFieldValue(field, meta?.to);

    if (fromVal !== '—' && toVal === '—') return `Cleared ${label} (was ${fromVal})`;
    if (fromVal === '—' && toVal !== '—') return `Set ${label} to ${toVal}`;
    return `Updated ${label}: ${fromVal} → ${toVal}`;
  }

  return action;
}

export function ActivityTab({
  taskId,
  activity,
  assignedUsers = [],
}: {
  taskId: number;
  activity: TaskActivity[];
  assignedUsers?: Array<Pick<User, 'id' | 'username' | 'display_name'>>;
}) {
  return (
    <Card className="mt-4">
      <CardContent className="p-6">
        <h3 className="flex items-center gap-2 font-semibold mb-3"><Activity className="h-4 w-4 text-primary" aria-hidden="true" />Activity ({activity.length})</h3>
        {activity.length === 0 && (
          <p className="text-muted-foreground text-sm text-center py-8">No activity yet</p>
        )}
        <div className="max-h-80 overflow-y-auto pr-1 space-y-4">
          {activity.map((a, idx) => (
            <div key={a.id} className="flex gap-3">
              <div className="flex flex-col items-center">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-card border border-border shadow-sm">
                  {getIcon(a.action)}
                </div>
                {idx < activity.length - 1 && <div className="w-px flex-1 bg-gradient-to-b from-border to-border/30" />}
              </div>
              <div className="pb-4">
                <p className="text-sm">
                  <span className="font-medium">{a.user_display_name || a.user_name || 'System'}</span>{' '}
                  <span className="text-muted-foreground">{formatAction(a.action, a.meta, assignedUsers)}</span>
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">{formatDateTime(a.created_at)}</p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
