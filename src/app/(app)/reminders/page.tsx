'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { PageHeader } from '@/components/shared/PageHeader';
import { DataTable } from '@/components/shared/DataTable';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatDateTime } from '@/lib/utils';
import { useNotifications } from '@/hooks/useNotifications';
import { CHANNEL_OPTIONS } from '@/constants';
import type { ReminderLog, Notification, ColumnDef, PaginatedResponse } from '@/types';

const columns: ColumnDef<ReminderLog>[] = [
  { key: 'task_title', header: 'Task', render: (r) => <span className="font-medium">{r.task_title || `#${r.task_id}`}</span> },
  { key: 'channel', header: 'Channel', render: (r) => <Badge variant={r.channel === 'email' ? 'info' : r.channel === 'whatsapp' ? 'success' : 'warning'}>{r.channel}</Badge> },
  { key: 'recipient', header: 'Recipient', render: (r) => r.recipient || '—' },
  {
    key: 'status', header: 'Status',
    render: (r) => <Badge variant={r.status === 'sent' ? 'success' : r.status === 'failed' ? 'destructive' : 'warning'}>{r.status}</Badge>,
  },
  { key: 'error_msg', header: 'Error', render: (r) => r.error_msg ? <span className="text-xs text-destructive">{r.error_msg}</span> : '—' },
  { key: 'sent_at', header: 'Sent At', render: (r) => formatDateTime(r.sent_at) },
];

export default function RemindersPage() {
  const [logs, setLogs] = useState<ReminderLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [channelFilter, setChannelFilter] = useState('');
  const { notifications, unreadCount, markRead, isLoading: notificationsLoading } = useNotifications();

  const notificationColumns: ColumnDef<Notification>[] = [
    { key: 'type', header: 'Type', render: (n) => <Badge variant={n.is_read ? 'secondary' : 'info'}>{n.type}</Badge> },
    { key: 'message', header: 'Message', render: (n) => <span className="text-sm">{n.message}</span> },
    { key: 'created_at', header: 'Created', render: (n) => formatDateTime(n.created_at) },
    {
      key: 'is_read',
      header: 'Status',
      render: (n) => <Badge variant={n.is_read ? 'secondary' : 'warning'}>{n.is_read ? 'Read' : 'Unread'}</Badge>,
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (n) => n.is_read ? '—' : (
        <Button variant="ghost" size="sm" onClick={() => markRead(n.id)}>
          Mark read
        </Button>
      ),
    },
  ];

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: '20' });
    if (statusFilter) params.set('status', statusFilter);
    if (channelFilter) params.set('channel', channelFilter);
    try {
      const res = await fetch(`/api/reminders/logs?${params}`);
      const data = await res.json();
      if (data.success) {
        const p = data.data as PaginatedResponse<ReminderLog>;
        setLogs(p.items); setTotal(p.total); setTotalPages(p.totalPages);
      }
    } catch {}
    finally { setLoading(false); }
  }, [page, statusFilter, channelFilter]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  return (
    <div className="space-y-6">
      <PageHeader title="Alerts" subtitle={`Unified reminders and notifications (${unreadCount} unread notifications)`} />

      <Tabs defaultValue="reminders" className="space-y-4">
        <TabsList>
          <TabsTrigger value="reminders">Reminders</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
        </TabsList>

        <TabsContent value="reminders" className="space-y-4">
          <div className="flex gap-3">
            <Select value={statusFilter} onValueChange={s => { setStatusFilter(s); setPage(1); }}>
              <SelectTrigger className="w-[140px]"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="sent">Sent</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="skipped">Skipped</SelectItem>
              </SelectContent>
            </Select>
            <Select value={channelFilter} onValueChange={c => { setChannelFilter(c); setPage(1); }}>
              <SelectTrigger className="w-[140px]"><SelectValue placeholder="Channel" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {CHANNEL_OPTIONS.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <DataTable columns={columns} data={logs} total={total} page={page} totalPages={totalPages} loading={loading} onPageChange={setPage} emptyMessage="No reminder logs" />
        </TabsContent>

        <TabsContent value="notifications" className="space-y-4">
          <div className="flex items-center justify-end">
            <Button variant="outline" size="sm" onClick={() => markRead()} disabled={notificationsLoading || unreadCount === 0}>
              Mark all read
            </Button>
          </div>
          <DataTable
            columns={notificationColumns}
            data={notifications}
            total={notifications.length}
            page={1}
            totalPages={1}
            loading={notificationsLoading}
            onRowClick={(row) => { if (!row.is_read) markRead(row.id); }}
            emptyMessage="No notifications"
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
