'use client';

import React, { useState } from 'react';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { PersonalTaskList } from '@/components/personal/PersonalTaskList';
import { PersonalTaskFormModal, type PersonalTaskFormData } from '@/components/personal/PersonalTaskFormModal';
import { usePersonalTasks, type PersonalStatusFilter } from '@/hooks/usePersonalTasks';
import { Plus, Lock } from 'lucide-react';

function TabCount({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="ml-1.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary px-1">
      {count}
    </span>
  );
}

export default function PersonalPage() {
  const [tab, setTab] = useState<PersonalStatusFilter>('pending');
  const [formOpen, setFormOpen] = useState(false);
  const { create, addSubtask, addReminder } = usePersonalTasks(tab);

  // Fetch all tasks to derive counts for tab badges
  const { tasks: allTasks } = usePersonalTasks('all');
  const pendingCount = allTasks.filter((t) => t.status === 'pending').length;
  const doneCount = allTasks.filter((t) => t.status === 'done').length;

  async function handleCreate(data: PersonalTaskFormData) {
    const { subtasks, reminders, removedReminderIds: _removed, ...taskData } = data;
    const created = await create(taskData);
    await Promise.all([
      ...subtasks.map((s) => addSubtask(created.id, s.title)),
      ...reminders.map((r) => addReminder(created.id, r.remind_at, r.channel)),
    ]);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Personal Tasks"
        subtitle="Private to you — not visible to anyone else and excluded from team analytics."
      >
        <div className="flex items-center gap-2 text-xs text-muted-foreground border border-border rounded-md px-2.5 py-1.5 bg-muted/50">
          <Lock className="h-3.5 w-3.5 text-primary" />
          <span>Only visible to you</span>
        </div>
        <Button onClick={() => setFormOpen(true)} size="sm">
          <Plus className="h-4 w-4 mr-1.5" />
          New Task
        </Button>
      </PageHeader>

      <Tabs value={tab} onValueChange={(v) => setTab(v as PersonalStatusFilter)}>
        <TabsList>
          <TabsTrigger value="pending">
            Pending<TabCount count={pendingCount} />
          </TabsTrigger>
          <TabsTrigger value="done">
            Done<TabCount count={doneCount} />
          </TabsTrigger>
          <TabsTrigger value="all">
            All<TabCount count={allTasks.length} />
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="mt-4">
          <PersonalTaskList statusFilter="pending" />
        </TabsContent>
        <TabsContent value="done" className="mt-4">
          <PersonalTaskList statusFilter="done" />
        </TabsContent>
        <TabsContent value="all" className="mt-4">
          <PersonalTaskList statusFilter="all" />
        </TabsContent>
      </Tabs>

      <PersonalTaskFormModal
        open={formOpen}
        onOpenChange={setFormOpen}
        onSave={handleCreate}
      />
    </div>
  );
}
