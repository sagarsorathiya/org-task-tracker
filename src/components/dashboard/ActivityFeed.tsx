'use client';

import React from 'react';
import useSWR from 'swr';
import { AvatarInitials } from '@/components/ui/avatar-initials';
import { truncate } from '@/lib/utils';
import type { ActivityItem } from '@/app/api/dashboard/activity/route';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const FIELD_PHRASE_LABELS: Record<string, string> = {
  activity_start_date: 'the start date',
  activity_start_time: 'the start time',
  due_time: 'the due time',
  follow_up_time: 'the reminder time',
  last_follow_up_date: 'the last follow-up date',
  company_id: 'the company',
  dept_id: 'the department',
  information_ids: 'information recipients',
};

function hasValue(v: unknown): boolean {
  return v !== null && v !== undefined && v !== '' && v !== 'null';
}

export function actionPhrase(action: string, meta: Record<string, unknown>): string {
  if (action === 'created') return 'created';
  if (action === 'soft_deleted') return 'deleted';
  if (action === 'restored') return 'restored';
  if (action === 'comment' || action === 'commented') return 'commented on';
  if (action === 'assigned') return 'was assigned to';

  if (action === 'attachment_added') {
    const fileName = meta?.fileName ? String(meta.fileName) : 'a file';
    return `uploaded attachment "${fileName}" to`;
  }
  if (action === 'subtask_added') {
    const title = meta?.title ? String(meta.title) : 'a subtask';
    return `added subtask "${title}" to`;
  }

  if (action === 'status_changed' || action === 'updated_status') {
    const to = String(meta?.to ?? '');
    if (to === 'completed') return 'completed';
    if (to === 'in_progress') return 'started work on';
    if (to === 'cancelled') return 'cancelled';
    return 'updated status of';
  }

  if (action === 'updated_assigned_to_ids' || action === 'updated_assigned_to') return 'updated assignees on';
  if (action === 'updated_information_ids') return 'updated information recipients on';
  if (action === 'updated_priority') return 'updated priority on';
  if (action === 'updated_title') return 'renamed';

  if (action === 'updated_due_date') return 'updated due date on';

  if (action === 'updated_follow_up_date') {
    if (!hasValue(meta?.from) && hasValue(meta?.to)) return 'set a reminder on';
    if (hasValue(meta?.from) && !hasValue(meta?.to)) return 'cleared the reminder on';
    return 'updated the reminder date on';
  }

  if (action === 'updated_description') {
    return hasValue(meta?.from) ? 'updated the description on' : 'added a description to';
  }

  if (action === 'updated_remarks_action_taken') {
    return hasValue(meta?.to) ? 'updated remarks on' : 'cleared remarks on';
  }

  if (action.startsWith('updated_')) {
    const field = action.replace('updated_', '');
    const label = FIELD_PHRASE_LABELS[field] ?? field.replace(/_/g, ' ');
    return `updated ${label} on`;
  }

  return 'updated';
}

interface Props {
  refreshKey?: number;
}

export function ActivityFeed({ refreshKey }: Props) {
  const { data, isLoading } = useSWR<{ success: boolean; data: ActivityItem[] }>(
    `/api/dashboard/activity?_k=${refreshKey ?? 0}`,
    fetcher,
    { revalidateOnFocus: false, refreshInterval: 120000 },
  );

  const items = data?.data ?? [];

  if (isLoading) {
    return (
      <div className="space-y-3 px-1">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-start gap-2.5 animate-pulse">
            <div className="h-5 w-5 rounded-full bg-muted shrink-0 mt-0.5" />
            <div className="flex-1 space-y-1">
              <div className="h-3 bg-muted rounded w-4/5" />
              <div className="h-2.5 bg-muted rounded w-1/3" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <p className="text-xs text-muted-foreground">No recent activity</p>
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      {items.map((item) => {
        const displayName = item.user_display_name || item.user_name;
        const phrase = actionPhrase(item.action, item.meta ?? {});
        return (
          <a
            key={item.id}
            href={`/tasks/${item.task_id}`}
            className="flex items-start gap-2.5 py-2 px-2 -mx-2 rounded-lg hover:bg-accent/35 transition-colors duration-150 group"
          >
            <AvatarInitials name={displayName} size="xs" className="mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-foreground leading-snug">
                <span className="font-medium">{displayName}</span>
                {' '}
                <span className="text-muted-foreground">{phrase}</span>
                {' '}
                <span className="font-medium group-hover:text-primary transition-colors">
                  &ldquo;{truncate(item.task_title, 36)}&rdquo;
                </span>
              </p>
              <p className="text-[10px] text-muted-foreground/60 mt-0.5">{timeAgo(item.created_at)}</p>
            </div>
          </a>
        );
      })}
    </div>
  );
}
