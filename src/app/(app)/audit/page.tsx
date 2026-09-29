'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/shared/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { ShieldCheck, Activity, Mail, ChevronLeft, ChevronRight, RotateCcw, CheckCircle2, XCircle, Clock, AlertCircle } from 'lucide-react';
import type { ApiResponse, PaginatedResponse } from '@/types';
import type { LoginLogRow } from '@/app/api/audit/login-logs/route';
import type { ActivityLogRow } from '@/app/api/audit/activity-logs/route';
import type { MailLogRow } from '@/app/api/audit/mail-logs/route';

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmt(date: string | null | undefined) {
  if (!date) return '—';
  return new Date(date).toLocaleString();
}

function actionBadgeVariant(action: string): 'success' | 'destructive' | 'secondary' | 'warning' {
  if (action.startsWith('login_success')) return 'success';
  if (action.startsWith('login_failed') || action.startsWith('login_rate')) return 'destructive';
  if (action === 'logout') return 'secondary';
  return 'secondary';
}

function statusBadge(status: string) {
  switch (status) {
    case 'sent':
      return <Badge variant="success" className="gap-1"><CheckCircle2 className="h-3 w-3" />Sent</Badge>;
    case 'pending':
      return <Badge variant="secondary" className="gap-1"><Clock className="h-3 w-3" />Pending</Badge>;
    case 'failed':
      return <Badge variant="warning" className="gap-1"><AlertCircle className="h-3 w-3" />Failed</Badge>;
    case 'dead':
      return <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" />Dead</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
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

// ─── Login Logs tab ────────────────────────────────────────────────────────────

function LoginLogsTab() {
  const [rows, setRows] = useState<LoginLogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const [actor, setActor] = useState('');
  const [action, setAction] = useState('');
  const [clientIp, setClientIp] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = useCallback(() => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('limit', '25');
    if (actor.trim()) params.set('actor', actor.trim());
    if (action.trim()) params.set('action', action.trim());
    if (clientIp.trim()) params.set('clientIp', clientIp.trim());
    if (from) params.set('from', from);
    if (to) params.set('to', to);

    setLoading(true);
    fetch(`/api/audit/login-logs?${params}`)
      .then((r) => r.json())
      .then((res: ApiResponse<PaginatedResponse<LoginLogRow>>) => {
        if (!res.success || !res.data) { setError(res.error || 'Failed'); return; }
        setError(null);
        setRows(res.data.items || []);
        setTotalPages(Math.max(1, res.data.totalPages || 1));
        setTotal(res.data.total || 0);
      })
      .catch(() => setError('Failed to load login logs'))
      .finally(() => setLoading(false));
  }, [page, actor, action, clientIp, from, to]);

  useEffect(() => { load(); }, [load]);

  function reset() {
    setPage(1); setActor(''); setAction(''); setClientIp(''); setFrom(''); setTo('');
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2">
        <Input value={actor} onChange={(e) => { setPage(1); setActor(e.target.value); }} placeholder="User / username" />
        <Input value={action} onChange={(e) => { setPage(1); setAction(e.target.value); }} placeholder="Action" />
        <Input value={clientIp} onChange={(e) => { setPage(1); setClientIp(e.target.value); }} placeholder="IP address" />
        <Input type="datetime-local" value={from} onChange={(e) => { setPage(1); setFrom(e.target.value); }} />
        <Input type="datetime-local" value={to} onChange={(e) => { setPage(1); setTo(e.target.value); }} />
        <Button variant="outline" onClick={reset} className="gap-2"><RotateCcw className="h-4 w-4" />Clear</Button>
      </div>

      <p className="text-xs text-muted-foreground">{total.toLocaleString()} records</p>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="rounded-2xl glass-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted">
              <th className="text-left px-3 py-2.5 font-medium text-[11px] uppercase tracking-[0.08em] text-muted-foreground whitespace-nowrap">Time</th>
              <th className="text-left px-3 py-2.5 font-medium text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Action</th>
              <th className="text-left px-3 py-2.5 font-medium text-[11px] uppercase tracking-[0.08em] text-muted-foreground">User</th>
              <th className="text-left px-3 py-2.5 font-medium text-[11px] uppercase tracking-[0.08em] text-muted-foreground">IP Address</th>
              <th className="text-left px-3 py-2.5 font-medium text-[11px] uppercase tracking-[0.08em] text-muted-foreground">User Agent</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground"><LoadingSpinner className="mx-auto" /></td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground text-sm">No login events found.</td></tr>
            )}
            {!loading && rows.map((row) => {
              const displayName = row.actor_name || row.username_attempted || 'Unknown';
              return (
                <tr key={row.id} className="border-t border-border hover:bg-muted/50 transition-colors">
                  <td className="px-3 py-2 whitespace-nowrap text-xs tabular-nums text-muted-foreground">{fmt(row.created_at)}</td>
                  <td className="px-3 py-2">
                    <Badge variant={actionBadgeVariant(row.action)} className="text-[10px] font-semibold px-1.5 py-0.5 whitespace-nowrap">
                      {row.action.replace(/_/g, ' ')}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-xs font-medium">{displayName}</td>
                  <td className="px-3 py-2 text-xs font-mono text-muted-foreground">{row.client_ip || '—'}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground max-w-[260px] truncate" title={row.user_agent || ''}>{row.user_agent || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pagination page={page} totalPages={totalPages} loading={loading} onChange={setPage} />
    </div>
  );
}

// ─── Activity Logs tab ─────────────────────────────────────────────────────────

function ActivityLogsTab() {
  const [rows, setRows] = useState<ActivityLogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const [actor, setActor] = useState('');
  const [entityType, setEntityType] = useState('');
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = useCallback(() => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('limit', '25');
    if (actor.trim()) params.set('actor', actor.trim());
    if (entityType.trim()) params.set('entityType', entityType.trim());
    if (action.trim()) params.set('action', action.trim());
    if (from) params.set('from', from);
    if (to) params.set('to', to);

    setLoading(true);
    fetch(`/api/audit/activity-logs?${params}`)
      .then((r) => r.json())
      .then((res: ApiResponse<PaginatedResponse<ActivityLogRow>>) => {
        if (!res.success || !res.data) { setError(res.error || 'Failed'); return; }
        setError(null);
        setRows(res.data.items || []);
        setTotalPages(Math.max(1, res.data.totalPages || 1));
        setTotal(res.data.total || 0);
      })
      .catch(() => setError('Failed to load activity logs'))
      .finally(() => setLoading(false));
  }, [page, actor, entityType, action, from, to]);

  useEffect(() => { load(); }, [load]);

  function reset() {
    setPage(1); setActor(''); setEntityType(''); setAction(''); setFrom(''); setTo('');
  }

  function formatDiff(diff: Record<string, unknown> | null | undefined) {
    if (!diff) return '—';
    const compact = JSON.stringify(diff);
    return compact.length > 120 ? `${compact.slice(0, 120)}…` : compact;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2">
        <Input value={actor} onChange={(e) => { setPage(1); setActor(e.target.value); }} placeholder="Actor" />
        <Input value={entityType} onChange={(e) => { setPage(1); setEntityType(e.target.value); }} placeholder="Entity type" />
        <Input value={action} onChange={(e) => { setPage(1); setAction(e.target.value); }} placeholder="Action" />
        <Input type="datetime-local" value={from} onChange={(e) => { setPage(1); setFrom(e.target.value); }} />
        <Input type="datetime-local" value={to} onChange={(e) => { setPage(1); setTo(e.target.value); }} />
        <Button variant="outline" onClick={reset} className="gap-2"><RotateCcw className="h-4 w-4" />Clear</Button>
      </div>

      <p className="text-xs text-muted-foreground">{total.toLocaleString()} records</p>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="rounded-2xl glass-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted">
              <th className="text-left px-3 py-2.5 font-medium text-[11px] uppercase tracking-[0.08em] text-muted-foreground whitespace-nowrap">Time</th>
              <th className="text-left px-3 py-2.5 font-medium text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Actor</th>
              <th className="text-left px-3 py-2.5 font-medium text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Entity</th>
              <th className="text-left px-3 py-2.5 font-medium text-[11px] uppercase tracking-[0.08em] text-muted-foreground">ID</th>
              <th className="text-left px-3 py-2.5 font-medium text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Action</th>
              <th className="text-left px-3 py-2.5 font-medium text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Details</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground"><LoadingSpinner className="mx-auto" /></td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground text-sm">No activity records found.</td></tr>
            )}
            {!loading && rows.map((row) => (
              <tr key={row.id} className="border-t border-border hover:bg-muted/50 transition-colors">
                <td className="px-3 py-2 whitespace-nowrap text-xs tabular-nums text-muted-foreground">{fmt(row.created_at)}</td>
                <td className="px-3 py-2 text-xs font-medium">{row.actor_name || 'System'}</td>
                <td className="px-3 py-2">
                  <Badge variant="secondary" className="text-[10px] font-semibold px-1.5 py-0.5">{row.entity_type}</Badge>
                </td>
                <td className="px-3 py-2 text-xs tabular-nums text-muted-foreground">{row.entity_id}</td>
                <td className="px-3 py-2 text-xs">{row.action}</td>
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground max-w-[280px] truncate" title={row.diff ? JSON.stringify(row.diff) : ''}>
                  {formatDiff(row.diff)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination page={page} totalPages={totalPages} loading={loading} onChange={setPage} />
    </div>
  );
}

// ─── SMTP Mail Logs tab ────────────────────────────────────────────────────────

const MAIL_STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'sent', label: 'Sent' },
  { value: 'failed', label: 'Failed' },
  { value: 'dead', label: 'Dead (DLQ)' },
];

function MailLogsTab() {
  const [rows, setRows] = useState<MailLogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const [status, setStatus] = useState('');
  const [eventType, setEventType] = useState('');
  const [recipient, setRecipient] = useState('');
  const [subject, setSubject] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = useCallback(() => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('limit', '25');
    if (status) params.set('status', status);
    if (eventType.trim()) params.set('eventType', eventType.trim());
    if (recipient.trim()) params.set('recipient', recipient.trim());
    if (subject.trim()) params.set('subject', subject.trim());
    if (from) params.set('from', from);
    if (to) params.set('to', to);

    setLoading(true);
    fetch(`/api/audit/mail-logs?${params}`)
      .then((r) => r.json())
      .then((res: ApiResponse<PaginatedResponse<MailLogRow>>) => {
        if (!res.success || !res.data) { setError(res.error || 'Failed'); return; }
        setError(null);
        setRows(res.data.items || []);
        setTotalPages(Math.max(1, res.data.totalPages || 1));
        setTotal(res.data.total || 0);
      })
      .catch(() => setError('Failed to load mail logs'))
      .finally(() => setLoading(false));
  }, [page, status, eventType, recipient, subject, from, to]);

  useEffect(() => { load(); }, [load]);

  function reset() {
    setPage(1); setStatus(''); setEventType(''); setRecipient(''); setSubject(''); setFrom(''); setTo('');
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-2">
        <Select value={status} onValueChange={(v) => { setPage(1); setStatus(v === 'all' ? '' : v); }}>
          <SelectTrigger><SelectValue placeholder="All statuses" /></SelectTrigger>
          <SelectContent>
            {MAIL_STATUS_OPTIONS.map((o) => (
              <SelectItem key={o.value || 'all'} value={o.value || 'all'}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input value={eventType} onChange={(e) => { setPage(1); setEventType(e.target.value); }} placeholder="Event type" />
        <Input value={recipient} onChange={(e) => { setPage(1); setRecipient(e.target.value); }} placeholder="Recipient" />
        <Input value={subject} onChange={(e) => { setPage(1); setSubject(e.target.value); }} placeholder="Subject" className="lg:col-span-2" />
        <Input type="datetime-local" value={from} onChange={(e) => { setPage(1); setFrom(e.target.value); }} />
        <Input type="datetime-local" value={to} onChange={(e) => { setPage(1); setTo(e.target.value); }} />
      </div>
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{total.toLocaleString()} records</p>
        <Button variant="outline" size="sm" onClick={reset} className="gap-2"><RotateCcw className="h-4 w-4" />Clear filters</Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="rounded-2xl glass-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted">
              <th className="text-left px-3 py-2.5 font-medium text-[11px] uppercase tracking-[0.08em] text-muted-foreground whitespace-nowrap">Queued At</th>
              <th className="text-left px-3 py-2.5 font-medium text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Status</th>
              <th className="text-left px-3 py-2.5 font-medium text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Event Type</th>
              <th className="text-left px-3 py-2.5 font-medium text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Recipient</th>
              <th className="text-left px-3 py-2.5 font-medium text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Subject</th>
              <th className="text-left px-3 py-2.5 font-medium text-[11px] uppercase tracking-[0.08em] text-muted-foreground whitespace-nowrap">Sent At</th>
              <th className="text-left px-3 py-2.5 font-medium text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Attempts</th>
              <th className="text-left px-3 py-2.5 font-medium text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Task ID</th>
              <th className="text-left px-3 py-2.5 font-medium text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Error</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-muted-foreground"><LoadingSpinner className="mx-auto" /></td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-muted-foreground text-sm">No mail records found.</td></tr>
            )}
            {!loading && rows.map((row) => (
              <tr key={row.id} className="border-t border-border hover:bg-muted/50 transition-colors">
                <td className="px-3 py-2 whitespace-nowrap text-xs tabular-nums text-muted-foreground">{fmt(row.created_at)}</td>
                <td className="px-3 py-2">{statusBadge(row.status)}</td>
                <td className="px-3 py-2 text-xs font-mono text-muted-foreground whitespace-nowrap">{row.event_type}</td>
                <td className="px-3 py-2 text-xs">
                  <div className="font-medium truncate max-w-[180px]" title={row.recipient_email || ''}>{row.recipient_email || '—'}</div>
                  {row.recipient_name && (
                    <div className="text-muted-foreground truncate max-w-[180px]">{row.recipient_name}</div>
                  )}
                </td>
                <td className="px-3 py-2 text-xs max-w-[220px] truncate" title={row.subject}>{row.subject}</td>
                <td className="px-3 py-2 whitespace-nowrap text-xs tabular-nums text-muted-foreground">{row.sent_at ? fmt(row.sent_at) : '—'}</td>
                <td className="px-3 py-2 text-xs tabular-nums text-center">{row.attempts}/{row.max_attempts}</td>
                <td className="px-3 py-2 text-xs tabular-nums text-muted-foreground">{row.task_id ?? '—'}</td>
                <td className="px-3 py-2 text-xs text-destructive max-w-[200px] truncate" title={row.last_error || ''}>{row.last_error || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination page={page} totalPages={totalPages} loading={loading} onChange={setPage} />
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

type Tab = 'login' | 'activity' | 'mail';

const TABS: { id: Tab; label: string; icon: React.ElementType; description: string }[] = [
  { id: 'login', label: 'Login Logs', icon: ShieldCheck, description: 'Authentication events — successes, failures, rate-limits, SSO' },
  { id: 'activity', label: 'Activity Logs', icon: Activity, description: 'Task, user, and config changes made by system actors' },
  { id: 'mail', label: 'SMTP Mail Logs', icon: Mail, description: 'Email outbox — delivery status, retry attempts, errors' },
];

export default function AuditPage() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>('login');

  useEffect(() => {
    if (authStatus === 'authenticated' && session?.user?.role !== 'admin') {
      router.replace('/dashboard');
    }
  }, [authStatus, session, router]);

  if (authStatus === 'loading') return <LoadingSpinner className="py-32" />;
  if (session?.user?.role !== 'admin') return null;

  const ActiveIcon = TABS.find((t) => t.id === activeTab)!.icon;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit Logs"
        subtitle="Security and operational event history for this deployment"
      />

      {/* Tab strip */}
      <div className="flex gap-1 rounded-xl glass-subtle p-1 w-fit">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                active
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-card/60'
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Active tab description + content */}
      <Card>
        <CardContent className="pt-5 space-y-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <ActiveIcon className="h-4 w-4 text-primary shrink-0" />
            <span>{TABS.find((t) => t.id === activeTab)!.description}</span>
          </div>

          {activeTab === 'login' && <LoginLogsTab />}
          {activeTab === 'activity' && <ActivityLogsTab />}
          {activeTab === 'mail' && <MailLogsTab />}
        </CardContent>
      </Card>
    </div>
  );
}
