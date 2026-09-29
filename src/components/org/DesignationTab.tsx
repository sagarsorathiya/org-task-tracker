'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Pencil, Trash2, Plus, Link2, Crown } from 'lucide-react';
import type { Designation } from '@/types';

interface Props {
  designations: Designation[];
  addName: string;
  onAddNameChange: (v: string) => void;
  onAdd: () => void;
  onEdit: (item: Designation) => void;
  onDelete: (id: number) => void;
  onMapDepartments: (item: Designation) => void;
  onMapCompanyHead: (item: Designation) => void;
}

export function DesignationTab({
  designations,
  addName,
  onAddNameChange,
  onAdd,
  onEdit,
  onDelete,
  onMapDepartments,
  onMapCompanyHead,
}: Props) {
  return (
    <Card>
      <CardContent className="p-6 space-y-4">
        <div className="flex gap-2">
          <Input placeholder="Name" value={addName} onChange={(e) => onAddNameChange(e.target.value)} className="flex-1" />
          <Button onClick={onAdd} className="gap-1.5"><Plus className="h-4 w-4" /> Add</Button>
        </div>
        <div className="space-y-1">
          {designations.map((item) => (
            <div key={item.id} className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-muted/60 group">
              <span className="flex-1 text-sm font-medium">{item.name}</span>
              <Badge variant={item.active ? 'success' : 'secondary'}>{item.active ? 'Active' : 'Inactive'}</Badge>
              <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100" title="Map to Departments" onClick={() => onMapDepartments(item)}><Link2 className="h-3.5 w-3.5" /></Button>
              <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100" title="Map as Company Head" onClick={() => onMapCompanyHead(item)}><Crown className="h-3.5 w-3.5" /></Button>
              <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100" onClick={() => onEdit(item)}><Pencil className="h-3.5 w-3.5" /></Button>
              <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100 text-destructive" onClick={() => onDelete(item.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
