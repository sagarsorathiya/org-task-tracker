'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { PageHeader } from '@/components/shared/PageHeader';
import { DataTable } from '@/components/shared/DataTable';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { TransactionReminderForm } from '@/components/transactions/TransactionReminderForm';
import { TransactionReminderDetailModal } from '@/components/transactions/TransactionReminderDetailModal';
import { Plus, Search, Paperclip, Pencil, Trash2, CheckCircle2, Clock, Repeat } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import toast from 'react-hot-toast';
import { buildSearchParams, canManageTasks } from '@/lib/utils';
import type { ColumnDef, PaginatedResponse, TransactionReminder } from '@/types';

function formatDate(value: string | null): string {
  if (!value) return '—';
  const d = new Date(`${value.split('T')[0]}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(d);
}

export default function TransactionsPage() {
  const { data: session } = useSession();
  const [records, setRecords] = useState<TransactionReminder[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('reminder_date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [showForm, setShowForm] = useState(false);
  const [editRecord, setEditRecord] = useState<TransactionReminder | null>(null);
  const [deleteRecord, setDeleteRecord] = useState<TransactionReminder | null>(null);
  const [viewRecord, setViewRecord] = useState<TransactionReminder | null>(null);

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    try {
      const qs = buildSearchParams({ search: search || undefined, page, limit: 20, sortBy, sortDir });
      const res = await fetch(`/api/transactions?${qs}`);
      const data = await res.json();
      if (data.success) {
        const paginated = data.data as PaginatedResponse<TransactionReminder>;
        setRecords(paginated.items);
        setTotal(paginated.total);
        setTotalPages(paginated.totalPages);
      } else {
        setRecords([]); setTotal(0); setTotalPages(1);
      }
    } catch {
      setRecords([]); setTotal(0); setTotalPages(1);
      toast.error('Failed to load transaction reminders');
    } finally {
      setLoading(false);
    }
  }, [search, page, sortBy, sortDir]);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);

  const handleDelete = async () => {
    if (!deleteRecord) return;
    try {
      const res = await fetch(`/api/transactions/${deleteRecord.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        toast.success('Record deleted');
        setDeleteRecord(null);
        void fetchRecords();
      } else {
        toast.error(data.error || 'Delete failed');
      }
    } catch {
      toast.error('Delete failed');
    }
  };

  const canManage = canManageTasks(session?.user?.role);

  const columns: ColumnDef<TransactionReminder>[] = [
    {
      key: 'type', header: 'Type', sortable: true, className: 'whitespace-nowrap',
      render: (row) => (
        <Badge variant={row.type === 'subscription' ? 'info' : 'secondary'}>
          {row.type === 'subscription' ? 'Subscription' : 'Payment'}
        </Badge>
      ),
    },
    {
      key: 'party_name', header: 'Party Name', sortable: true,
      render: (row) => <span className="text-sm font-medium">{row.party_name}</span>,
    },
    {
      key: 'vendor_code', header: 'Vendor Code',
      render: (row) => <span className="text-sm text-muted-foreground">{row.vendor_code || '—'}</span>,
    },
    {
      key: 'place', header: 'Place',
      render: (row) => <span className="text-sm text-muted-foreground">{row.place || '—'}</span>,
    },
    {
      key: 'execution_date', header: 'Execution Date', sortable: true, className: 'whitespace-nowrap',
      render: (row) => <span className="text-sm">{formatDate(row.execution_date)}</span>,
    },
    {
      key: 'bill_date', header: 'Bill Date', sortable: true, className: 'whitespace-nowrap',
      render: (row) => <span className="text-sm">{formatDate(row.bill_date)}</span>,
    },
    {
      key: 'reminder_date', header: 'Reminder', sortable: true, className: 'whitespace-nowrap',
      render: (row) => (
        <span className="inline-flex items-center gap-1.5 text-sm">
          {row.is_reminder_sent
            ? <CheckCircle2 className="h-3.5 w-3.5 text-success" />
            : <Clock className="h-3.5 w-3.5 text-warning" />}
          {formatDate(row.reminder_date)} {row.reminder_time?.slice(0, 5)}
          {row.recurrence && row.recurrence !== 'none' && (
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Repeat className="h-3.5 w-3.5 text-info" />
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs capitalize">Repeats {row.recurrence}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </span>
      ),
    },
    {
      key: 'dept_name', header: 'Department',
      render: (row) => <span className="text-sm text-muted-foreground">{row.dept_name || '—'}</span>,
    },
    {
      key: 'attachment_count', header: 'Files', className: 'whitespace-nowrap',
      render: (row) => (
        <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
          <Paperclip className="h-3.5 w-3.5" />
          {row.attachment_count ?? 0}
        </span>
      ),
    },
    {
      key: 'actions', header: '', className: 'text-right whitespace-nowrap',
      render: (row) => (
        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
          <button
            type="button"
            title="Edit"
            className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
            onClick={(e) => { e.stopPropagation(); setEditRecord(row); setShowForm(true); }}
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          {canManage && (
            <button
              type="button"
              title="Delete"
              className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              onClick={(e) => { e.stopPropagation(); setDeleteRecord(row); }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Transaction Reminder" subtitle={`${total} total records`}>
        <Button onClick={() => { setEditRecord(null); setShowForm(true); }} className="gap-2">
          <Plus className="h-4 w-4" /> New Record
        </Button>
      </PageHeader>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search party, vendor code, place..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="pl-9"
        />
      </div>

      <DataTable
        columns={columns}
        data={records}
        total={total}
        page={page}
        totalPages={totalPages}
        pageSize={20}
        loading={loading}
        sortBy={sortBy}
        sortDir={sortDir}
        onPageChange={setPage}
        onSort={(key, dir) => { setSortBy(key); setSortDir(dir); }}
        onRowClick={(row) => setViewRecord(row)}
        emptyMessage="No transaction reminders yet — create one to get started."
      />

      <TransactionReminderForm
        open={showForm}
        onOpenChange={(open) => { setShowForm(open); if (!open) setEditRecord(null); }}
        record={editRecord}
        onSuccess={() => { setShowForm(false); setEditRecord(null); void fetchRecords(); }}
      />

      <TransactionReminderDetailModal
        open={!!viewRecord}
        onOpenChange={(open) => { if (!open) setViewRecord(null); }}
        record={viewRecord}
        onEdit={() => { setEditRecord(viewRecord); setViewRecord(null); setShowForm(true); }}
      />

      <ConfirmDialog
        open={!!deleteRecord}
        onOpenChange={(open) => { if (!open) setDeleteRecord(null); }}
        title="Delete Transaction Reminder"
        message={`Are you sure you want to delete the record for "${deleteRecord?.party_name}"? This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={handleDelete}
        variant="destructive"
      />
    </div>
  );
}
