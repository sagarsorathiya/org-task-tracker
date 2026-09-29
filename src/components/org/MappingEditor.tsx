'use client';

import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';

interface MappingEditorProps {
  open: boolean;
  title: string;
  items: { id: number; name: string }[];
  selectedIds: number[];
  onToggle: (id: number, selected: boolean) => void;
  onSave: () => void;
  onOpenChange: (open: boolean) => void;
}

export function MappingEditor({ open, title, items, selectedIds, onToggle, onSave, onOpenChange }: MappingEditorProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <div className="space-y-2 max-h-60 overflow-y-auto">
          {items.map((item) => (
            <label key={item.id} className="flex items-center gap-2 py-1 cursor-pointer">
              <Checkbox checked={selectedIds.includes(item.id)} onCheckedChange={(c) => onToggle(item.id, !!c)} />
              <span className="text-sm">{item.name}</span>
            </label>
          ))}
        </div>
        <Button onClick={onSave} className="w-full">Save Mappings</Button>
      </DialogContent>
    </Dialog>
  );
}
