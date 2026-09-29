'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@/components/shared/PageHeader';
import { AvatarInitials } from '@/components/ui/avatar-initials';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { EmptyState } from '@/components/shared/EmptyState';
import { actionPhrase, timeAgo } from '@/components/dashboard/ActivityFeed';
import { PlusCircle, Pencil, CheckCircle2, Activity as ActivityIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import type { ApiResponse, PaginatedResponse } from '@/types';
import type { ActivityItem } from '@/app/api/activity/route';

type Tab = 'all' | 'created' | 'updated' | 'completed';

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'all', label: 'All Activity', icon: ActivityIcon },
  { id: 'created', label: 'Recently Created', icon: PlusCircle },
  { id: 'updated', label: 'Recently Updated', icon: Pencil },
  { id: 'completed', label: 'Recently Completed', icon: CheckCircle2 },
];

const DAY_OPTIONS = [
  { value: '1', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: 'all', label: 'All time' },
];

const LIMIT = 25;

function fmt(date: string): string {
  return new Date(date).toLocaleString();
}

function Pagination({
  page, totalPages, loading, onChange,
}: { page: number; totalPages: number; loading: boolean; onChange: (p: number) => void }) {
  return (
    <div className="flex items-center justify-end gap-2 pt-2">
      <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => onChange(Math.max(1, page - 1))}>
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <span className="text-xs text-muted-foreground tabular-nums">
        Page {page} / {Math.max(1, totalPages)}
      </span>
      <Button variant="outline" size="sm" disabled={page >= totalPages || loading} onClick={() => onChange(page + 1)}>
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

export default function ActivityPage() {
  const [tab, setTab] = useState<Tab>('all');
  const [days, setDays] = useState('7');
  const [page, setPage] = useState(1);

  const [items, setItems] = useState<ActivityItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    const params = new URLSearchParams();
    params.set('tab', tab);
    params.set('days', days);
    params.set('page', String(page));
    params.set('limit', String(LIMIT));

    setLoading(true);
    fetch(`/api/activity?${params}`)
      .then((r) => r.json())
      .then((res: ApiResponse<PaginatedResponse<ActivityItem>>) => {
        if (!res.success || !res.data) { setError(res.error || 'Failed to load activity'); return; }
        setError(null);
        setItems(res.data.items || []);
        setTotal(res.data.total || 0);
        setTotalPages(Math.max(1, res.data.totalPages || 1));
      })
      .catch(() => setError('Failed to load activity'))
      .finally(() => setLoading(false));
  }, [tab, days, page]);

  useEffect(() => { load(); }, [load]);

  function changeTab(next: Tab) {
    setTab(next);
    setPage(1);
  }

  function changeDays(next: string) {
    setDays(next);
    setPage(1);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Activity"
        subtitle="Full history of task creation, updates, and completions across your scope"
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1 rounded-xl glass-subtle p-1 w-fit overflow-x-auto">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => changeTab(t.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
                  active
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-card/60'
                }`}
              >
                <Icon className="h-4 w-4" />
                {t.label}
              </button>
            );
          })}
        </div>

        <Select value={days} onValueChange={changeDays}>
          <SelectTrigger className="w-full sm:w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {DAY_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <p className="text-xs text-muted-foreground">{total.toLocaleString()} records</p>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="rounded-2xl glass-card overflow-hidden">
        {loading && <LoadingSpinner className="py-12 mx-auto" />}

        {!loading && items.length === 0 && (
          <EmptyState
            icon={<ActivityIcon className="h-5 w-5 text-primary/60" />}
            heading="No activity found"
            description="Try a different tab or a wider date range."
            className="py-12"
          />
        )}

        {!loading && items.length > 0 && (
          <div className="divide-y divide-border">
            {items.map((item) => {
              const displayName = item.user_display_name || item.user_name;
              const phrase = actionPhrase(item.action, item.meta ?? {});
              return (
                <a
                  key={item.id}
                  href={`/tasks/${item.task_id}`}
                  className="flex items-start gap-3 px-5 py-3 hover:bg-accent/35 transition-colors duration-150 group"
                >
                  <AvatarInitials name={displayName} size="sm" className="mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground leading-snug">
                      <span className="font-medium">{displayName}</span>
                      {' '}
                      <span className="text-muted-foreground">{phrase}</span>
                      {' '}
                      <span className="font-medium group-hover:text-primary transition-colors">
                        &ldquo;{item.task_title}&rdquo;
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground/70 mt-0.5">{timeAgo(item.created_at)} · {fmt(item.created_at)}</p>
                  </div>
                </a>
              );
            })}
          </div>
        )}
      </div>

      <Pagination page={page} totalPages={totalPages} loading={loading} onChange={setPage} />
    </div>
  );
}
