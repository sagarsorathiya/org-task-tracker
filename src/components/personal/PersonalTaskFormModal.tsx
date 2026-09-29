'use client';

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Plus, Trash2, Bell, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PersonalTask, PersonalRecurrence } from '@/types';

interface SubtaskDraft {
  id: string;
  title: string;
  is_done: boolean;
}

interface ReminderDraft {
  id: string;
  remind_at: string;
  channel: 'email' | 'whatsapp' | 'both' | 'in_app';
  existingId?: number;
}

interface FormState {
  title: string;
  notes: string;
  priority: 'low' | 'medium' | 'high';
  due_date: string;
  due_time: string;
  recurrence_rule: PersonalRecurrence;
  subtasks: SubtaskDraft[];
  reminders: ReminderDraft[];
}

function defaultForm(task?: PersonalTask | null): FormState {
  return {
    title: task?.title ?? '',
    notes: task?.notes ?? '',
    priority: task?.priority ?? 'medium',
    due_date: task?.due_date ?? '',
    due_time: task?.due_time?.slice(0, 5) ?? '',
    recurrence_rule: task?.recurrence_rule ?? 'none',
    subtasks: task?.subtasks.map((s) => ({ id: String(s.id), title: s.title, is_done: s.is_done })) ?? [],
    reminders: task?.reminders.map((r) => ({
      id: String(r.id),
      remind_at: r.remind_at.slice(0, 16),
      channel: r.channel,
      existingId: r.id,
    })) ?? [],
  };
}

const PRIORITY_CONFIG = {
  low:    { label: 'Low',    className: 'border-info/40 bg-info/10 text-info' },
  medium: { label: 'Medium', className: 'border-warning/40 bg-warning/10 text-warning' },
  high:   { label: 'High',   className: 'border-destructive/40 bg-destructive/10 text-destructive' },
} as const;

const CHANNEL_LABELS: Record<string, string> = {
  in_app: 'In-App Only',
  email: 'Email',
  whatsapp: 'WhatsApp',
  both: 'Email + WhatsApp',
};

export interface PersonalTaskFormData {
  title: string;
  notes: string | null;
  priority: 'low' | 'medium' | 'high';
  due_date: string | null;
  due_time: string | null;
  recurrence_rule: PersonalRecurrence;
  subtasks: { title: string; is_done: boolean }[];
  reminders: { remind_at: string; channel: 'email' | 'whatsapp' | 'both' | 'in_app'; existingId?: number }[];
  removedReminderIds: number[];
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task?: PersonalTask | null;
  onSave: (data: PersonalTaskFormData) => Promise<void>;
}

export function PersonalTaskFormModal({ open, onOpenChange, task, onSave }: Props) {
  const [form, setForm] = useState<FormState>(() => defaultForm(task));
  const [newSubtask, setNewSubtask] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [removedReminderIds, setRemovedReminderIds] = useState<number[]>([]);

  useEffect(() => {
    if (open) {
      setForm(defaultForm(task));
      setNewSubtask('');
      setError('');
      setRemovedReminderIds([]);
    }
  }, [open, task]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function addSubtask() {
    const t = newSubtask.trim();
    if (!t) return;
    set('subtasks', [...form.subtasks, { id: `new-${Date.now()}`, title: t, is_done: false }]);
    setNewSubtask('');
  }

  function removeSubtask(id: string) {
    set('subtasks', form.subtasks.filter((s) => s.id !== id));
  }

  function toggleSubtask(id: string) {
    set('subtasks', form.subtasks.map((s) => s.id === id ? { ...s, is_done: !s.is_done } : s));
  }

  function addReminder() {
    const newReminder: ReminderDraft = {
      id: `new-${Date.now()}`,
      remind_at: '',
      channel: 'in_app',
    };
    set('reminders', [...form.reminders, newReminder]);
  }

  function updateReminder(id: string, patch: Partial<Pick<ReminderDraft, 'remind_at' | 'channel'>>) {
    set('reminders', form.reminders.map((r) => r.id === id ? { ...r, ...patch } : r));
  }

  function removeReminder(id: string) {
    const reminder = form.reminders.find((r) => r.id === id);
    if (reminder?.existingId) {
      setRemovedReminderIds((prev) => [...prev, reminder.existingId!]);
    }
    set('reminders', form.reminders.filter((r) => r.id !== id));
  }

  async function handleSave() {
    if (!form.title.trim()) { setError('Title is required'); return; }
    const incompleteReminder = form.reminders.find((r) => !r.remind_at);
    if (incompleteReminder) { setError('All reminders need a date and time'); return; }

    setSaving(true);
    setError('');
    try {
      await onSave({
        title: form.title.trim(),
        notes: form.notes.trim() || null,
        priority: form.priority,
        due_date: form.due_date || null,
        due_time: form.due_time || null,
        recurrence_rule: form.recurrence_rule,
        subtasks: form.subtasks.map((s) => ({ title: s.title, is_done: s.is_done })),
        reminders: form.reminders.map((r) => ({
          remind_at: new Date(r.remind_at).toISOString(),
          channel: r.channel,
          existingId: r.existingId,
        })),
        removedReminderIds,
      });
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (v) onOpenChange(true); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{task ? 'Edit Personal Task' : 'New Personal Task'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* Title */}
          <div>
            <label className="text-sm font-medium mb-1.5 block">Title <span className="text-destructive">*</span></label>
            <Input
              placeholder="What do you need to do?"
              value={form.title}
              onChange={(e) => set('title', e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
            />
          </div>

          {/* Priority */}
          <div>
            <label className="text-sm font-medium mb-1.5 block">Priority</label>
            <div className="flex gap-2">
              {(['low', 'medium', 'high'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => set('priority', p)}
                  className={cn(
                    'flex-1 py-1.5 rounded-md border text-xs font-semibold tracking-wide transition-all',
                    form.priority === p
                      ? PRIORITY_CONFIG[p].className
                      : 'border-border/60 text-muted-foreground hover:border-border'
                  )}
                >
                  {PRIORITY_CONFIG[p].label}
                </button>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-sm font-medium mb-1.5 block">Notes</label>
            <Textarea
              placeholder="Optional notes..."
              rows={3}
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
            />
          </div>

          {/* Due Date / Time */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Due Date</label>
              <Input type="date" value={form.due_date} onChange={(e) => set('due_date', e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Due Time</label>
              <Input type="time" value={form.due_time} onChange={(e) => set('due_time', e.target.value)} disabled={!form.due_date} />
            </div>
          </div>

          {/* Recurrence */}
          <div>
            <label className="text-sm font-medium mb-1.5 flex items-center gap-1.5">
              <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
              Repeat
            </label>
            <Select value={form.recurrence_rule} onValueChange={(v) => set('recurrence_rule', v as PersonalRecurrence)}>
              <SelectTrigger className="text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No repeat</SelectItem>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
              </SelectContent>
            </Select>
            {form.recurrence_rule !== 'none' && !form.due_date && (
              <p className="text-xs text-warning mt-1">Set a due date so the next occurrence can be scheduled.</p>
            )}
          </div>

          {/* Subtasks */}
          <div>
            <label className="text-sm font-medium mb-1.5 block">Subtasks</label>
            <div className="space-y-1.5 mb-2">
              {form.subtasks.map((s) => (
                <div key={s.id} className="flex items-center gap-2 group">
                  <Checkbox
                    checked={s.is_done}
                    onCheckedChange={() => toggleSubtask(s.id)}
                    className="shrink-0"
                  />
                  <span className={cn('flex-1 text-sm', s.is_done && 'line-through text-muted-foreground')}>
                    {s.title}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeSubtask(s.id)}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="Add a subtask..."
                value={newSubtask}
                onChange={(e) => setNewSubtask(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSubtask(); } }}
                className="text-sm"
              />
              <Button type="button" variant="outline" size="sm" onClick={addSubtask} disabled={!newSubtask.trim()}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Reminders */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium flex items-center gap-1.5">
                <Bell className="h-3.5 w-3.5 text-muted-foreground" />
                Reminders
              </label>
              <Button type="button" variant="outline" size="sm" onClick={addReminder} className="h-7 text-xs px-2">
                <Plus className="h-3.5 w-3.5 mr-1" /> Add
              </Button>
            </div>
            {form.reminders.length === 0 && (
              <p className="text-xs text-muted-foreground pl-0.5">No reminders — click Add to set one.</p>
            )}
            <div className="space-y-2">
              {form.reminders.map((r) => (
                <div key={r.id} className="flex items-end gap-2 p-2.5 rounded-md border border-border/50 bg-muted/30">
                  <div className="flex-1 min-w-0">
                    <label className="text-xs text-muted-foreground mb-1 block">Date &amp; Time</label>
                    <Input
                      type="datetime-local"
                      value={r.remind_at}
                      onChange={(e) => updateReminder(r.id, { remind_at: e.target.value })}
                      className="text-xs h-8"
                    />
                  </div>
                  <div className="w-36">
                    <label className="text-xs text-muted-foreground mb-1 block">Channel</label>
                    <Select value={r.channel} onValueChange={(v) => updateReminder(r.id, { channel: v as ReminderDraft['channel'] })}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(CHANNEL_LABELS).map(([val, lbl]) => (
                          <SelectItem key={val} value={val}>{lbl}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeReminder(r.id)}
                    className="text-muted-foreground hover:text-destructive mb-0.5 shrink-0"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !form.title.trim()}>
            {saving ? 'Saving...' : task ? 'Save Changes' : 'Create Task'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
