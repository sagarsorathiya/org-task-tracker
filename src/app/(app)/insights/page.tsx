'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AvatarInitials } from '@/components/ui/avatar-initials';
import { relativeDate, urgencyClass } from '@/lib/relative-date';
import {
  RefreshCw, TrendingUp, TrendingDown, Flame, Building2, Users, CalendarDays, CheckCircle2,
  ArrowRight, ClipboardList, Clock, AlertCircle,
} from 'lucide-react';
import { canViewInsights, cn } from '@/lib/utils';

type WorkloadRow = { assignee: string; open_tasks: number; high_priority_open: number };
type CalendarItem = {
  id: number; title: string; status: string; priority: string;
  assigned_to_name: string | null; due_date: string | null; follow_up_date: string | null;
};
type Trends = {
  completion: Array<{ day: string; completed: number }>;
  overdue: Array<{ day: string; overdue: number }>;
  byDepartment: Array<{ dept_name: string; total: number; completed: number }>;
  avgClosureDays: number;
  currentOverdue: number;
};
type KanbanBoard = Record<string, Array<{ id: number }>>;
type FilterCompany = { id: number; name: string; code: string };
type FilterDepartment = { id: number; name: string };
type DeptCompanyMap = { dept_id: number; company_id: number };

const PRIORITY_DOT: Record<string, string> = {
  critical: 'bg-destructive', high: 'bg-destructive', medium: 'bg-warning', low: 'bg-border',
};

function statusBadgeVariant(s: string): 'success' | 'warning' | 'secondary' | 'destructive' {
  if (s === 'completed') return 'success';
  if (s === 'in_progress') return 'warning';
  if (s === 'cancelled') return 'destructive';
  return 'secondary';
}

function TrendChart({ data, strokeColor }: {
  data: Array<{ day: string; value: number }>;
  strokeColor: string;
}) {
  const fmtDay = (day: string) => {
    const d = new Date(day + 'T00:00:00');
    return `${d.getDate()} ${d.toLocaleString('en', { month: 'short' })}`;
  };

  if (!data.length || data.every((v) => v.value === 0)) {
    return (
      <div className="flex flex-col h-20 items-center justify-center gap-1.5">
        <CheckCircle2 className="h-5 w-5 text-success opacity-50" />
        <span className="text-xs text-muted-foreground">No events in this period</span>
      </div>
    );
  }

  const max = Math.max(...data.map((d) => d.value), 1);
  const n = data.length;
  const labelSet = new Set<number>([0, Math.round((n - 1) / 2), n - 1]);

  return (
    <div>
      <div className="flex justify-between items-center mb-2 px-0.5">
        <span className="text-[10px] text-muted-foreground">Daily count</span>
        <span className="text-[10px] tabular-nums font-semibold" style={{ color: strokeColor }}>peak {max}</span>
      </div>
      <div className="flex items-end gap-[3px]" style={{ height: 72 }}>
        {data.map((d, i) => {
          const pct = (d.value / max) * 100;
          const isPeak = d.value === max && d.value > 0;
          return (
            <div
              key={i}
              className={cn('flex-1 rounded-full transition-all duration-300 cursor-default', !isPeak && 'capsule-bar-hatch')}
              style={{
                height: d.value > 0 ? `max(6px, ${pct}%)` : '4px',
                backgroundColor: isPeak ? strokeColor : undefined,
                opacity: isPeak ? 1 : d.value > 0 ? 0.5 : 0.3,
              }}
              title={`${fmtDay(d.day)}: ${d.value}`}
            />
          );
        })}
      </div>
      <div className="h-px bg-border mt-1 mb-1.5" />
      <div className="flex">
        {data.map((d, i) => (
          <div key={i} className="flex-1 text-center">
            {labelSet.has(i) && (
              <span className="text-[10px] text-muted-foreground tabular-nums whitespace-nowrap">
                {fmtDay(d.day)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Sk({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded bg-muted', className)} />;
}

export default function InsightsPage() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();

  const [workload, setWorkload] = useState<WorkloadRow[]>([]);
  const [calendar, setCalendar] = useState<CalendarItem[]>([]);
  const [kanban, setKanban]     = useState<KanbanBoard>({});
  const [trends, setTrends]     = useState<Trends | null>(null);
  const [companies, setCompanies]           = useState<FilterCompany[]>([]);
  const [departments, setDepartments]       = useState<FilterDepartment[]>([]);
  const [deptCompanyMap, setDeptCompanyMap] = useState<DeptCompanyMap[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>('all');
  const [selectedDeptId, setSelectedDeptId]       = useState<string>('all');
  const [trendDays, setTrendDays] = useState<'7' | '30' | '90'>('30');
  const [loadingInsights, setLoadingInsights] = useState(true);
  const [filtersReady, setFiltersReady]       = useState(false);
  const [filtersError, setFiltersError]       = useState<string | null>(null);
  const [insightsError, setInsightsError]     = useState<string | null>(null);

  useEffect(() => {
    if (authStatus !== 'authenticated') return;
    if (!canViewInsights(session?.user?.role, session?.user?.insightsAccess)) router.replace('/dashboard');
  }, [authStatus, session?.user?.role, session?.user?.insightsAccess, router]);

  const hasAccess = canViewInsights(session?.user?.role, session?.user?.insightsAccess);

  useEffect(() => {
    fetch('/api/insights/filters')
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          setCompanies(data.data?.companies || []);
          setDepartments(data.data?.departments || []);
          setDeptCompanyMap(data.data?.deptCompanyMap || []);
          setFiltersError(null);
        } else { setFiltersError(data.error || 'Failed to load filters'); }
      })
      .catch(() => setFiltersError('Failed to load filters'))
      .finally(() => setFiltersReady(true));
  }, []);

  useEffect(() => {
    if (selectedCompanyId === 'all' || selectedDeptId === 'all') return;
    const mapped = deptCompanyMap.some(
      (m) => String(m.company_id) === selectedCompanyId && String(m.dept_id) === selectedDeptId
    );
    if (!mapped) setSelectedDeptId('all');
  }, [selectedCompanyId, deptCompanyMap, selectedDeptId]);

  const allowedDepartments = useMemo(() => {
    if (selectedCompanyId === 'all') return departments;
    const ids = new Set(deptCompanyMap.filter((m) => String(m.company_id) === selectedCompanyId).map((m) => String(m.dept_id)));
    return departments.filter((d) => ids.has(String(d.id)));
  }, [departments, deptCompanyMap, selectedCompanyId]);

  const loadInsights = useCallback(() => {
    const params = new URLSearchParams();
    if (selectedCompanyId !== 'all') params.set('companyId', selectedCompanyId);
    if (selectedDeptId !== 'all') params.set('deptId', selectedDeptId);
    const qs = params.toString();
    const scope = qs ? `?${qs}` : '';
    const scopeAmp = qs ? `&${qs}` : '';
    setLoadingInsights(true); setInsightsError(null);
    Promise.all([
      fetch(`/api/workload${scope}`).then((r) => r.json()),
      fetch(`/api/views/calendar${scope}`).then((r) => r.json()),
      fetch(`/api/views/kanban${scope}`).then((r) => r.json()),
      fetch(`/api/analytics/trends?days=${trendDays}${scopeAmp}`).then((r) => r.json()),
    ]).then(([w, c, k, t]) => {
      if (w.success) setWorkload(w.data || []);
      if (c.success) setCalendar(c.data || []);
      if (k.success) setKanban(k.data || {});
      if (t.success) setTrends(t.data || null);
      const fail = [w, c, k, t].find((r) => !r?.success);
      if (fail) setInsightsError(fail.error || 'Some data failed to load');
    }).catch(() => setInsightsError('Failed to load insights'))
      .finally(() => setLoadingInsights(false));
  }, [selectedCompanyId, selectedDeptId, trendDays]);

  useEffect(() => { if (filtersReady) loadInsights(); }, [filtersReady, loadInsights]);

  // ── Derived values — all before conditional return to satisfy hooks rules ──
  const totalTasks      = Object.values(kanban).reduce((s, arr) => s + arr.length, 0);
  const completedCount  = (kanban.completed || []).length;
  const openCount       = (kanban.open || []).length;
  const inProgressCount = (kanban.in_progress || []).length;
  const cancelledCount  = (kanban.cancelled || []).length;
  const completionRate  = totalTasks > 0 ? Math.round((completedCount / totalTasks) * 100) : 0;
  const maxWorkload     = Math.max(...workload.map((w) => w.open_tasks), 1);
  const overdueCount    = trends?.currentOverdue ?? 0;
  const overdueTrendSum = trends?.overdue?.reduce((s, r) => s + Number(r.overdue || 0), 0) || 0;
  const completionSum   = trends?.completion?.reduce((s, r) => s + Number(r.completed || 0), 0) || 0;
  const avgClosureDays  = trends?.avgClosureDays ?? null;

  const completionData = useMemo(
    () => trends?.completion?.map((r) => ({ day: r.day, value: Number(r.completed || 0) })) || [],
    [trends],
  );
  const overdueData = useMemo(
    () => trends?.overdue?.map((r) => ({ day: r.day, value: Number(r.overdue || 0) })) || [],
    [trends],
  );

  const sortedCalendar = useMemo(() => [...calendar].sort((a, b) => {
    if (!a.due_date && !b.due_date) return 0;
    if (!a.due_date) return 1; if (!b.due_date) return -1;
    return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
  }), [calendar]);

  // Group Task Schedule by urgency
  const groupedCalendar = useMemo(() => {
    const overdue: CalendarItem[] = [];
    const today:   CalendarItem[] = [];
    const soon:    CalendarItem[] = [];
    const normal:  CalendarItem[] = [];
    const done:    CalendarItem[] = [];
    for (const item of sortedCalendar) {
      if (item.status === 'completed' || item.status === 'cancelled') { done.push(item); continue; }
      if (!item.due_date) { normal.push(item); continue; }
      const { urgency } = relativeDate(item.due_date);
      if (urgency === 'overdue') overdue.push(item);
      else if (urgency === 'today') today.push(item);
      else if (urgency === 'soon')  soon.push(item);
      else                          normal.push(item);
    }
    return { overdue, today, soon, normal, done };
  }, [sortedCalendar]);

  if (authStatus === 'authenticated' && !hasAccess) return null;

  // Status breakdown segments for stacked bar
  const statusSegments = [
    { key: 'open',        label: 'Open',        count: openCount,        barColor: 'bg-info',        textColor: 'text-info'        },
    { key: 'in_progress', label: 'In Progress',  count: inProgressCount,  barColor: 'bg-warning',     textColor: 'text-warning'     },
    { key: 'completed',   label: 'Completed',    count: completedCount,   barColor: 'bg-success',     textColor: 'text-success'     },
    { key: 'cancelled',   label: 'Cancelled',    count: cancelledCount,   barColor: 'bg-muted-foreground', textColor: 'text-muted-foreground' },
  ];

  const scheduleGroups = [
    { key: 'overdue', label: 'Overdue',               labelColor: 'text-destructive',       items: groupedCalendar.overdue },
    { key: 'today',   label: 'Due Today',              labelColor: 'text-success',            items: groupedCalendar.today  },
    { key: 'soon',    label: 'Due Soon',               labelColor: 'text-warning',             items: groupedCalendar.soon   },
    { key: 'normal',  label: 'Upcoming',               labelColor: 'text-muted-foreground',   items: groupedCalendar.normal },
    { key: 'done',    label: 'Completed / Cancelled',  labelColor: 'text-muted-foreground',   items: groupedCalendar.done   },
  ];

  return (
    <div className="space-y-5">

      {/* ── Page header with inline filters ── */}
      <div className="flex flex-wrap items-center gap-3 pb-4 border-b border-border">
        <div className="flex-1 min-w-0 flex items-start gap-3">
          <span className="mt-1 h-6 w-1 rounded-full bg-primary shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight">Insights</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Live workload, trends and board overview</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Select value={selectedCompanyId} onValueChange={setSelectedCompanyId}>
            <SelectTrigger className="h-8 text-xs w-[160px]"><SelectValue placeholder="All Companies" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Companies</SelectItem>
              {companies.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.code} – {c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={selectedDeptId} onValueChange={setSelectedDeptId}>
            <SelectTrigger className="h-8 text-xs w-[160px]"><SelectValue placeholder="All Departments" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Departments</SelectItem>
              {allowedDepartments.map((d) => <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={trendDays} onValueChange={(v) => setTrendDays(v as '7' | '30' | '90')}>
            <SelectTrigger className="h-8 text-xs w-[100px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7d</SelectItem>
              <SelectItem value="30">Last 30d</SelectItem>
              <SelectItem value="90">Last 90d</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={loadInsights} disabled={loadingInsights}>
            <RefreshCw className={cn('h-3.5 w-3.5', loadingInsights && 'animate-spin')} />
          </Button>
        </div>
      </div>

      {(filtersError || insightsError) && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive flex items-center justify-between gap-4">
          <span>{filtersError || insightsError}</span>
          {insightsError && (
            <Button variant="outline" size="sm" className="h-7 text-xs shrink-0" onClick={loadInsights} disabled={loadingInsights}>
              Try again
            </Button>
          )}
        </div>
      )}

      {/* ── 4 Hero KPIs ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: 'Total Tasks',
            value: loadingInsights ? null : totalTasks,
            sub: loadingInsights ? '' : `${openCount} open · ${inProgressCount} in progress`,
            color: 'text-foreground',
            icon: ClipboardList,
            iconClass: 'bg-primary/10 text-primary',
          },
          {
            label: 'Completion Rate',
            value: loadingInsights ? null : `${completionRate}%`,
            sub: loadingInsights ? '' : `${completedCount} of ${totalTasks} tasks done`,
            color: 'text-success',
            icon: CheckCircle2,
            iconClass: 'bg-success/10 text-success',
          },
          {
            label: 'Avg Closure Time',
            value: loadingInsights ? null : (avgClosureDays != null ? `${avgClosureDays}d` : '—'),
            sub: 'Average days to complete a task',
            color: 'text-info',
            icon: Clock,
            iconClass: 'bg-info/10 text-info',
          },
          {
            label: 'Overdue',
            value: loadingInsights ? null : overdueCount,
            sub: 'Currently past due date',
            color: overdueCount > 0 ? 'text-destructive' : 'text-muted-foreground',
            icon: AlertCircle,
            iconClass: overdueCount > 0 ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground',
          },
        ].map(({ label, value, sub, color, icon: Icon, iconClass }) => (
          <div key={label} className="rounded-2xl glass-card px-5 py-4 flex items-start gap-4">
            <div className={cn('h-11 w-11 rounded-xl flex items-center justify-center shrink-0', iconClass)}>
              <Icon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground mb-1.5">{label}</p>
              {value === null
                ? <Sk className="h-8 w-16 mb-1" />
                : <p className={cn('text-3xl font-bold tabular-nums leading-none mb-1', color)}>{value}</p>
              }
              <p className="text-[11px] text-muted-foreground leading-snug">{sub}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── Status Distribution — single stacked bar + legend ── */}
      <div className="rounded-2xl glass-card px-5 py-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground mb-3">Status Breakdown</p>
        {loadingInsights ? (
          <div className="space-y-4">
            <Sk className="h-2.5 w-full rounded-full" />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((_, i) => <Sk key={i} className="h-10" />)}
            </div>
          </div>
        ) : totalTasks === 0 ? (
          <p className="text-sm text-muted-foreground py-2">No tasks found in this scope.</p>
        ) : (
          <>
            {/* Stacked proportional bar */}
            <div className="flex rounded-full overflow-hidden h-2.5 gap-px mb-5">
              {statusSegments.map((seg) => {
                const pct = (seg.count / totalTasks) * 100;
                return pct > 0 ? (
                  <div
                    key={seg.key}
                    className={cn('h-full transition-all duration-500', seg.barColor)}
                    style={{ width: `${pct}%` }}
                    title={`${seg.label}: ${seg.count} (${Math.round(pct)}%)`}
                  />
                ) : null;
              })}
            </div>
            {/* Legend — count + label + % */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-4">
              {statusSegments.map((seg) => {
                const pct = totalTasks > 0 ? Math.round((seg.count / totalTasks) * 100) : 0;
                return (
                  <div key={seg.key} className="flex items-center gap-2.5">
                    <span className={cn('h-2.5 w-2.5 rounded-full shrink-0', seg.barColor)} />
                    <div className="min-w-0">
                      <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide leading-none mb-1">{seg.label}</p>
                      <p className={cn('text-xl font-bold tabular-nums leading-none', seg.textColor)}>
                        {seg.count}
                        <span className="text-xs font-normal text-muted-foreground ml-1.5">{pct}%</span>
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* ── Team Workload + By Department ── */}
      <div className="grid gap-5 lg:grid-cols-2">

        <div className="rounded-2xl glass-card overflow-hidden flex flex-col h-[360px]">
          <div className="flex items-center gap-2 px-5 py-3 border-b border-border shrink-0">
            <Users className="h-3.5 w-3.5 text-muted-foreground" />
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Team Workload</p>
            {!loadingInsights && workload.length > 0 && (
              <span className="ml-auto text-[10px] text-muted-foreground">{workload.length} members</span>
            )}
          </div>
          <div className="px-5 py-4 space-y-3 flex-1 overflow-y-auto">
            {loadingInsights ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="space-y-1.5">
                  <div className="flex justify-between"><Sk className="h-3 w-28" /><Sk className="h-3 w-8" /></div>
                  <Sk className="h-1.5 w-full" />
                </div>
              ))
            ) : workload.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No workload data</p>
            ) : (
              workload.map((w) => {
                const pct = Math.round((w.open_tasks / maxWorkload) * 100);
                return (
                  <div key={w.assignee}>
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <AvatarInitials name={w.assignee} size="xs" />
                        <span className="text-sm truncate max-w-[140px]">{w.assignee}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {w.high_priority_open > 0 && (
                          <span className="flex items-center gap-0.5 text-xs text-destructive">
                            <Flame className="h-3 w-3" />{w.high_priority_open}
                          </span>
                        )}
                        <span className="text-xs font-semibold tabular-nums text-muted-foreground">{w.open_tasks}</span>
                      </div>
                    </div>
                    <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="rounded-2xl glass-card overflow-hidden flex flex-col h-[360px]">
          <div className="flex items-center gap-2 px-5 py-3 border-b border-border shrink-0">
            <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">By Department</p>
            {!loadingInsights && (trends?.byDepartment?.length ?? 0) > 0 && (
              <span className="ml-auto text-[10px] text-muted-foreground">{trends!.byDepartment.length} depts</span>
            )}
          </div>
          <div className="px-5 py-4 space-y-3 flex-1 overflow-y-auto">
            {loadingInsights ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="space-y-1.5">
                  <div className="flex justify-between"><Sk className="h-3 w-32" /><Sk className="h-3 w-14" /></div>
                  <Sk className="h-1.5 w-full" />
                </div>
              ))
            ) : !trends?.byDepartment?.length ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No department data</p>
            ) : (
              trends.byDepartment.map((d) => {
                const rate = d.total > 0 ? Math.round((d.completed / d.total) * 100) : 0;
                return (
                  <div key={d.dept_name}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm truncate max-w-[180px]">{d.dept_name}</span>
                      <span className="text-xs tabular-nums text-muted-foreground shrink-0 ml-2">
                        {d.completed}/{d.total} · <span className="text-success">{rate}%</span>
                      </span>
                    </div>
                    <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full bg-success transition-all duration-500" style={{ width: `${rate}%` }} />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

      </div>

      {/* ── Trend Charts ── */}
      <div className="grid gap-5 lg:grid-cols-2">
        {[
          { title: 'Completions',    sub: `${completionSum} completed over ${trendDays}d`, data: completionData, color: 'hsl(var(--success))', icon: TrendingUp,   iconColor: 'text-success' },
          { title: 'Overdue Events', sub: `${overdueTrendSum} events over ${trendDays}d`,    data: overdueData,    color: 'hsl(var(--destructive))', icon: TrendingDown, iconColor: 'text-destructive' },
        ].map(({ title, sub, data, color, icon: Icon, iconColor }) => (
          <div key={title} className="rounded-2xl glass-card overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <div className="flex items-center gap-2">
                <Icon className={cn('h-3.5 w-3.5', iconColor)} />
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{title}</p>
              </div>
              {!loadingInsights && <span className="text-xs text-muted-foreground">{sub}</span>}
            </div>
            <div className="px-5 pt-3 pb-4">
              {loadingInsights ? <Sk className="h-[108px] w-full" /> : <TrendChart data={data} strokeColor={color} />}
            </div>
          </div>
        ))}
      </div>

      {/* ── Task Schedule — grouped by urgency ── */}
      <div className="rounded-2xl glass-card overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Task Schedule</p>
          </div>
          {!loadingInsights && (
            <div className="flex items-center gap-3">
              {groupedCalendar.overdue.length > 0 && (
                <span className="text-[10px] font-semibold text-destructive tabular-nums">
                  {groupedCalendar.overdue.length} overdue
                </span>
              )}
              <span className="text-xs text-muted-foreground">{sortedCalendar.length} tasks</span>
            </div>
          )}
        </div>
        <div className="px-5 py-2 flex-1">
          {loadingInsights ? (
            <div className="space-y-3 py-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between py-1.5">
                  <div className="flex items-center gap-2 flex-1">
                    <Sk className="h-4 w-4 rounded-lg" /><Sk className="h-3.5 w-48" />
                  </div>
                  <Sk className="h-5 w-20" />
                </div>
              ))}
            </div>
          ) : sortedCalendar.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No tasks found in this scope.</p>
          ) : (
            <div className="max-h-[420px] overflow-y-auto pr-1">
              {scheduleGroups.map(({ key, label, labelColor, items }) =>
                items.length === 0 ? null : (
                  <div key={key}>
                    {/* Sticky group header */}
                    <p className={cn(
                      'text-[10px] font-semibold uppercase tracking-[0.1em] mt-3 mb-0.5 sticky top-0 py-1 bg-card',
                      labelColor,
                    )}>
                      {label}
                      <span className="ml-1.5 opacity-50 font-normal normal-case tracking-normal">({items.length})</span>
                    </p>
                    <div className="divide-y divide-white/15 dark:divide-white/[0.05]">
                      {items.map((item) => {
                        const rd = item.due_date ? relativeDate(item.due_date) : null;
                        return (
                          <div key={item.id} className="flex items-center gap-3 py-2">
                            <span className={cn('h-2 w-2 rounded-full shrink-0', PRIORITY_DOT[item.priority] || 'bg-muted-foreground')} />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{item.title}</p>
                              <p className="text-xs text-muted-foreground truncate">{item.assigned_to_name || 'Unassigned'}</p>
                            </div>
                            <Badge variant={statusBadgeVariant(item.status)} className="shrink-0 text-[10px]">
                              {item.status.replace('_', ' ')}
                            </Badge>
                            {rd && item.status !== 'completed' && item.status !== 'cancelled' && (
                              <span className={cn('text-xs tabular-nums shrink-0 min-w-[52px] text-right', urgencyClass(rd.urgency))}>
                                {rd.label}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )
              )}
            </div>
          )}
        </div>
          <div className="shrink-0 border-t border-border px-5 py-2">
            <a href="/tasks" className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">
              View all tasks <ArrowRight className="h-3 w-3" />
            </a>
          </div>
      </div>

    </div>
  );
}
