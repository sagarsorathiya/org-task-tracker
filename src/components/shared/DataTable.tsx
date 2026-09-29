'use client';

import React, { useState } from 'react';
import { ChevronUp, ChevronDown, ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ColumnDef, DataTableProps } from '@/types';
import { EmptyState } from './EmptyState';
import { LoadingSpinner } from './LoadingSpinner';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function DataTable<T extends Record<string, any>>({
  columns,
  data,
  total = 0,
  page = 1,
  totalPages = 1,
  pageSize = 20,
  onPageChange,
  onSort,
  sortBy,
  sortDir = 'desc',
  onRowClick,
  loading = false,
  emptyMessage = 'No data found',
  density = 'comfortable',
}: DataTableProps<T>) {
  const [localSortBy, setLocalSortBy] = useState(sortBy || '');
  const [localSortDir, setLocalSortDir] = useState<'asc' | 'desc'>(sortDir);

  const handleSort = (key: string) => {
    const newDir = localSortBy === key && localSortDir === 'asc' ? 'desc' : 'asc';
    setLocalSortBy(key);
    setLocalSortDir(newDir);
    onSort?.(key, newDir);
  };

  if (loading) {
    return <LoadingSpinner className="py-20" />;
  }

  if (data.length === 0) {
    return <EmptyState heading="Nothing here yet" description={emptyMessage} />;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className={cn('w-full', density === 'compact' ? 'text-[12px]' : density === 'spacious' ? 'text-[14px]' : 'text-[13px]')}>
            <thead className="sticky top-0 z-10">
              <tr className="border-b-2 border-border bg-muted/70">
                {columns.map((col) => (
                  <th
                    key={col.key}
                    scope="col"
                    aria-sort={col.sortable && localSortBy === col.key ? (localSortDir === 'asc' ? 'ascending' : 'descending') : undefined}
                    className={cn(
                      density === 'compact'
                        ? 'h-9 px-2.5 text-left text-[10px] uppercase tracking-widest font-medium text-muted-foreground leading-4'
                        : density === 'spacious'
                          ? 'h-12 px-4 text-left text-[10px] uppercase tracking-widest font-medium text-muted-foreground leading-5'
                          : 'h-10 px-3 text-left text-[10px] uppercase tracking-widest font-medium text-muted-foreground leading-4',
                      col.sortable && 'cursor-pointer select-none hover:text-foreground transition-colors',
                      // Intentionally NOT spreading col.className here — it's meant for body
                      // <td> styling (width, alignment, per-cell typography) and must never
                      // override the header's uniform uppercase label style. Width still
                      // applies to the column via the <td>, since the table uses the browser
                      // default table-layout (auto), which sizes columns from all cells.
                    )}
                    onClick={() => col.sortable && handleSort(col.key)}
                  >
                    <div className="flex items-center gap-1">
                      {col.header}
                      {col.sortable && localSortBy === col.key && (
                        localSortDir === 'asc' ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((row, i) => (
                <tr
                  key={(row as Record<string, unknown>).id as number || i}
                  className={cn(
                    'group border-b border-border last:border-0 transition-all duration-150 hover:bg-accent/35 row-accent',
                    onRowClick && 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset'
                  )}
                  tabIndex={onRowClick ? 0 : -1}
                  onKeyDown={(e) => {
                    if (!onRowClick) return;
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onRowClick(row);
                    }
                  }}
                  onClick={() => onRowClick?.(row)}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={cn(
                        density === 'compact'
                          ? 'px-2.5 py-2 align-middle leading-5'
                          : density === 'spacious'
                            ? 'px-4 py-3.5 align-middle leading-6'
                            : 'px-3 py-2.5 align-middle leading-5',
                        col.className
                      )}
                    >
                      {col.render ? col.render(row) : String((row as Record<string, unknown>)[col.key] ?? '—')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between px-2">
          <p className="text-sm text-muted-foreground">
            Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
          </p>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={page <= 1} onClick={() => onPageChange?.(1)}>
              <ChevronsLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={page <= 1} onClick={() => onPageChange?.(page - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="px-3 text-sm font-medium">{page} / {totalPages}</span>
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= totalPages} onClick={() => onPageChange?.(page + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= totalPages} onClick={() => onPageChange?.(totalPages)}>
              <ChevronsRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
