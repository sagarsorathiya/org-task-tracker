'use client';

import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Plus, Trash2, CheckSquare } from 'lucide-react';
import toast from 'react-hot-toast';
import type { Subtask } from '@/types';

interface Props { taskId: number; subtasks: Subtask[]; onRefresh: () => void; }

export function SubtasksTab({ taskId, subtasks, onRefresh }: Props) {
  const [newTitle, setNewTitle] = useState('');
  const [loading, setLoading] = useState(false);

  const doneCount = subtasks.filter((s) => s.is_done).length;
  const progress = subtasks.length > 0 ? (doneCount / subtasks.length) * 100 : 0;

  const addSubtask = async () => {
    if (!newTitle.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/subtasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle.trim() }),
      });
      const data = await res.json();
      if (data.success) { setNewTitle(''); onRefresh(); }
      else toast.error(data.error);
    } catch { toast.error('Failed'); }
    finally { setLoading(false); }
  };

  const toggleSubtask = async (sub: Subtask) => {
    try {
      await fetch(`/api/tasks/${taskId}/subtasks`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subId: sub.id, isDone: !sub.is_done }),
      });
      onRefresh();
    } catch { toast.error('Failed'); }
  };

  const deleteSubtask = async (subId: number) => {
    try {
      await fetch(`/api/tasks/${taskId}/subtasks?subId=${subId}`, { method: 'DELETE' });
      onRefresh();
    } catch { toast.error('Failed'); }
  };

  return (
    <Card className="mt-4">
      <CardContent className="p-6 space-y-4">
        <h3 className="flex items-center gap-2 font-semibold"><CheckSquare className="h-4 w-4 text-primary" aria-hidden="true" />Subtasks ({subtasks.length})</h3>
        {subtasks.length > 0 && (
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{doneCount} of {subtasks.length} complete</span>
              <span className="font-medium">{Math.round(progress)}%</span>
            </div>
            <Progress value={progress} />
          </div>
        )}

        <div className="space-y-2">
          {subtasks.map((sub) => (
            <div key={sub.id} className="flex items-center gap-3 py-2 px-3 rounded-xl border border-transparent hover:border-border hover:bg-muted/50 group transition-all duration-150">
              <Checkbox checked={sub.is_done} onCheckedChange={() => toggleSubtask(sub)} />
              <span className={sub.is_done ? 'line-through text-muted-foreground flex-1' : 'flex-1'}>{sub.title}</span>
              <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100 text-destructive" onClick={() => deleteSubtask(sub.id)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>

        <div className="flex gap-2 pt-2">
          <Input
            placeholder="Add subtask..."
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addSubtask()}
            id="add-subtask-input"
          />
          <Button onClick={addSubtask} disabled={loading || !newTitle.trim()} size="icon" id="add-subtask-btn">
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
