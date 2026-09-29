'use client';

import React, { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { PageHeader } from '@/components/shared/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { CheckCircle2, XCircle, Server, Database, Upload, Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import toast from 'react-hot-toast';
import type { ApiResponse } from '@/types';

interface ConfigData {
  envConfig: { key: string; status: string }[];
  tableCounts: { table: string; count: number }[];
  scheduler: { enabled: boolean; cron: string; status: string };
  ldap: { connected: boolean; error?: string };
  opsMetrics?: {
    emailOutboxPending: number;
    emailOutboxFailed: number;
    emailOutboxDead: number;
    reminderFailures24h: number;
    authRateLimitedActive: number;
  };
}

export default function ConfigPage() {
  const { data: session } = useSession();
  const [data, setData] = useState<ConfigData | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [restoreReason, setRestoreReason] = useState('');
  const [approvalToken, setApprovalToken] = useState('');
  const appEnv = process.env.NEXT_PUBLIC_APP_ENV || process.env.NODE_ENV || 'unknown';

  useEffect(() => {
    fetch('/api/config/status')
      .then(r => r.json())
      .then(d => { if (d.success) setData(d.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await fetch('/api/config/database/export?mode=full');
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Database export failed' }));
        throw new Error(err.error || 'Database export failed');
      }

      const blob = await res.blob();
      const disposition = res.headers.get('content-disposition') || '';
      const matched = disposition.match(/filename="?([^\"]+)"?/i);
      const fileName = matched?.[1]
        || `organization-full-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.zip`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      toast.success('Full portable backup exported');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Database export failed');
    } finally {
      setExporting(false);
    }
  };

  const handleGenerateApproval = async () => {
    if (confirmText.trim().toUpperCase() !== 'RESTORE DATABASE') {
      toast.error('Type RESTORE DATABASE to continue');
      return;
    }

    if (restoreReason.trim().length < 5) {
      toast.error('Please provide a restore reason (min 5 chars)');
      return;
    }

    try {
      const res = await fetch('/api/config/database/import/approval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmText, reason: restoreReason }),
      });
      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || 'Approval failed');
      }
      setApprovalToken(data.data.approvalToken);
      toast.success('Approval granted for 10 minutes');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Approval failed');
    }
  };

  const handleImport = async (file: File | null) => {
    if (!file) {
      return;
    }

    if (!file.name.toLowerCase().endsWith('.sql')) {
      toast.error('Please choose a .sql backup file');
      return;
    }

    if (!approvalToken) {
      toast.error('Generate an approval token first');
      return;
    }

    setImporting(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('approvalToken', approvalToken);
      form.append('reason', restoreReason);

      const res = await fetch('/api/config/database/import', {
        method: 'POST',
        body: form,
      });

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || 'Database import failed');
      }

      toast.success('Database restored successfully');
      setApprovalToken('');
      setConfirmText('');
      setRestoreReason('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Database import failed');
    } finally {
      setImporting(false);
    }
  };

  if (loading) return <LoadingSpinner className="py-32" />;
  if (!data) return <p>Failed to load config.</p>;

  return (
    <div className="space-y-6">
      <PageHeader title="System Configuration" subtitle="Environment and database status" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Environment Config */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Server className="h-5 w-5 text-primary" /> Environment Config
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {data.envConfig.map(c => (
                <div key={c.key} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted">
                  <code className="text-xs">{c.key}</code>
                  <Badge variant={c.status === 'Configured' ? 'success' : 'destructive'}>
                    {c.status === 'Configured' ? <CheckCircle2 className="h-3 w-3 mr-1" /> : <XCircle className="h-3 w-3 mr-1" />}
                    {c.status}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Database Summary */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Database className="h-5 w-5 text-primary" /> Database Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {data.tableCounts.map(t => (
                <div key={t.table} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted">
                  <code className="text-xs">{t.table}</code>
                  <span className="text-sm font-mono">{t.count >= 0 ? t.count : 'Error'}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Scheduler */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Scheduler</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex justify-between"><span className="text-sm">Status</span><Badge variant={data.scheduler.enabled ? 'success' : 'secondary'}>{data.scheduler.status}</Badge></div>
            <div className="flex justify-between"><span className="text-sm">Cron</span><code className="text-xs">{data.scheduler.cron}</code></div>
          </CardContent>
        </Card>

        {/* LDAP */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">LDAP Connectivity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex justify-between"><span className="text-sm">Status</span><Badge variant={data.ldap.connected ? 'success' : 'destructive'}>{data.ldap.connected ? 'Connected' : 'Disconnected'}</Badge></div>
            {data.ldap.error && <p className="text-xs text-destructive">{data.ldap.error}</p>}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Operational Reliability Metrics</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              <div className="rounded-xl glass-subtle p-3">
                <p className="text-xs text-muted-foreground">Outbox Pending</p>
                <p className="text-xl font-semibold">{data.opsMetrics?.emailOutboxPending ?? 0}</p>
              </div>
              <div className="rounded-xl glass-subtle p-3">
                <p className="text-xs text-muted-foreground">Outbox Failed</p>
                <p className="text-xl font-semibold">{data.opsMetrics?.emailOutboxFailed ?? 0}</p>
              </div>
              <div className="rounded-xl glass-subtle p-3">
                <p className="text-xs text-muted-foreground">Outbox Dead (DLQ)</p>
                <p className="text-xl font-semibold">{data.opsMetrics?.emailOutboxDead ?? 0}</p>
              </div>
              <div className="rounded-xl glass-subtle p-3">
                <p className="text-xs text-muted-foreground">Reminder Failures (24h)</p>
                <p className="text-xl font-semibold">{data.opsMetrics?.reminderFailures24h ?? 0}</p>
              </div>
              <div className="rounded-xl glass-subtle p-3">
                <p className="text-xs text-muted-foreground">Active Auth Rate Limits</p>
                <p className="text-xl font-semibold">{data.opsMetrics?.authRateLimitedActive ?? 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {session?.user?.role === 'admin' && (
          <Card className="lg:col-span-2">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Database className="h-5 w-5 text-primary" /> Admin Database
                <Badge variant={appEnv === 'production' ? 'destructive' : 'secondary'}>
                  {String(appEnv).toUpperCase()}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Export a portable full backup bundle (database, uploads, env/secrets snapshot, and runtime artifacts) and restore database from a SQL backup file.
              </p>
              <p className="text-xs text-muted-foreground">
                Note: Import accepts only <code>.sql</code> database backups. Full backup bundle is for server migration and manual file transfer.
              </p>
              <div className="flex flex-wrap gap-3">
                <Button onClick={handleExport} disabled={exporting || importing} className="gap-2">
                  {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  {exporting ? 'Exporting...' : 'Export Full Backup'}
                </Button>
              </div>

              <div className="rounded-lg border border-warning/30 bg-warning/10 p-4 space-y-3">
                <p className="text-sm font-semibold">Two-step restore approval required</p>
                <p className="text-xs text-muted-foreground">
                  Step 1: Type RESTORE DATABASE and provide reason to generate a short-lived approval token.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Input
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder="Type: RESTORE DATABASE"
                  />
                  <Input
                    value={restoreReason}
                    onChange={(e) => setRestoreReason(e.target.value)}
                    placeholder="Reason for restore"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <Button variant="outline" onClick={handleGenerateApproval} disabled={importing || exporting}>
                    Generate Approval Token
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    {approvalToken ? 'Approval active (expires in ~10 minutes)' : 'No active approval token'}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-3">

                <label className="inline-flex">
                  <input
                    type="file"
                    accept=".sql"
                    className="hidden"
                    disabled={exporting || importing || !approvalToken}
                    onChange={(e) => {
                      const selected = e.target.files?.[0] || null;
                      handleImport(selected).finally(() => {
                        e.currentTarget.value = '';
                      });
                    }}
                  />
                  <span className="inline-flex h-10 items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">
                    {importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                    {importing ? 'Importing...' : 'Import Backup (.sql)'}
                  </span>
                </label>
              </div>
            </CardContent>
          </Card>
        )}


      </div>
    </div>
  );
}


