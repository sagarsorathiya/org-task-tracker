'use client';

import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { ROLE_OPTIONS } from '@/constants';
import { Loader2, RefreshCw } from 'lucide-react';
import type { Company, Department, Designation, DeptCompanyMap, DesigCompanyHeadMap, User } from '@/types';

const schema = z.object({
  displayName: z.string().max(200),
  email: z.string().email().or(z.literal('')),
  mobileNumber: z.string().max(20).optional().or(z.literal('')),
  role: z.enum(['admin', 'manager', 'user']),
  companyId: z.string().optional(),
  deptId: z.string().optional(),
  desigId: z.string().optional(),
  isActive: z.boolean().default(true),
});

type FormValues = z.infer<typeof schema>;

interface UserEditModalProps {
  open: boolean;
  user: User | null;
  companies: Company[];
  departments: Department[];
  designations: Designation[];
  deptCompanyMap: DeptCompanyMap[];
  desigCompanyHeadMap: DesigCompanyHeadMap[];
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (values: FormValues & {
    scopeAssignments?: Array<{
      companyId: string;
      deptId?: string;
      desigId?: string;
      responsibilityType?: string;
      isPrimary?: boolean;
      isActive?: boolean;
    }>;
  }) => void;
}

type EditableScopeAssignment = {
  id: string;
  companyId: string;
  deptId: string;
  desigId: string;
  responsibility: string;
  responsibilityType: string;
  isPrimary: boolean;
  isActive: boolean;
};

const RESPONSIBILITY_OPTIONS = [
  { value: 'department_head', label: 'Department Head' },
  { value: 'company_head', label: 'Company Head' },
  { value: 'ceo', label: 'CEO' },
  { value: 'executive_director', label: 'Executive Director' },
  { value: '__custom__', label: 'Custom' },
] as const;

export function UserEditModal({
  open,
  user,
  companies,
  departments,
  designations,
  deptCompanyMap,
  desigCompanyHeadMap,
  saving,
  onOpenChange,
  onSave,
}: UserEditModalProps) {
  const [ldapSyncing, setLdapSyncing] = React.useState(false);

  const handleLdapSync = async () => {
    if (!user) return;
    setLdapSyncing(true);
    try {
      const res = await fetch(`/api/users/${user.id}/sync-ldap`, { method: 'POST' });
      const data = await res.json();
      if (!data.success) {
        alert(data.error || 'LDAP sync failed');
        return;
      }
      const { user: updated, synced } = data.data as { user: { display_name: string; email: string }; synced: string[] };
      if (synced.includes('display_name')) form.setValue('displayName', updated.display_name || '');
      if (synced.includes('email')) form.setValue('email', updated.email || '');
      if (synced.length === 0) {
        alert('LDAP returned no displayName or email for this user.');
      }
    } catch {
      alert('Failed to reach server. Please try again.');
    } finally {
      setLdapSyncing(false);
    }
  };

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    values: {
      displayName: user?.display_name || '',
      email: user?.email || '',
      mobileNumber: user?.mobile_number || '',
      role: user?.role || 'user',
      companyId: user?.company_id ? String(user.company_id) : '',
      deptId: user?.dept_id ? String(user.dept_id) : '',
      desigId: user?.desig_id ? String(user.desig_id) : '',
      isActive: user?.is_active ?? true,
    },
  });

  const [assignments, setAssignments] = React.useState<EditableScopeAssignment[]>([]);
  const [assignmentError, setAssignmentError] = React.useState<string>('');
  const isAdminSelected = form.watch('role') === 'admin';

  const normalizeResponsibility = React.useCallback((value?: string) => (value || '').trim().toLowerCase(), []);
  const hasCompanyHeadDesignationMap = React.useCallback((companyId?: string, desigId?: string) => {
    if (!companyId || !desigId) return false;
    return desigCompanyHeadMap.some((m) => String(m.company_id) === companyId && String(m.desig_id) === desigId);
  }, [desigCompanyHeadMap]);

  const topLevelCompanyId = form.watch('companyId') || '';
  const topLevelDesigId = form.watch('desigId') || '';
  const isCompanyHeadByDesignation = hasCompanyHeadDesignationMap(topLevelCompanyId, topLevelDesigId);
  const isCompanyHeadPrimary = React.useMemo(() => {
    const primary = assignments.find((a) => a.isPrimary && a.isActive);
    if (!primary) return false;
    const resolved = primary.responsibility === '__custom__' ? primary.responsibilityType : primary.responsibility;
    return normalizeResponsibility(resolved) === 'company_head' || hasCompanyHeadDesignationMap(primary.companyId, primary.desigId);
  }, [assignments, normalizeResponsibility, hasCompanyHeadDesignationMap]);

  React.useEffect(() => {
    if (!isCompanyHeadPrimary && !isCompanyHeadByDesignation) return;
    if (form.getValues('deptId')) {
      form.setValue('deptId', '');
    }
  }, [isCompanyHeadPrimary, isCompanyHeadByDesignation, form]);

  React.useEffect(() => {
    if (!open) return;

    const fromUser = (user?.scope_assignments || []).map((a) => ({
      id: String(a.id),
      companyId: String(a.company_id),
      deptId: a.dept_id ? String(a.dept_id) : '',
      desigId: a.desig_id ? String(a.desig_id) : '',
      responsibility: a.responsibility_type && RESPONSIBILITY_OPTIONS.some((o) => o.value === a.responsibility_type)
        ? a.responsibility_type
        : (a.responsibility_type ? '__custom__' : ''),
      responsibilityType: a.responsibility_type && RESPONSIBILITY_OPTIONS.some((o) => o.value === a.responsibility_type)
        ? ''
        : (a.responsibility_type || ''),
      isPrimary: !!a.is_primary,
      isActive: a.is_active !== false,
    }));

    if (fromUser.length > 0) {
      setAssignments(fromUser);
      return;
    }

    setAssignments([
      {
        id: 'primary',
        companyId: user?.company_id ? String(user.company_id) : '',
        deptId: user?.dept_id ? String(user.dept_id) : '',
        desigId: user?.desig_id ? String(user.desig_id) : '',
        responsibility: '',
        responsibilityType: '',
        isPrimary: true,
        isActive: true,
      },
    ]);
  }, [open, user]);

  const addAssignment = () => {
    setAssignmentError('');
    setAssignments((prev) => [
      ...prev,
      {
        id: `new-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        companyId: '',
        deptId: '',
        desigId: '',
        responsibility: '',
        responsibilityType: '',
        isPrimary: prev.length === 0,
        isActive: true,
      },
    ]);
  };

  const removeAssignment = (id: string) => {
    setAssignmentError('');
    setAssignments((prev) => {
      const filtered = prev.filter((a) => a.id !== id);
      if (filtered.length > 0 && !filtered.some((a) => a.isPrimary)) {
        filtered[0].isPrimary = true;
      }
      return filtered;
    });
  };

  const updateAssignment = (id: string, patch: Partial<EditableScopeAssignment>) => {
    setAssignmentError('');
    setAssignments((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  };

  const setPrimaryAssignment = (id: string) => {
    setAssignmentError('');
    setAssignments((prev) => prev.map((a) => ({ ...a, isPrimary: a.id === id })));
  };

  const submit = form.handleSubmit((values) => {
    if (values.role === 'admin') {
      setAssignmentError('');
      onSave({
        ...values,
        companyId: '',
        deptId: '',
        desigId: '',
        scopeAssignments: [],
      });
      return;
    }

    const scopeAssignments = assignments
      .filter((a) => !!a.companyId)
      .map((a) => {
        const responsibilityType = (a.responsibility === '__custom__' ? a.responsibilityType.trim() : a.responsibility) || undefined;
        const isCompanyHead = normalizeResponsibility(responsibilityType) === 'company_head';
        return {
          companyId: a.companyId,
          deptId: isCompanyHead ? undefined : (a.deptId || undefined),
          desigId: a.desigId || undefined,
          responsibilityType,
          isPrimary: a.isPrimary,
          isActive: a.isActive,
        };
      });

    // Keep primary assignment aligned with the top-level user company/department/designation fields.
    // Only override deptId/desigId if the top-level field actually has a value — otherwise preserve
    // whatever the assignment row already has (prevents blanking out a dept that is set in the
    // scope assignment but not reflected in the hidden/empty top-level dropdown).
    const primaryIndex = scopeAssignments.findIndex((a) => a.isPrimary && a.isActive !== false);
    if (primaryIndex >= 0) {
      scopeAssignments[primaryIndex] = {
        ...scopeAssignments[primaryIndex],
        companyId: values.companyId || scopeAssignments[primaryIndex].companyId,
        deptId: values.deptId ? values.deptId : scopeAssignments[primaryIndex].deptId,
        desigId: values.desigId ? values.desigId : scopeAssignments[primaryIndex].desigId,
      };
    }

    if (scopeAssignments.length === 0) {
      setAssignmentError('Add at least one assignment with a company.');
      return;
    }

    const activeAssignments = scopeAssignments.filter((a) => a.isActive !== false);
    if (activeAssignments.length === 0) {
      setAssignmentError('At least one assignment must be active.');
      return;
    }

    const activePrimaryCount = activeAssignments.filter((a) => a.isPrimary).length;
    if (activePrimaryCount !== 1) {
      setAssignmentError('Exactly one active assignment must be marked Primary.');
      return;
    }

    const mappedPairs = new Set(deptCompanyMap.map((m) => `${m.company_id}:${m.dept_id}`));
    const hasInvalidMapping = scopeAssignments.some((a) => {
      if (!a.deptId) return false;
      return !mappedPairs.has(`${a.companyId}:${a.deptId}`);
    });
    if (hasInvalidMapping) {
      setAssignmentError('One or more rows have an invalid company-department combination.');
      return;
    }

    setAssignmentError('');

    onSave({ ...values, scopeAssignments });
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl flex flex-col max-h-[90vh] overflow-hidden">
        <DialogHeader className="shrink-0">
          <div className="flex items-center justify-between gap-2">
            <DialogTitle>Edit User</DialogTitle>
            {user?.auth_type === 'ldap' && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleLdapSync}
                disabled={ldapSyncing || saving}
                className="shrink-0"
              >
                {ldapSyncing
                  ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Syncing…</>
                  : <><RefreshCw className="h-3.5 w-3.5 mr-1.5" />Sync from LDAP</>}
              </Button>
            )}
          </div>
          <DialogDescription>
            Update profile details and configure multi-company, multi-department assignment scopes.
            {user?.auth_type === 'ldap' && ' Use "Sync from LDAP" to pull the latest email and display name.'}
          </DialogDescription>
        </DialogHeader>
        <form className="flex-1 overflow-y-auto space-y-4 py-2 pr-3" onSubmit={submit}>
          <div className="space-y-2"><label className="text-sm font-medium">Display Name</label><Input {...form.register('displayName')} /></div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2"><label className="text-sm font-medium">Email</label><Input {...form.register('email')} /></div>
            <div className="space-y-2"><label className="text-sm font-medium">Mobile Number</label><Input {...form.register('mobileNumber')} /></div>
          </div>
          {!isAdminSelected && (
            <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">System Role</label>
              <Select value={form.watch('role')} onValueChange={(v) => form.setValue('role', v as FormValues['role'])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{ROLE_OPTIONS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">System Role controls app-level permissions. Department/company leadership comes from assignment responsibilities below.</p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Company</label>
              <Select value={form.watch('companyId') || ''} onValueChange={(v) => form.setValue('companyId', v)}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>{companies.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.code}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            </div>
          )}

          {isAdminSelected && (
            <div className="space-y-2">
              <label className="text-sm font-medium">System Role</label>
              <Select value={form.watch('role')} onValueChange={(v) => form.setValue('role', v as FormValues['role'])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{ROLE_OPTIONS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Admin is global and does not carry company, department, designation or assignment scope.</p>
            </div>
          )}

          {!isAdminSelected && (
            <>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Designation</label>
              <Select
                value={form.watch('desigId') || ''}
                onValueChange={(v) => {
                  form.setValue('desigId', v);
                  const selectedCompany = form.getValues('companyId') || '';
                  if (hasCompanyHeadDesignationMap(selectedCompany, v)) {
                    form.setValue('deptId', '');
                  }
                }}
              >
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>{designations.map((d) => <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {!isCompanyHeadPrimary && !isCompanyHeadByDesignation && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Department</label>
                <Select value={form.watch('deptId') || '__none__'} onValueChange={(v) => form.setValue('deptId', v === '__none__' ? '' : v)}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">All Departments</SelectItem>
                    {departments.map((d) => <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Head/lead visibility comes from assignment rows below.
                </p>
              </div>
            )}
          </div>

          <div className="space-y-3 rounded-xl border border-border bg-muted p-4">
            <div className="flex items-center justify-between">
              <label className="text-base font-semibold">Multi-Company / Multi-Department Assignments</label>
              <Button type="button" variant="outline" size="sm" onClick={addAssignment}>Add Assignment</Button>
            </div>
            <p className="text-sm text-muted-foreground">
              Use this section to map additional charges (CEO, department head, etc.) for the same user across companies/departments.
            </p>

            {assignmentError && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {assignmentError}
              </div>
            )}

            <div className="space-y-3">
              {assignments.map((assignment, index) => (
                (() => {
                  const mappedDeptIds = new Set(
                    deptCompanyMap
                      .filter((m) => String(m.company_id) === assignment.companyId)
                      .map((m) => String(m.dept_id))
                  );
                  const allowedDepartments = assignment.companyId
                    ? departments.filter((d) => mappedDeptIds.has(String(d.id)))
                    : departments;
                  const hasInvalidDept = !!assignment.companyId
                    && !!assignment.deptId
                    && !mappedDeptIds.has(assignment.deptId);
                  const resolvedRowResponsibility = assignment.responsibility === '__custom__'
                    ? assignment.responsibilityType
                    : assignment.responsibility;
                  const isCompanyHeadRow = normalizeResponsibility(resolvedRowResponsibility) === 'company_head'
                    || hasCompanyHeadDesignationMap(assignment.companyId, assignment.desigId);

                  return (
                <div key={assignment.id} className="space-y-3 rounded-lg border border-border/60 bg-background p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Assignment {index + 1}</p>
                    <Button type="button" variant="ghost" size="sm" onClick={() => removeAssignment(assignment.id)} disabled={assignments.length <= 1 && index === 0}>
                      Remove
                    </Button>
                  </div>

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">Company</label>
                      <Select value={assignment.companyId || '__none__'} onValueChange={(v) => updateAssignment(assignment.id, { companyId: v === '__none__' ? '' : v })}>
                        <SelectTrigger><SelectValue placeholder="Select Company" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Select Company</SelectItem>
                          {companies.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.code}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">Designation</label>
                      <Select
                        value={assignment.desigId || '__none__'}
                        onValueChange={(v) => {
                          const nextDesigId = v === '__none__' ? '' : v;
                          updateAssignment(assignment.id, {
                            desigId: nextDesigId,
                            deptId: hasCompanyHeadDesignationMap(assignment.companyId, nextDesigId) ? '' : assignment.deptId,
                          });
                        }}
                      >
                        <SelectTrigger><SelectValue placeholder="Designation" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">No Designation</SelectItem>
                          {designations.map((d) => <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">Department</label>
                      <Select
                        value={assignment.deptId || '__all__'}
                        onValueChange={(v) => updateAssignment(assignment.id, { deptId: v === '__all__' ? '' : v })}
                        disabled={isCompanyHeadRow}
                      >
                        <SelectTrigger><SelectValue placeholder="Department" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__all__">All Departments</SelectItem>
                          {allowedDepartments.map((d) => <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      {isCompanyHeadRow && (
                        <p className="text-xs text-muted-foreground">Company Head is company-wide; department is not required.</p>
                      )}
                      {!isCompanyHeadRow && hasInvalidDept && (
                        <p className="text-xs text-destructive">Selected department is not mapped to this company.</p>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    <div className="space-y-1.5 md:col-span-2">
                      <label className="text-xs font-medium text-muted-foreground">Responsibility</label>
                      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                        <Select
                          value={assignment.responsibility || '__none__'}
                          onValueChange={(v) => {
                            const nextResponsibility = v === '__none__' ? '' : v;
                            updateAssignment(assignment.id, {
                              responsibility: nextResponsibility,
                              deptId: nextResponsibility === 'company_head' ? '' : assignment.deptId,
                            });
                          }}
                        >
                          <SelectTrigger><SelectValue placeholder="Select responsibility" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">Select responsibility</SelectItem>
                            {RESPONSIBILITY_OPTIONS.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        {assignment.responsibility === '__custom__' && (
                          <Input
                            placeholder="Custom responsibility"
                            value={assignment.responsibilityType}
                            onChange={(e) => updateAssignment(assignment.id, { responsibilityType: e.target.value })}
                          />
                        )}
                      </div>
                      {assignment.responsibility === 'department_head' && !assignment.deptId && (
                        <p className="text-xs text-destructive">Department Head requires a specific department.</p>
                      )}
                    </div>

                    <div className="flex items-end gap-4 pb-2">
                      <label className="inline-flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={assignment.isActive}
                          onCheckedChange={(checked) => {
                            const isActive = !!checked;
                            updateAssignment(assignment.id, { isActive });
                            if (!isActive && assignment.isPrimary) {
                              const nextActive = assignments.find((a) => a.id !== assignment.id && a.isActive);
                              if (nextActive) {
                                setPrimaryAssignment(nextActive.id);
                              }
                            }
                          }}
                        />
                        Active
                      </label>

                      <label className="inline-flex items-center gap-2 text-sm">
                        <input
                          id={`primary-${assignment.id}`}
                          type="radio"
                          name="primary-assignment"
                          checked={assignment.isPrimary}
                          onChange={() => {
                            if (!assignment.isActive) {
                              updateAssignment(assignment.id, { isActive: true });
                            }
                            setPrimaryAssignment(assignment.id);
                          }}
                        />
                        Primary
                      </label>
                    </div>
                  </div>
                </div>
                  );
                })()
              ))}
            </div>
          </div>
            </>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
