'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { cn } from '@/lib/utils';
import {
  Layers, Timer, CheckCircle2, Clock, Flag, CalendarDays, CalendarRange, ArrowUpRight,
} from 'lucide-react';
import type { DashboardStats, ApiResponse } from '@/types';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const kpiConfig = [
  {
    key: 'total' as const,
    label: 'Total',
    href: '/tasks',
    icon: Layers,
    accentClass: 'text-foreground',
    iconClass: 'bg-primary-foreground/20 text-primary-foreground',
    filled: true,
  },
  {
    key: 'inProgress' as const,
    label: 'In Progress',
    href: '/tasks?status=in_progress',
    icon: Timer,
    accentClass: 'text-warning',
    iconClass: 'bg-warning/15 text-warning',
  },
  {
    key: 'completed' as const,
    label: 'Completed',
    href: '/tasks?status=completed',
    icon: CheckCircle2,
    accentClass: 'text-success',
    iconClass: 'bg-success/15 text-success',
  },
  {
    key: 'overdue' as const,
    label: 'Overdue',
    href: '/tasks?overdue=true&sortBy=due_date&sortDir=asc',
    icon: Clock,
    accentClass: 'text-destructive',
    iconClass: 'bg-destructive/15 text-destructive',
  },
  {
    key: 'highPriority' as const,
    label: 'High Priority',
    href: '/tasks?highPriority=true',
    icon: Flag,
    accentClass: 'text-warning',
    iconClass: 'bg-warning/15 text-warning',
  },
  {
    key: 'dueToday' as const,
    label: 'Due Today',
    href: '/tasks?dueToday=true',
    icon: CalendarDays,
    accentClass: 'text-foreground',
    iconClass: 'bg-muted text-foreground/70',
  },
  {
    key: 'upcoming7Days' as const,
    label: 'Next 7 Days',
    href: '/tasks?upcomingDays=7',
    icon: CalendarRange,
    accentClass: 'text-info',
    iconClass: 'bg-info/15 text-info',
  },
];

export function KpiCards() {
  const router = useRouter();
  const { data: statsData, isLoading: loading } = useSWR<ApiResponse<DashboardStats>>(
    '/api/dashboard/stats',
    fetcher,
    { revalidateOnFocus: false, refreshInterval: 60000 }
  );
  const stats = statsData?.data || null;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-3">
      {kpiConfig.map((kpi) => {
        const value = stats ? stats[kpi.key] : null;
        const Icon = kpi.icon;
        return (
          <button
            key={kpi.key}
            type="button"
            onClick={() => router.push(kpi.href)}
            className={cn(
              'group relative rounded-2xl p-4 text-left transition-all duration-200 hover:-translate-y-1',
              kpi.filled
                ? 'btn-gradient-primary text-primary-foreground hover:shadow-lg'
                : 'glass-card hover:shadow-md hover:bg-accent/40'
            )}
          >
            <span
              className={cn(
                'absolute top-3 right-3 flex h-6 w-6 items-center justify-center rounded-full border transition-transform duration-200 group-hover:rotate-45',
                kpi.filled ? 'border-white/30 text-white/80' : 'border-border text-muted-foreground'
              )}
              aria-hidden="true"
            >
              <ArrowUpRight className="h-3 w-3" strokeWidth={2.75} />
            </span>

            {/* Icon + label side by side */}
            <div className="flex items-center gap-2 mb-3">
              <div
                className={cn(
                  'h-[26px] w-[26px] rounded-[9px] flex items-center justify-center shrink-0 transition-transform duration-200 group-hover:scale-110',
                  kpi.iconClass
                )}
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={2.75} />
              </div>
              <span
                className={cn(
                  'block text-[10px] font-semibold uppercase tracking-[0.1em] leading-none whitespace-nowrap',
                  kpi.filled ? 'text-primary-foreground/75' : 'text-muted-foreground'
                )}
              >
                {kpi.label}
              </span>
            </div>

            {loading || value === null ? (
              <div className={cn('h-6 w-8 rounded-lg animate-pulse', kpi.filled ? 'bg-primary-foreground/20' : 'bg-muted')} />
            ) : (
              <span className={cn('text-2xl font-bold tabular-nums leading-none', kpi.filled ? 'text-primary-foreground' : kpi.accentClass)}>
                {value}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function useKpiStats() {
  const { data: statsData } = useSWR<ApiResponse<DashboardStats>>(
    '/api/dashboard/stats',
    fetcher,
    { revalidateOnFocus: false, refreshInterval: 60000 }
  );
  return statsData?.data || null;
}

export function useMyStats() {
  const { data: statsData } = useSWR<ApiResponse<DashboardStats>>(
    '/api/dashboard/stats?mine=true',
    fetcher,
    { revalidateOnFocus: false, refreshInterval: 60000 }
  );
  return statsData?.data || null;
}
