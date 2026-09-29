'use client';

import React, { Suspense, useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { mutate as globalMutate } from 'swr';
import { PageHeader } from '@/components/shared/PageHeader';
import { TaskFilters } from '@/components/tasks/TaskFilters';
import { TaskTable, TOGGLEABLE_TASK_COLUMNS } from '@/components/tasks/TaskTable';
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SlidersHorizontal } from 'lucide-react';
import { TaskForm } from '@/components/tasks/TaskForm';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import { buildSearchParams, canManageTasks } from '@/lib/utils';
import type { Task, PaginatedResponse } from '@/types';


function TasksPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [tabCounts, setTabCounts] = useState<{ mine: number | null; active: number | null; completed: number | null }>({ mine: null, active: null, completed: null });
  const [showForm, setShowForm] = useState(searchParams.get('create') === 'true');
  const [editTask, setEditTask] = useState<Task | null>(null);
const [taskView, setTaskView] = useState<'mine' | 'active' | 'completed'>(searchParams.get('status') === 'completed' ? 'completed' : 'mine');

  // Filters
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [status, setStatus] = useState(searchParams.get('status') || '');
  const [priority, setPriority] = useState(searchParams.get('priority') || '');
  const [overdue, setOverdue] = useState(searchParams.get('overdue') === 'true');
  const [highPriority, setHighPriority] = useState(searchParams.get('highPriority') === 'true');
  const [dueToday, setDueToday] = useState(searchParams.get('dueToday') === 'true');
  const [upcomingDays, setUpcomingDays] = useState(searchParams.get('upcomingDays') || '');
  const [showDeleted, setShowDeleted] = useState(false);
  const [assignToMe, setAssignToMe] = useState(false);
  const [departmentOnly, setDepartmentOnly] = useState(false);
  const [sortBy, setSortBy] = useState('created_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const DEFAULT_HIDDEN_COLUMNS = ['assigned_by_name', 'last_status_update_at', 'next_reminder_at'];
  const [hiddenColumns, setHiddenColumns] = useState<string[]>(() => {
    try {
      const saved = typeof window !== 'undefined' ? window.localStorage.getItem('tasks-table-hidden-columns') : null;
      if (saved) { const p = JSON.parse(saved) as string[]; if (Array.isArray(p)) return p; }
    } catch { /* ignore */ }
    return DEFAULT_HIDDEN_COLUMNS;
  });
  const toggleColumn = (key: string) => {
    setHiddenColumns((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      try { window.localStorage.setItem('tasks-table-hidden-columns', JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };
  const hideDepartmentOption = session?.user?.companyHeadAccess === true;
  // Stable primitive deps to avoid re-creating fetchTasks on every render
  const userId = session?.user?.id;
  const userDeptId = session?.user?.deptId;

  // Quick-complete dialog
  const [completeTask, setCompleteTask] = useState<Task | null>(null);
  const [completeComment, setCompleteComment] = useState('');
  const [completeSubmitting, setCompleteSubmitting] = useState(false);

  const taskViewDescription = taskView === 'mine'
    ? 'Tasks currently assigned to you — open and in-progress work that needs your attention.'
    : taskView === 'active'
    ? 'Track open and in-progress work, use filters to narrow by priority and department, and take action quickly.'
    : 'Review completed work items for closure history, outcomes, and post-completion references.';


  const fetchTabCounts = useCallback(async () => {
    if (!userId) return;
    try {
      const [mineRes, activeRes, completedRes] = await Promise.all([
        fetch(`/api/tasks?activeOnly=true&assignedTo=${userId}&limit=1`),
        fetch(`/api/tasks?activeOnly=true&limit=1`),
        fetch(`/api/tasks?status=completed&limit=1`),
      ]);
      const [mineData, activeData, completedData] = await Promise.all([
        mineRes.json(), activeRes.json(), completedRes.json(),
      ]);
      setTabCounts({
        mine: mineData.success ? (mineData.data as PaginatedResponse<Task>).total : null,
        active: activeData.success ? (activeData.data as PaginatedResponse<Task>).total : null,
        completed: completedData.success ? (completedData.data as PaginatedResponse<Task>).total : null,
      });
    } catch { /* non-blocking */ }
  }, [userId]);

  const invalidateDashboard = useCallback(() => {
    void globalMutate('/api/dashboard/stats');
    void fetchTabCounts();
  }, [fetchTabCounts]);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const qs = buildSearchParams({
        search, status, priority,
        activeOnly: taskView === 'active' || taskView === 'mine' ? 'true' : undefined,
        assignedTo: taskView === 'mine' ? String(userId || '') : assignToMe ? String(userId || '') : undefined,
        deptId: departmentOnly && userDeptId ? String(userDeptId) : undefined,
        overdue: overdue ? 'true' : undefined,
        highPriority: highPriority ? 'true' : undefined,
        dueToday: dueToday ? 'true' : undefined,
        upcomingDays: upcomingDays || undefined,
        deleted: showDeleted ? 'true' : undefined,
        page, limit: 20, sortBy, sortDir,
      });
      const res = await fetch(`/api/tasks?${qs}`);
      const data = await res.json();
      if (data.success) {
        const paginated = data.data as PaginatedResponse<Task>;
        setTasks(paginated.items);
        setTotal(paginated.total);
        setTotalPages(paginated.totalPages);
      } else {
        setTasks([]);
        setTotal(0);
        setTotalPages(1);
      }
    } catch {
      setTasks([]);
      setTotal(0);
      setTotalPages(1);
      toast.error('Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }, [search, status, priority, taskView, assignToMe, departmentOnly, overdue, highPriority, dueToday, upcomingDays, showDeleted, page, sortBy, sortDir, userId, userDeptId]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);
  useEffect(() => { void fetchTabCounts(); }, [fetchTabCounts]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // Only reset filters when the view tab or department visibility changes
    if (taskView === 'completed') {
      if (status !== 'completed') setStatus('completed');
      if (overdue) setOverdue(false);
      if (highPriority) setHighPriority(false);
      if (dueToday) setDueToday(false);
      if (upcomingDays) setUpcomingDays('');
      if (page !== 1) setPage(1);
      return;
    }
    if (taskView === 'mine') {
      if (status === 'completed') setStatus('');
      if (assignToMe) setAssignToMe(false);
      if (page !== 1) setPage(1);
      return;
    }
    if (hideDepartmentOption && departmentOnly) setDepartmentOnly(false);
    if (status === 'completed') setStatus('');
    if (page !== 1) setPage(1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskView, hideDepartmentOption]); // intentionally omit filter deps to avoid feedback loops

  const handleDelete = async (task: Task) => {
    // Optimistic remove
    setTasks((prev) => prev.filter((t) => t.id !== task.id));
    setTotal((prev) => Math.max(0, prev - 1));
    try {
      const res = await fetch(`/api/tasks/${task.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        toast.success('Task deleted');
        invalidateDashboard();
        void fetchTasks(); // refresh to get accurate pagination
      } else {
        toast.error(data.error || 'Delete failed');
        void fetchTasks(); // revert
      }
    } catch {
      toast.error('Delete failed');
      void fetchTasks(); // revert
    }
  };

  const handleRestore = async (task: Task) => {
    try {
      const res = await fetch(`/api/tasks/${task.id}/restore`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        toast.success('Task restored');
        invalidateDashboard();
        void fetchTasks();
      } else {
        toast.error(data.error || 'Restore failed');
      }
    } catch {
      toast.error('Restore failed');
    }
  };

  const handleComplete = async () => {
    if (!completeTask) return;
    const trimmed = completeComment.trim();
    if (!trimmed) {
      toast.error('Please add a closing comment');
      return;
    }
    setCompleteSubmitting(true);
    try {
      const res = await fetch(`/api/tasks/${completeTask.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: trimmed, status: 'completed' }),
      });
      const data = await res.json();
      if (!data.success) {
        toast.error(data.error || 'Failed to complete task');
        return;
      }
      toast.success('Task marked as completed');
      setCompleteTask(null);
      setCompleteComment('');
      invalidateDashboard();
      void fetchTasks();
    } catch {
      toast.error('Failed to complete task');
    } finally {
      setCompleteSubmitting(false);
    }
  };

  const handleReset = () => {
    setSearch(''); setStatus(''); setPriority('');
    setAssignToMe(false); setDepartmentOnly(false);
    setOverdue(false); setHighPriority(false); setDueToday(false); setUpcomingDays('');
    setShowDeleted(false); setPage(1);
    setTaskView('active');
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Tasks" subtitle={`${total} total tasks`}>
        {canManageTasks(session?.user?.role) && (
          <Button onClick={() => { setEditTask(null); setShowForm(true); }} className="gap-2">
            <Plus className="h-4 w-4" /> New Task
          </Button>
        )}
      </PageHeader>

      <Tabs value={taskView} onValueChange={(v) => setTaskView(v as 'mine' | 'active' | 'completed')}>
        <TabsList>
          <TabsTrigger value="mine" className="gap-1.5">
            Assigned to Me
            {tabCounts.mine !== null && (
              <span className="inline-flex h-4 min-w-[16px] items-center justify-center rounded bg-current/15 px-1 text-[10px] font-semibold tabular-nums opacity-70">
                {tabCounts.mine}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="active" className="gap-1.5">
            Active Tasks
            {tabCounts.active !== null && (
              <span className="inline-flex h-4 min-w-[16px] items-center justify-center rounded bg-current/15 px-1 text-[10px] font-semibold tabular-nums opacity-70">
                {tabCounts.active}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="completed" className="gap-1.5">
            Completed Tasks
            {tabCounts.completed !== null && (
              <span className="inline-flex h-4 min-w-[16px] items-center justify-center rounded bg-current/15 px-1 text-[10px] font-semibold tabular-nums opacity-70">
                {tabCounts.completed}
              </span>
            )}
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <p className="-mt-3 text-sm text-muted-foreground">{taskViewDescription}</p>

      <TaskFilters
        search={search} onSearchChange={setSearch}
        status={status} onStatusChange={(v) => { setStatus(v === 'all' ? '' : v); if (v === 'completed') setTaskView('completed'); }}
        priority={priority} onPriorityChange={(v) => setPriority(v === 'all' ? '' : v)}
        assignToMe={assignToMe} onAssignToMeChange={setAssignToMe}
        departmentOnly={departmentOnly} onDepartmentOnlyChange={setDepartmentOnly}
        canFilterDepartment={!!session?.user?.deptId}
        hideDepartmentOption={hideDepartmentOption}
        showDeleted={showDeleted} onShowDeletedChange={setShowDeleted}
        isAdmin={session?.user?.role === 'admin'}
        onReset={handleReset}
        endSlot={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" title="Toggle columns" className="h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-card hover:text-foreground transition-colors">
                <SlidersHorizontal className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              {TOGGLEABLE_TASK_COLUMNS.map((col) => (
                <DropdownMenuCheckboxItem key={col.key} checked={!hiddenColumns.includes(col.key)} onCheckedChange={() => toggleColumn(col.key)}>
                  {col.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      <TaskTable
        tasks={tasks}
        total={total}
        page={page}
        totalPages={totalPages}
        loading={loading}
        sortBy={sortBy}
        sortDir={sortDir}
        showDeleted={showDeleted}
        canManage={canManageTasks(session?.user?.role)}
        hiddenColumns={taskView === 'completed'
          ? [...hiddenColumns, ...(['due_date', 'next_reminder_at'].filter(c => !hiddenColumns.includes(c)))]
          : hiddenColumns}
        columnLabelOverrides={taskView === 'completed' ? { last_status_update_at: 'Completion Date' } : undefined}
        onPageChange={setPage}
        onSort={(key, dir) => { setSortBy(key); setSortDir(dir); }}
        onRowClick={(task) => router.push(`/tasks/${task.id}`)}
        onEdit={(task) => { setEditTask(task); setShowForm(true); }}
        onDelete={handleDelete}
        onRestore={handleRestore}
        onComplete={(task) => { setCompleteTask(task); setCompleteComment(''); }}
      />

      <TaskForm
        open={showForm}
        onOpenChange={(open) => { setShowForm(open); if (!open) setEditTask(null); }}
        task={editTask}
        onSuccess={() => { setShowForm(false); setEditTask(null); invalidateDashboard(); void fetchTasks(); }}
      />

      {/* Quick-complete dialog */}
      <Dialog open={!!completeTask} onOpenChange={(open) => { if (!open) { setCompleteTask(null); setCompleteComment(''); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Mark Task as Complete</DialogTitle>
            <DialogDescription>
              Add a brief closing comment before completing &ldquo;{completeTask?.title}&rdquo;.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Closing comment (required)..."
            value={completeComment}
            onChange={(e) => setCompleteComment(e.target.value)}
            rows={3}
            className="resize-none"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCompleteTask(null); setCompleteComment(''); }}>
              Cancel
            </Button>
            <Button onClick={handleComplete} disabled={completeSubmitting} className="gap-1.5">
              {completeSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Complete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function TasksPage() {
  return (
    <Suspense fallback={<div className="min-h-[40vh]" />}>
      <TasksPageContent />
    </Suspense>
  );
}
