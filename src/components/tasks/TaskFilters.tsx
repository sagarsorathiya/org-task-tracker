'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Search, RotateCcw, X, User, Building2, Trash2 } from 'lucide-react';
import { STATUS_OPTIONS, PRIORITY_OPTIONS } from '@/constants';
import { cn } from '@/lib/utils';

interface TaskFiltersProps {
  search: string; onSearchChange: (v: string) => void;
  status: string; onStatusChange: (v: string) => void;
  priority: string; onPriorityChange: (v: string) => void;
  assignToMe: boolean; onAssignToMeChange: (v: boolean) => void;
  departmentOnly: boolean; onDepartmentOnlyChange: (v: boolean) => void;
  canFilterDepartment: boolean;
  hideDepartmentOption?: boolean;
  showDeleted: boolean; onShowDeletedChange: (v: boolean) => void;
  isAdmin: boolean;
  onReset: () => void;
  endSlot?: React.ReactNode;
}

export function TaskFilters({
  search, onSearchChange, status, onStatusChange,
  priority, onPriorityChange,
  assignToMe, onAssignToMeChange,
  departmentOnly, onDepartmentOnlyChange, canFilterDepartment, hideDepartmentOption,
  showDeleted, onShowDeletedChange, isAdmin, onReset, endSlot,
}: TaskFiltersProps) {
  const [localSearch, setLocalSearch] = useState(search);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (search === '') setLocalSearch('');
  }, [search]);

  const handleSearchChange = (value: string) => {
    setLocalSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onSearchChange(value), 350);
  };

  const activeStatusLabel   = status   && status   !== 'all' ? STATUS_OPTIONS.find((s) => s.value === status)?.label : null;
  const activePriorityLabel = priority && priority !== 'all' ? PRIORITY_OPTIONS.find((p) => p.value === priority)?.label : null;
  const hasActiveChips = activeStatusLabel || activePriorityLabel || assignToMe
    || (departmentOnly && canFilterDepartment && !hideDepartmentOption)
    || (isAdmin && showDeleted);

  const sep = <div className="h-5 w-px bg-border shrink-0" />;

  const toggleButtons = (
    <div className="flex items-center px-1 gap-0.5 shrink-0">
      <button
        id="filter-assigned-to-me"
        type="button"
        title="Assigned to me"
        onClick={() => onAssignToMeChange(!assignToMe)}
        className={cn(
          'h-7 w-7 rounded-md flex items-center justify-center transition-colors',
          assignToMe
            ? 'bg-primary/15 text-primary'
            : 'text-muted-foreground hover:bg-card hover:text-foreground'
        )}
      >
        <User className="h-3.5 w-3.5" />
      </button>

      {canFilterDepartment && !hideDepartmentOption && (
        <button
          id="filter-department-only"
          type="button"
          title="Department only"
          onClick={() => onDepartmentOnlyChange(!departmentOnly)}
          className={cn(
            'h-7 w-7 rounded-md flex items-center justify-center transition-colors',
            departmentOnly
              ? 'bg-primary/15 text-primary'
              : 'text-muted-foreground hover:bg-card hover:text-foreground'
          )}
        >
          <Building2 className="h-3.5 w-3.5" />
        </button>
      )}

      {isAdmin && (
        <button
          id="filter-deleted"
          type="button"
          title="Show deleted"
          onClick={() => onShowDeletedChange(!showDeleted)}
          className={cn(
            'h-7 w-7 rounded-md flex items-center justify-center transition-colors',
            showDeleted
              ? 'bg-destructive/15 text-destructive'
              : 'text-muted-foreground hover:bg-card hover:text-foreground'
          )}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}

      <button
        id="filter-reset"
        type="button"
        title="Reset filters"
        onClick={onReset}
        className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:bg-card hover:text-foreground transition-colors"
      >
        <RotateCcw className="h-3.5 w-3.5" />
      </button>

      {endSlot && (
        <>
          {sep}
          <div className="px-1.5 shrink-0">{endSlot}</div>
        </>
      )}
    </div>
  );

  return (
    <div className="space-y-2">
      {/* ── Desktop (md+): single connected pill ── */}
      <div className="hidden md:flex items-center rounded-xl glass-subtle overflow-hidden h-10 transition-shadow duration-200 focus-within:ring-[3px] focus-within:ring-primary/10">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <input
            id="task-search"
            type="text"
            placeholder="Search tasks..."
            value={localSearch}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="h-10 w-full bg-transparent pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground text-foreground"
          />
        </div>

        {sep}

        <Select value={status || 'all'} onValueChange={onStatusChange}>
          <SelectTrigger id="filter-status" className="h-10 w-[130px] rounded-none border-0 bg-transparent shadow-none focus:ring-0 text-sm">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            {STATUS_OPTIONS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>

        {sep}

        <Select value={priority || 'all'} onValueChange={onPriorityChange}>
          <SelectTrigger id="filter-priority" className="h-10 w-[130px] rounded-none border-0 bg-transparent shadow-none focus:ring-0 text-sm">
            <SelectValue placeholder="Priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Priority</SelectItem>
            {PRIORITY_OPTIONS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
          </SelectContent>
        </Select>

        {sep}
        {toggleButtons}
      </div>

      {/* ── Mobile / small screens: two stacked pills ── */}
      <div className="flex flex-col gap-1.5 md:hidden">
        {/* Row 1: Search */}
        <div className="flex items-center rounded-xl glass-subtle overflow-hidden h-10 transition-shadow duration-200 focus-within:ring-[3px] focus-within:ring-primary/10">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              placeholder="Search tasks..."
              value={localSearch}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="h-10 w-full bg-transparent pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground text-foreground"
            />
          </div>
        </div>

        {/* Row 2: Selects + buttons */}
        <div className="flex items-center rounded-xl glass-subtle overflow-hidden h-10">
          <Select value={status || 'all'} onValueChange={onStatusChange}>
            <SelectTrigger className="h-10 flex-1 rounded-none border-0 bg-transparent shadow-none focus:ring-0 text-sm">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              {STATUS_OPTIONS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>

          {sep}

          <Select value={priority || 'all'} onValueChange={onPriorityChange}>
            <SelectTrigger className="h-10 flex-1 rounded-none border-0 bg-transparent shadow-none focus:ring-0 text-sm">
              <SelectValue placeholder="Priority" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Priority</SelectItem>
              {PRIORITY_OPTIONS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
            </SelectContent>
          </Select>

          {sep}
          {toggleButtons}
        </div>
      </div>

      {/* Active filter chips */}
      {hasActiveChips && (
        <div className="flex flex-wrap items-center gap-1.5 px-1">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Filters:</span>
          {activeStatusLabel && (
            <button
              type="button"
              onClick={() => onStatusChange('all')}
              className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/15 transition-colors"
            >
              {activeStatusLabel} <X className="h-3 w-3" />
            </button>
          )}
          {activePriorityLabel && (
            <button
              type="button"
              onClick={() => onPriorityChange('all')}
              className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/15 transition-colors"
            >
              {activePriorityLabel} <X className="h-3 w-3" />
            </button>
          )}
          {assignToMe && (
            <button type="button" onClick={() => onAssignToMeChange(false)}
              className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/15 transition-colors">
              Assigned to me <X className="h-3 w-3" />
            </button>
          )}
          {departmentOnly && canFilterDepartment && !hideDepartmentOption && (
            <button type="button" onClick={() => onDepartmentOnlyChange(false)}
              className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/15 transition-colors">
              Department only <X className="h-3 w-3" />
            </button>
          )}
          {isAdmin && showDeleted && (
            <button type="button" onClick={() => onShowDeletedChange(false)}
              className="inline-flex items-center gap-1 rounded-full border border-destructive/25 bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive hover:bg-destructive/15 transition-colors">
              Showing deleted <X className="h-3 w-3" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
