'use client';

import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, Zap } from 'lucide-react';
import { CHANNEL_OPTIONS } from '@/constants';
import { formatDateTime } from '@/lib/utils';
import { useSession } from 'next-auth/react';
import toast from 'react-hot-toast';
import type { ReminderRule } from '@/types';

interface Props { taskId: number; reminders: ReminderRule[]; onRefresh: () => void; }

export function RemindersTab({ taskId, reminders, onRefresh }: Props) {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === 'admin';
  const [remindAt, setRemindAt] = useState('');
  const [channel, setChannel] = useState('email');
  const [loading, setLoading] = useState(false);
  const minRemindAt = React.useMemo(() => {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  }, []);

  const addRule = async () => {
    if (!remindAt) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/reminders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remindAt: new Date(remindAt).toISOString(), channel }),
      });
      const data = await res.json();
      if (data.success) { setRemindAt(''); onRefresh(); toast.success('Reminder rule added'); }
      else toast.error(data.error);
    } catch { toast.error('Failed'); }
    finally { setLoading(false); }
  };

  const deleteRule = async (ruleId: number) => {
    try {
      await fetch(`/api/tasks/${taskId}/reminders?ruleId=${ruleId}`, { method: 'DELETE' });
      onRefresh();
    } catch { toast.error('Failed'); }
  };

  const triggerNow = async () => {
    try {
      const res = await fetch('/api/reminders/trigger?force=true', { method: 'POST' });
      const data = await res.json();
      if (data.success) toast.success(`Sent: ${data.data.sent}, Failed: ${data.data.failed}`);
      else toast.error(data.error);
    } catch { toast.error('Failed'); }
  };

  const channelBadge = (ch: string) => {
    const variant = ch === 'email' ? 'info' : ch === 'whatsapp' ? 'success' : 'warning';
    return <Badge variant={variant as 'info' | 'success' | 'warning'}>{ch}</Badge>;
  };

  return (
    <Card className="mt-4">
      <CardContent className="p-6 space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="flex items-center gap-2 font-semibold"><span className="h-4 w-1 rounded-full bg-primary" aria-hidden="true" />Reminder Rules</h3>
          {isAdmin && (
            <Button variant="outline" size="sm" onClick={triggerNow} className="gap-1.5" id="trigger-reminders">
              <Zap className="h-3.5 w-3.5" /> Trigger Now
            </Button>
          )}
        </div>

        {reminders.length === 0 && (
          <p className="text-muted-foreground text-sm text-center py-4">No reminder rules</p>
        )}

        <div className="space-y-2">
          {reminders.map((r) => (
            <div key={r.id} className="flex items-center gap-3 py-2 px-3 rounded-xl border border-transparent hover:border-border hover:bg-muted/50 group transition-all duration-150">
              <span className="text-sm flex-1">
                {r.remind_at
                  ? `Reminder at ${formatDateTime(r.remind_at)}`
                  : `${r.offset_days} days before due date`}
              </span>
              {channelBadge(r.channel)}
              <Badge variant={r.is_active ? 'success' : 'secondary'}>{r.is_active ? 'Active' : 'Inactive'}</Badge>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive opacity-0 group-hover:opacity-100" onClick={() => deleteRule(r.id)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>

        <div className="flex gap-2 pt-2 border-t">
          <Input
            type="datetime-local"
            placeholder="Select reminder date & time"
            value={remindAt}
            onChange={(e) => setRemindAt(e.target.value)}
            className="w-64"
            id="reminder-at"
            min={minRemindAt}
          />
          <Select value={channel} onValueChange={setChannel}>
            <SelectTrigger className="w-32" id="reminder-channel"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CHANNEL_OPTIONS.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button onClick={addRule} disabled={loading || !remindAt} className="gap-1.5" id="add-reminder-btn">
            <Plus className="h-4 w-4" /> Add
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
