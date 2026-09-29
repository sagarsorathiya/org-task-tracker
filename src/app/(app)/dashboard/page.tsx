'use client';

import React from 'react';
import { KpiCards, useKpiStats, useMyStats } from '@/components/dashboard/KpiCards';
import { UpcomingTable } from '@/components/dashboard/UpcomingTable';
import { OverdueTasksCard } from '@/components/dashboard/OverdueTasksCard';
import { ActivityFeed } from '@/components/dashboard/ActivityFeed';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Activity, AlertTriangle, BarChart2, CalendarDays, ClipboardList,
  ExternalLink, Plus, RefreshCw, Flag, CheckCircle2, AlertCircle,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { canViewInsights, cn } from '@/lib/utils';

type WorkloadRow = { assignee: string; open_tasks: number; high_priority_open: number };
type TrendsPayload = {
  completion: Array<{ day: string; completed: number }>;
  overdue: Array<{ day: string; overdue: number }>;
  avgClosureDays: number;
  currentOverdue: number;
};

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/* ------------------------------------------------------------------ */
/* Mini capsule-bar chart — rounded-pill bars, peak day solid-filled     */
/* ------------------------------------------------------------------ */
function MiniSparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return <div className="h-10 mt-2" />;
  const max = Math.max(...data, 1);
  const H = 36;
  return (
    <div className="mt-2 flex items-end gap-[3px] shrink-0" style={{ height: H }}>
      {data.map((v, i) => {
        const pct = Math.max(12, (v / max) * 100);
        const isPeak = v === max && v > 0;
        return (
          <div
            key={i}
            className={cn('w-1.5 rounded-full transition-all duration-300', !isPeak && 'capsule-bar-hatch')}
            style={{
              height: `${pct}%`,
              backgroundColor: isPeak ? color : undefined,
            }}
            title={String(v)}
          />
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Greeting banner with decorative illustration                         */
/* ------------------------------------------------------------------ */
function GreetingBanner() {
  const { data: session } = useSession();
  const stats = useMyStats();
  const name = session?.user?.displayName || session?.user?.username || 'there';
  const firstName = name.split(' ')[0];

  const dueToday = stats?.dueToday ?? 0;
  const overdue  = stats?.overdue  ?? 0;

  const parts: React.ReactNode[] = [];
  if (overdue > 0)  parts.push(<><span className="text-destructive font-semibold">{overdue} overdue</span></>);
  if (dueToday > 0) parts.push(<><span className="text-warning font-semibold">{dueToday} due today</span></>);

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <div className="rounded-2xl glass-card overflow-hidden relative min-h-[100px]">
      {/* Decorative illustration */}
      <div className="absolute right-0 top-0 bottom-0 w-1/2 pointer-events-none select-none overflow-hidden">
        <svg viewBox="0 0 420 160" fill="none" xmlns="http://www.w3.org/2000/svg"
          className="absolute inset-0 w-full h-full" preserveAspectRatio="xMaxYMid slice">
          {/* Orb — primary blue */}
          <circle cx="310" cy="52" r="56" className="fill-primary/15" />
          <circle cx="310" cy="52" r="42" className="fill-primary/25" />
          {/* Mountain layers back to front — info cyan */}
          <path d="M20 160 L110 55 L200 100 L300 22 L390 75 L420 58 L420 160 Z"
            className="fill-info/20" />
          <path d="M0 160 L90 95 L190 130 L275 65 L370 105 L420 88 L420 160 Z"
            className="fill-info/30" />
          <path d="M0 160 L80 135 L190 108 L270 148 L360 118 L420 138 L420 160 Z"
            className="fill-info/10" />
        </svg>
      </div>

      {/* Content */}
      <div className="relative z-10 flex items-center justify-between gap-4 px-5 py-4">
        <div>
          <h1 className="text-lg font-heading text-foreground">
            {getGreeting()}, {firstName}.
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {parts.length === 0
              ? 'All caught up — no urgent tasks right now.'
              : <>You have {parts.reduce<React.ReactNode[]>((acc, el, i) => i === 0 ? [el] : [...acc, ' and ', el], [])} requiring attention.</>
            }
          </p>
          <p className="mt-1.5 text-[11px] text-muted-foreground/60">{today}</p>
        </div>
        <Button onClick={() => window.location.href = '/tasks?create=true'} className="gap-2 shrink-0" size="sm">
          <Plus className="h-3.5 w-3.5" /> New Task
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Dashboard page                                                       */
/* ------------------------------------------------------------------ */
export default function DashboardPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const stats = useKpiStats();
  const [upcomingDays, setUpcomingDays] = React.useState('7');
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [workload, setWorkload] = React.useState<WorkloadRow[]>([]);
  const [trends, setTrends] = React.useState<TrendsPayload | null>(null);
  const [insightsLoadError, setInsightsLoadError] = React.useState(false);

  const isManagerView = canViewInsights(session?.user?.role, session?.user?.insightsAccess);

  React.useEffect(() => {
    if (!isManagerView) return;
    setInsightsLoadError(false);
    Promise.all([
      fetch('/api/workload').then((r) => r.json()),
      fetch('/api/analytics/trends?days=30').then((r) => r.json()),
    ])
      .then(([w, t]) => {
        if (w.success) setWorkload(w.data || []);
        if (t.success) setTrends(t.data || null);
      })
      .catch(() => { setInsightsLoadError(true); });
  }, [isManagerView]);

  const totalOpen    = workload.reduce((sum, row) => sum + Number(row.open_tasks        || 0), 0);
  const totalHigh    = workload.reduce((sum, row) => sum + Number(row.high_priority_open || 0), 0);
  const completed30d = trends?.completion?.reduce((sum, row) => sum + Number(row.completed || 0), 0) || 0;
  const overdue30d   = trends?.currentOverdue ?? 0;

  // Sparkline data
  const completionSpark = trends?.completion?.map((d) => Number(d.completed) || 0) ?? [];
  const overdueSpark    = trends?.overdue?.map((d) => Number(d.overdue) || 0) ?? [];
  // Derive open-tasks trend from cumulative completions (rough approximation)
  const openSpark = completionSpark.length > 1
    ? (() => {
        let cumulative = 0;
        const total = completionSpark.reduce((s, v) => s + v, 0);
        return completionSpark.map((v) => { cumulative += v; return Math.max(0, totalOpen + (total - cumulative)); });
      })()
    : [];

  const managerKpis = [
    {
      key: 'open-scope',
      label: 'Open Tasks (Scope)',
      value: totalOpen,
      valueClass: 'text-foreground',
      spark: openSpark,
      sparkColor: 'hsl(var(--primary))',
      icon: ClipboardList,
      iconClass: 'bg-primary/10 text-primary',
    },
    {
      key: 'high-priority',
      label: 'High Priority Open',
      value: totalHigh,
      valueClass: 'text-warning',
      spark: [] as number[],
      sparkColor: 'hsl(var(--warning))',
      icon: Flag,
      iconClass: 'bg-warning/15 text-warning',
    },
    {
      key: 'completed-30d',
      label: 'Completed (30d)',
      value: completed30d,
      valueClass: 'text-success',
      spark: completionSpark,
      sparkColor: 'hsl(var(--success))',
      icon: CheckCircle2,
      iconClass: 'bg-success/15 text-success',
    },
    {
      key: 'overdue-30d',
      label: 'Overdue (Live)',
      value: overdue30d,
      valueClass: 'text-destructive',
      spark: overdueSpark,
      sparkColor: 'hsl(var(--destructive))',
      icon: AlertCircle,
      iconClass: 'bg-destructive/15 text-destructive',
    },
  ] as const;

  const upcomingLabel = upcomingDays === '7' ? 'Next 7 days' : upcomingDays === '14' ? 'Next 14 days' : 'Next 30 days';

  return (
    <div className="space-y-5">
      <GreetingBanner />

      {stats !== null && stats.total === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl glass-card py-12 text-center">
          <ClipboardList className="h-8 w-8 text-muted-foreground/40" />
          <div>
            <p className="text-sm font-medium text-foreground">No tasks yet</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Assign or create a task to get started.</p>
          </div>
          <Button size="sm" className="gap-2 mt-1" onClick={() => window.location.href = '/tasks?create=true'}>
            <Plus className="h-3.5 w-3.5" /> New Task
          </Button>
        </div>
      ) : (
        <KpiCards />
      )}

      {/* Row 1 — Upcoming (2/3) + Overdue (1/3) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Upcoming Target Date */}
        <div className="lg:col-span-8 h-[340px] flex flex-col rounded-2xl glass-card overflow-hidden">
          <div className="shrink-0 flex items-center justify-between px-5 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-primary" />
              <p className="text-sm font-semibold text-foreground">Upcoming ({upcomingLabel})</p>
            </div>
            <div className="flex items-center gap-2">
              <Select value={upcomingDays} onValueChange={setUpcomingDays}>
                <SelectTrigger className="h-7 w-[130px] text-xs" id="dashboard-upcoming-days">
                  <SelectValue placeholder="Select window" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">Next 7 days</SelectItem>
                  <SelectItem value="14">Next 14 days</SelectItem>
                  <SelectItem value="30">Next 30 days</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="ghost" size="sm" onClick={() => setRefreshKey((v) => v + 1)} className="h-7 w-7 p-0">
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-2">
            <UpcomingTable days={Number(upcomingDays)} refreshKey={refreshKey} />
          </div>
          <div className="shrink-0 border-t border-border px-5 py-2">
            <button
              type="button"
              onClick={() => router.push('/tasks')}
              className="text-xs font-medium text-primary hover:underline flex items-center gap-1"
            >
              View all upcoming tasks <span aria-hidden>→</span>
            </button>
          </div>
        </div>

        {/* Overdue Tasks */}
        <div className="lg:col-span-4 h-[340px] flex flex-col rounded-2xl glass-card overflow-hidden">
          <div className="shrink-0 flex items-center justify-between px-5 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              <p className="text-sm font-semibold text-foreground">Overdue Tasks</p>
              {(stats?.overdue ?? 0) > 0 && (
                <span className="inline-flex items-center justify-center h-4 min-w-[1rem] px-1 rounded bg-destructive/15 text-destructive text-[10px] font-semibold tabular-nums">
                  {stats?.overdue}
                </span>
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={() => setRefreshKey((v) => v + 1)} className="h-7 w-7 p-0">
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-2">
            <OverdueTasksCard refreshKey={refreshKey} />
          </div>
          <div className="shrink-0 border-t border-border px-5 py-2">
            <button
              type="button"
              onClick={() => router.push('/tasks?overdue=true&sortBy=due_date&sortDir=asc')}
              className="text-xs font-medium text-destructive hover:underline flex items-center gap-1"
            >
              View all overdue tasks <span aria-hidden>→</span>
            </button>
          </div>
        </div>
      </div>

      {/* Row 2 — Management Insights (2/3) + Recent Activity (1/3) */}
      <div className={cn('grid gap-5', isManagerView ? 'grid-cols-1 lg:grid-cols-12' : 'grid-cols-1')}>
        {isManagerView && (
          <div className="lg:col-span-8 rounded-2xl glass-card overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <div className="flex items-center gap-2">
                <BarChart2 className="h-4 w-4 text-primary" />
                <p className="text-sm font-semibold text-foreground">Management Insights</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.push('/insights')}
                className="gap-1.5 h-7 text-xs"
              >
                Open Insights <ExternalLink className="h-3 w-3" />
              </Button>
            </div>
            {insightsLoadError ? (
              <div className="flex items-center justify-between gap-4 px-5 py-4">
                <p className="text-sm text-muted-foreground">Failed to load insights data.</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs shrink-0"
                  onClick={() => {
                    setInsightsLoadError(false);
                    Promise.all([
                      fetch('/api/workload').then((r) => r.json()),
                      fetch('/api/analytics/trends?days=30').then((r) => r.json()),
                    ])
                      .then(([w, t]) => {
                        if (w.success) setWorkload(w.data || []);
                        if (t.success) setTrends(t.data || null);
                      })
                      .catch(() => { setInsightsLoadError(true); });
                  }}
                >
                  <RefreshCw className="h-3 w-3 mr-1.5" /> Retry
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-y lg:divide-y-0 divide-border">
                {managerKpis.map((kpi) => {
                  const Icon = kpi.icon;
                  return (
                    <div key={kpi.key} className="flex items-start gap-3 px-5 py-4">
                      <div className={cn('h-9 w-9 rounded-xl flex items-center justify-center shrink-0', kpi.iconClass)}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                          {kpi.label}
                        </p>
                        <p className={cn('text-3xl font-bold tabular-nums leading-none mt-2', kpi.valueClass)}>
                          {kpi.value}
                        </p>
                        {kpi.spark.length >= 2 && (
                          <MiniSparkline data={kpi.spark as number[]} color={kpi.sparkColor} />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Recent Activity */}
        <div className={cn(
          'rounded-2xl glass-card overflow-hidden flex flex-col',
          isManagerView ? 'lg:col-span-4' : ''
        )}>
          <div className="shrink-0 flex items-center justify-between px-5 py-3 border-b border-border">
            <Link href="/activity" className="flex items-center gap-2 group">
              <Activity className="h-4 w-4 text-primary" />
              <p className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">Recent Activity</p>
            </Link>
            <Button variant="ghost" size="sm" onClick={() => setRefreshKey((v) => v + 1)} className="h-7 w-7 p-0">
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="flex-1 px-4 py-3 max-h-[260px] overflow-y-auto">
            <ActivityFeed refreshKey={refreshKey} />
          </div>
          <div className="shrink-0 border-t border-border px-5 py-2">
            <button
              type="button"
              onClick={() => router.push('/activity')}
              className="text-xs font-medium text-primary hover:underline flex items-center gap-1"
            >
              View all activity <span aria-hidden>→</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
