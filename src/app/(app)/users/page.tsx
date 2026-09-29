'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw, Search, UserPlus } from 'lucide-react';
import toast from 'react-hot-toast';
import { PageHeader } from '@/components/shared/PageHeader';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { UserTable } from '@/components/users/UserTable';
import { UserEditModal } from '@/components/users/UserEditModal';
import { UserCreateModal } from '@/components/users/UserCreateModal';
import type { Company, Department, Designation, DeptCompanyMap, DesigCompanyHeadMap, PaginatedResponse, User } from '@/types';

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editUser, setEditUser] = useState<User | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<User | null>(null);
  const [saving, setSaving] = useState(false);
  const [ldapSyncingAll, setLdapSyncingAll] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [designations, setDesignations] = useState<Designation[]>([]);
  const [deptCompanyMap, setDeptCompanyMap] = useState<DeptCompanyMap[]>([]);
  const [desigCompanyHeadMap, setDesigCompanyHeadMap] = useState<DesigCompanyHeadMap[]>([]);

  const openEditUser = async (user: User) => {
    try {
      const res = await fetch(`/api/users/${user.id}`);
      const data = await res.json();
      if (!data.success) {
        toast.error(data.error || 'Failed to load user details');
        return;
      }
      setEditUser(data.data as User);
    } catch {
      toast.error('Failed to load user details');
    }
  };

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (search) {
        params.set('search', search);
      }
      const res = await fetch(`/api/users?${params}`);
      const data = await res.json();
      if (data.success) {
        const p = data.data as PaginatedResponse<User>;
        setUsers(p.items);
        setTotal(p.total);
        setTotalPages(p.totalPages);
      }
    } catch {
      toast.error('Failed to fetch users');
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  useEffect(() => {
    Promise.all([
      fetch('/api/org/companies').then((r) => r.json()),
      fetch('/api/org/departments').then((r) => r.json()),
      fetch('/api/org/designations').then((r) => r.json()),
      fetch('/api/org/mappings').then((r) => r.json()),
    ]).then(([c, d, dg, m]) => {
      setCompanies(c.data || []);
      setDepartments(d.data || []);
      setDesignations(dg.data || []);
      setDeptCompanyMap(m.data?.deptCompany || []);
      setDesigCompanyHeadMap(m.data?.desigCompanyHead || []);
    });
  }, []);

  const saveEdit = async (values: {
    displayName: string;
    email: string;
    mobileNumber?: string;
    role: 'admin' | 'manager' | 'user';
    companyId?: string;
    deptId?: string;
    desigId?: string;
    isActive: boolean;
    scopeAssignments?: Array<{
      companyId: string;
      deptId?: string;
      desigId?: string;
      responsibilityType?: string;
      isPrimary?: boolean;
      isActive?: boolean;
    }>;
  }) => {
    if (!editUser) {
      return;
    }

    setSaving(true);
    try {
      const isAdminRole = values.role === 'admin';
      const res = await fetch(`/api/users/${editUser.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: values.displayName,
          email: values.email || null,
          mobileNumber: values.mobileNumber || null,
          role: values.role,
          companyId: isAdminRole ? null : (values.companyId ? parseInt(values.companyId, 10) : null),
          deptId: isAdminRole ? null : (values.deptId ? parseInt(values.deptId, 10) : null),
          desigId: isAdminRole ? null : (values.desigId ? parseInt(values.desigId, 10) : null),
          isActive: values.isActive,
          scopeAssignments: isAdminRole
            ? []
            : (values.scopeAssignments || [])
            .filter((a) => !!a.companyId)
            .map((a) => ({
              companyId: parseInt(a.companyId, 10),
              deptId: a.deptId ? parseInt(a.deptId, 10) : null,
              desigId: a.desigId ? parseInt(a.desigId, 10) : null,
              responsibilityType: a.responsibilityType || null,
              isPrimary: !!a.isPrimary,
              isActive: a.isActive !== false,
            })),
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('User updated');
        setEditUser(null);
        fetchUsers();
      } else {
        toast.error(data.error || 'Failed to update user');
      }
    } catch {
      toast.error('Failed to update user');
    } finally {
      setSaving(false);
    }
  };

  const createUser = async (values: {
    username: string;
    password: string;
    confirmPassword: string;
    displayName: string;
    email: string;
    mobileNumber?: string;
    role: 'admin' | 'manager' | 'user';
    companyId?: string;
    deptId?: string;
    desigId?: string;
    scopeAssignments?: Array<{
      companyId: string;
      deptId?: string;
      desigId?: string;
      responsibilityType?: string;
      isPrimary?: boolean;
      isActive?: boolean;
    }>;
  }) => {
    setCreating(true);
    try {
      const isAdminRole = values.role === 'admin';
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: values.username,
          password: values.password,
          displayName: values.displayName,
          email: values.email || null,
          mobileNumber: values.mobileNumber || null,
          role: values.role,
          companyId: isAdminRole ? null : (values.companyId ? parseInt(values.companyId, 10) : null),
          deptId: isAdminRole ? null : (values.deptId ? parseInt(values.deptId, 10) : null),
          desigId: isAdminRole ? null : (values.desigId ? parseInt(values.desigId, 10) : null),
          scopeAssignments: isAdminRole
            ? []
            : (values.scopeAssignments || [])
                .filter((a) => !!a.companyId)
                .map((a) => ({
                  companyId: parseInt(a.companyId, 10),
                  deptId: a.deptId ? parseInt(a.deptId, 10) : null,
                  desigId: a.desigId ? parseInt(a.desigId, 10) : null,
                  responsibilityType: a.responsibilityType || null,
                  isPrimary: !!a.isPrimary,
                  isActive: a.isActive !== false,
                })),
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('User created');
        setCreateOpen(false);
        fetchUsers();
      } else {
        toast.error(data.error || 'Failed to create user');
      }
    } catch {
      toast.error('Failed to create user');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) {
      return;
    }

    try {
      const res = await fetch(`/api/users/${confirmDelete.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        toast.success('User deleted');
        fetchUsers();
      } else {
        toast.error(data.error || 'Failed to delete user');
      }
    } catch {
      toast.error('Failed to delete user');
    } finally {
      setConfirmDelete(null);
    }
  };

  const handleSyncAllLdap = async () => {
    setLdapSyncingAll(true);
    try {
      const res = await fetch('/api/users/sync-ldap-all', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        const { summary } = data.data;
        toast.success(
          `LDAP sync complete — ${summary.synced} updated, ${summary.not_found} not found, ${summary.errors} errors`
        );
        fetchUsers();
      } else {
        toast.error(data.error || 'LDAP sync failed');
      }
    } catch {
      toast.error('LDAP sync failed');
    } finally {
      setLdapSyncingAll(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Users" subtitle="Manage user accounts" />

      <div className="flex items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search users..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="pl-9"
            id="user-search"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleSyncAllLdap}
          disabled={ldapSyncingAll}
          title="Sync display name and email from LDAP for all active LDAP users"
        >
          {ldapSyncingAll ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          Sync All from LDAP
        </Button>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <UserPlus className="h-4 w-4 mr-2" />
          Create User
        </Button>
      </div>

      <UserTable
        users={users}
        total={total}
        page={page}
        totalPages={totalPages}
        loading={loading}
        onPageChange={setPage}
        onEdit={openEditUser}
        onDelete={setConfirmDelete}
      />

      <UserEditModal
        open={!!editUser}
        user={editUser}
        companies={companies}
        departments={departments}
        designations={designations}
        deptCompanyMap={deptCompanyMap}
        desigCompanyHeadMap={desigCompanyHeadMap}
        saving={saving}
        onOpenChange={(open) => {
          if (!open) {
            setEditUser(null);
          }
        }}
        onSave={saveEdit}
      />

      <UserCreateModal
        open={createOpen}
        companies={companies}
        departments={departments}
        designations={designations}
        deptCompanyMap={deptCompanyMap}
        desigCompanyHeadMap={desigCompanyHeadMap}
        saving={creating}
        onOpenChange={setCreateOpen}
        onSave={createUser}
      />

      <ConfirmDialog
        open={!!confirmDelete}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmDelete(null);
          }
        }}
        message={`Delete user "${confirmDelete?.username}"? This action cannot be undone.`}
        onConfirm={handleDelete}
      />
    </div>
  );
}
