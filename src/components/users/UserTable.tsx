'use client';

import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Pencil, Trash2 } from 'lucide-react';
import { DataTable } from '@/components/shared/DataTable';
import { formatDate, formatSystemRole } from '@/lib/utils';
import type { ColumnDef, User } from '@/types';

interface UserTableProps {
  users: User[];
  total: number;
  page: number;
  totalPages: number;
  loading: boolean;
  onPageChange: (page: number) => void;
  onEdit: (user: User) => void;
  onDelete: (user: User) => void;
}

export function UserTable({ users, total, page, totalPages, loading, onPageChange, onEdit, onDelete }: UserTableProps) {
  const columns: ColumnDef<User>[] = [
    { key: 'username', header: 'Username', render: (r) => <span className="font-medium">{r.username}</span> },
    { key: 'display_name', header: 'Display Name', render: (r) => r.display_name || '—' },
    { key: 'email', header: 'Email', render: (r) => r.email || '—' },
    { key: 'mobile_number', header: 'Mobile Number', render: (r) => r.mobile_number || '—' },
    { key: 'company_name', header: 'Company', render: (r) => r.company_name || '—' },
    { key: 'dept_name', header: 'Department', render: (r) => r.dept_name || '—' },
    { key: 'desig_name', header: 'Designation', render: (r) => r.desig_name || '—' },
    {
      key: 'role',
      header: 'Role',
      render: (r) => (
        <Badge variant={r.role === 'admin' ? 'default' : r.role === 'manager' ? 'warning' : 'secondary'}>
          {formatSystemRole(r.role)}
        </Badge>
      ),
    },
    { key: 'is_active', header: 'Status', render: (r) => <Badge variant={r.is_active ? 'success' : 'destructive'}>{r.is_active ? 'Active' : 'Inactive'}</Badge> },
    { key: 'last_login_at', header: 'Last Login', render: (r) => formatDate(r.last_login_at) },
    {
      key: 'actions',
      header: '',
      className: 'w-24',
      render: (r) => (
        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEdit(r)}><Pencil className="h-3.5 w-3.5" /></Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => onDelete(r)}><Trash2 className="h-3.5 w-3.5" /></Button>
        </div>
      ),
    },
  ];

  return <DataTable columns={columns} data={users} total={total} page={page} totalPages={totalPages} loading={loading} onPageChange={onPageChange} />;
}
