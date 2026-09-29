import { query } from './db';
import type { SessionUser } from '@/types';

export type TaskScope = {
  id?: number;
  company_id: number | null;
  dept_id: number | null;
};

export type UserScopeAssignment = {
  id?: number;
  user_id?: number;
  company_id: number;
  dept_id: number | null;
  desig_id?: number | null;
  responsibility_type?: string | null;
  is_primary?: boolean;
  is_active?: boolean;
};

export type ScopeSqlResult = {
  clause: string;
  params: unknown[];
  nextIndex: number;
  hasAccess: boolean;
};

export type TaskEditMode = 'none' | 'limited' | 'full';

export type TaskPermissionProfile = {
  canView: boolean;
  canEdit: boolean;
  canDelete: boolean;
  editMode: TaskEditMode;
};

function normalizeResponsibility(value?: string | null): string {
  return (value || '').trim().toLowerCase();
}

function dedupeAssignments(assignments: UserScopeAssignment[]): UserScopeAssignment[] {
  const map = new Map<string, UserScopeAssignment>();
  for (const a of assignments) {
    const key = `${a.company_id}:${a.dept_id ?? 'all'}`;
    if (!map.has(key)) {
      map.set(key, a);
    }
  }
  return Array.from(map.values());
}

export async function getUserScopeAssignments(user: SessionUser): Promise<UserScopeAssignment[]> {
  if (user.role === 'admin') {
    return [];
  }

  if (Number(user.id) <= 0) {
    return [];
  }

  const result = await query<UserScopeAssignment>(
    `SELECT
       usa.id,
       usa.user_id,
       usa.company_id,
       CASE WHEN dchm.id IS NOT NULL THEN NULL ELSE usa.dept_id END as dept_id,
       usa.desig_id,
       CASE WHEN dchm.id IS NOT NULL THEN 'company_head' ELSE usa.responsibility_type END as responsibility_type,
       usa.is_primary,
       usa.is_active
     FROM user_scope_assignments
     usa
     LEFT JOIN desig_company_head_map dchm
       ON dchm.desig_id = usa.desig_id
      AND dchm.company_id = usa.company_id
     WHERE user_id = $1
       AND usa.is_active = true
       AND (usa.active_from IS NULL OR usa.active_from <= NOW())
       AND (usa.active_to IS NULL OR usa.active_to >= NOW())
     ORDER BY usa.is_primary DESC, usa.id ASC`,
    [user.id]
  );

  const scoped = dedupeAssignments((result.rows || []).filter((r) => !!r.company_id));
  if (scoped.length > 0) {
    return scoped;
  }

  // Backward-compatible fallback for environments not yet migrated to assignment rows.
  if (user.companyId) {
    const fallbackUser = await query<{ dept_id: number | null; is_company_head: boolean }>(
      `SELECT
         u.dept_id,
         EXISTS(
           SELECT 1
           FROM desig_company_head_map dchm
           WHERE dchm.desig_id = u.desig_id
             AND dchm.company_id = u.company_id
         ) as is_company_head
       FROM users u
       WHERE u.id = $1`,
      [user.id]
    );

    const row = fallbackUser.rows[0];
    const isCompanyHead = !!row?.is_company_head;
    return [{
      company_id: user.companyId,
      dept_id: isCompanyHead ? null : (row?.dept_id ?? user.deptId ?? null),
      responsibility_type: isCompanyHead ? 'company_head' : null,
      is_primary: true,
    }];
  }

  return [];
}

export async function buildTaskScopeSql(
  user: SessionUser,
  options?: {
    tableAlias?: string;
    companyColumn?: string;
    deptColumn?: string;
    startIndex?: number;
    selectedCompanyId?: number | null;
    selectedDeptId?: number | null;
  }
): Promise<ScopeSqlResult> {
  const tableAlias = options?.tableAlias;
  const companyColumn = options?.companyColumn || 'company_id';
  const deptColumn = options?.deptColumn || 'dept_id';
  const startIndex = options?.startIndex || 1;
  const selectedCompanyId = options?.selectedCompanyId ?? null;
  const selectedDeptId = options?.selectedDeptId ?? null;

  if (selectedDeptId != null && selectedCompanyId == null) {
    return { clause: '1=0', params: [], nextIndex: startIndex, hasAccess: false };
  }

  const companyRef = tableAlias ? `${tableAlias}.${companyColumn}` : companyColumn;
  const deptRef = tableAlias ? `${tableAlias}.${deptColumn}` : deptColumn;

  if (user.role === 'admin') {
    let idx = startIndex;
    const params: unknown[] = [];
    const filters: string[] = [];

    if (selectedCompanyId != null) {
      filters.push(`${companyRef} = $${idx}`);
      params.push(selectedCompanyId);
      idx += 1;
    }

    if (selectedDeptId != null) {
      filters.push(`${deptRef} = $${idx}`);
      params.push(selectedDeptId);
      idx += 1;
    }

    return {
      clause: filters.join(' AND '),
      params,
      nextIndex: idx,
      hasAccess: true,
    };
  }

  let assignments = await getUserScopeAssignments(user);

  if (selectedCompanyId != null) {
    const inCompany = assignments.filter((a) => a.company_id === selectedCompanyId);
    if (inCompany.length === 0) {
      return { clause: '1=0', params: [], nextIndex: startIndex, hasAccess: false };
    }

    if (selectedDeptId != null) {
      const hasDept = inCompany.some((a) => a.dept_id === selectedDeptId || a.dept_id == null);
      if (!hasDept) {
        return { clause: '1=0', params: [], nextIndex: startIndex, hasAccess: false };
      }
      assignments = [{ company_id: selectedCompanyId, dept_id: selectedDeptId }];
    } else {
      assignments = inCompany;
    }
  }

  if (assignments.length === 0) {
    return { clause: '1=0', params: [], nextIndex: startIndex, hasAccess: false };
  }

  let idx = startIndex;
  const params: unknown[] = [];
  const parts: string[] = [];

  for (const scope of assignments) {
    if (scope.dept_id == null) {
      parts.push(`${companyRef} = $${idx}`);
      params.push(scope.company_id);
      idx += 1;
    } else {
      parts.push(`(${companyRef} = $${idx} AND ${deptRef} = $${idx + 1})`);
      params.push(scope.company_id, scope.dept_id);
      idx += 2;
    }
  }

  return {
    clause: parts.length === 1 ? parts[0] : `(${parts.join(' OR ')})`,
    params,
    nextIndex: idx,
    hasAccess: true,
  };
}

export async function canAccessTaskByScope(user: SessionUser, task: TaskScope): Promise<boolean> {
  if (user.role === 'admin') {
    return true;
  }

  if (!task.company_id) {
    return false;
  }

  const assignments = await getUserScopeAssignments(user);
  if (assignments.length === 0) {
    return false;
  }

  return assignments.some((scope) => {
    if (scope.company_id !== task.company_id) {
      return false;
    }
    if (scope.dept_id == null) {
      return true;
    }
    return scope.dept_id === task.dept_id;
  });
}

function matchesTaskScope(scope: UserScopeAssignment, task: TaskScope): boolean {
  if (!task.company_id) return false;
  if (scope.company_id !== task.company_id) return false;
  if (scope.dept_id == null) return true;
  return scope.dept_id === task.dept_id;
}

function isFullAccessAssignment(scope: UserScopeAssignment, task: TaskScope): boolean {
  const responsibility = normalizeResponsibility(scope.responsibility_type);

  if (responsibility === 'company_head') {
    return false;
  }

  if (responsibility === 'department_head') {
    return scope.dept_id != null && scope.dept_id === task.dept_id;
  }

  // Backward-compatible default: non-company-head assignments retain full control.
  return true;
}

export async function getTaskPermissionProfile(user: SessionUser, task: TaskScope): Promise<TaskPermissionProfile> {
  if (user.role === 'admin') {
    return { canView: true, canEdit: true, canDelete: true, editMode: 'full' };
  }

  if (!task.company_id) {
    return { canView: false, canEdit: false, canDelete: false, editMode: 'none' };
  }

  const assignments = await getUserScopeAssignments(user);
  const matching = assignments.filter((scope) => matchesTaskScope(scope, task));

  if (matching.length === 0) {
    return { canView: false, canEdit: false, canDelete: false, editMode: 'none' };
  }

  const hasFull = matching.some((scope) => isFullAccessAssignment(scope, task));
  if (hasFull) {
    return { canView: true, canEdit: true, canDelete: true, editMode: 'full' };
  }

  const hasLimited = matching.some((scope) => normalizeResponsibility(scope.responsibility_type) === 'company_head');
  if (hasLimited) {
    return { canView: true, canEdit: true, canDelete: false, editMode: 'limited' };
  }

  return { canView: true, canEdit: false, canDelete: false, editMode: 'none' };
}

export async function getTaskScope(taskId: number): Promise<TaskScope | null> {
  const result = await query<TaskScope>(
    'SELECT id, company_id, dept_id FROM tasks WHERE id = $1',
    [taskId]
  );

  if (!result.rowCount) {
    return null;
  }

  return result.rows[0];
}

export async function canUserAccessTaskId(user: SessionUser, taskId: number): Promise<boolean> {
  if (user.role === 'admin') {
    return true;
  }

  const taskResult = await query<{
    id: number;
    company_id: number | null;
    dept_id: number | null;
    assigned_to: number | null;
    assigned_to_ids: number[] | null;
  }>(
    'SELECT id, company_id, dept_id, assigned_to, assigned_to_ids FROM tasks WHERE id = $1',
    [taskId]
  );

  if ((taskResult.rowCount || 0) === 0) {
    return false;
  }

  const task = taskResult.rows[0];
  const userId = Number(user.id);
  const assigneeIds = task.assigned_to_ids?.length
    ? task.assigned_to_ids
    : (task.assigned_to ? [task.assigned_to] : []);

  if (assigneeIds.includes(userId)) {
    return true;
  }

  return canAccessTaskByScope(user, {
    id: task.id,
    company_id: task.company_id,
    dept_id: task.dept_id,
  });
}

export async function canUserModifyTaskId(user: SessionUser, taskId: number): Promise<boolean> {
  if (user.role === 'admin') {
    return true;
  }

  const taskResult = await query<{
    id: number;
    company_id: number | null;
    dept_id: number | null;
    assigned_by: number | null;
    assigned_to: number | null;
    assigned_to_ids: number[] | null;
  }>(
    `SELECT id, company_id, dept_id, assigned_by, assigned_to, assigned_to_ids
     FROM tasks
     WHERE id = $1`,
    [taskId]
  );

  if ((taskResult.rowCount || 0) === 0) {
    return false;
  }

  const task = taskResult.rows[0];
  const userId = Number(user.id);
  const assigneeIds = task.assigned_to_ids?.length
    ? task.assigned_to_ids
    : (task.assigned_to ? [task.assigned_to] : []);

  if (task.assigned_by === userId) {
    return true;
  }

  if (assigneeIds.includes(userId)) {
    return true;
  }

  const assignments = await getUserScopeAssignments(user);
  return assignments.some((scope) => {
    if (scope.company_id !== task.company_id) {
      return false;
    }

    const responsibility = normalizeResponsibility(scope.responsibility_type);
    if (responsibility === 'company_head') {
      return true;
    }

    if (responsibility === 'department_head') {
      return scope.dept_id != null && scope.dept_id === task.dept_id;
    }

    return false;
  });
}

export async function resolveWritableTaskScope(
  user: SessionUser,
  requestedCompanyId?: number | null,
  requestedDeptId?: number | null
): Promise<{ companyId: number | null; deptId: number | null }> {
  if (user.role === 'admin') {
    return {
      companyId: requestedCompanyId || null,
      deptId: requestedDeptId || null,
    };
  }

  const scopes = await getUserScopeAssignments(user);
  if (scopes.length === 0) {
    return { companyId: null, deptId: null };
  }

  const primary = scopes.find((s) => s.is_primary) || scopes[0];

  if (!requestedCompanyId) {
    return {
      companyId: primary.company_id,
      deptId: primary.dept_id ?? null,
    };
  }

  const inCompany = scopes.filter((s) => s.company_id === requestedCompanyId);
  if (inCompany.length === 0) {
    return { companyId: null, deptId: null };
  }

  if (requestedDeptId != null) {
    const allowed = inCompany.some((s) => s.dept_id == null || s.dept_id === requestedDeptId);
    if (!allowed) {
      return { companyId: null, deptId: null };
    }
    return { companyId: requestedCompanyId, deptId: requestedDeptId };
  }

  const companyWide = inCompany.find((s) => s.dept_id == null);
  if (companyWide) {
    return { companyId: requestedCompanyId, deptId: null };
  }

  return { companyId: requestedCompanyId, deptId: inCompany[0].dept_id ?? null };
}

export async function getTransactionReminderScope(id: number): Promise<TaskScope | null> {
  const result = await query<TaskScope>(
    'SELECT id, company_id, dept_id FROM transaction_reminders WHERE id = $1 AND is_deleted = false',
    [id]
  );

  if (!result.rowCount) {
    return null;
  }

  return result.rows[0];
}

export async function canUserAccessTransactionReminderId(user: SessionUser, id: number): Promise<boolean> {
  if (user.role === 'admin') {
    return true;
  }

  const scope = await getTransactionReminderScope(id);
  if (!scope) {
    return false;
  }

  return canAccessTaskByScope(user, scope);
}

export async function canUserModifyTransactionReminderId(user: SessionUser, id: number): Promise<boolean> {
  if (user.role === 'admin') {
    return true;
  }

  const scope = await getTransactionReminderScope(id);
  if (!scope) {
    return false;
  }

  const profile = await getTaskPermissionProfile(user, scope);
  return profile.canEdit;
}

export async function canCreateTaskInScope(
  user: SessionUser,
  companyId: number | null,
  deptId: number | null
): Promise<{ allowed: boolean; editMode: TaskEditMode }> {
  if (user.role === 'admin') {
    return { allowed: true, editMode: 'full' };
  }

  const profile = await getTaskPermissionProfile(user, {
    company_id: companyId,
    dept_id: deptId,
  });

  return {
    allowed: profile.editMode === 'full' || profile.editMode === 'limited',
    editMode: profile.editMode,
  };
}
