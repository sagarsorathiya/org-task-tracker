'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useSession } from 'next-auth/react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, X, Bold, Italic, Underline, List, Upload, FileIcon } from 'lucide-react';
import { PRIORITY_OPTIONS, MAX_FILE_SIZE_BYTES } from '@/constants';
import { formatFileSize } from '@/lib/utils';
import toast from 'react-hot-toast';
import type { Company, Department, DeptCompanyMap, Task, TaskAttachment, User } from '@/types';

const ATTACHMENT_ACCEPT = 'image/*,.eml,.msg,.pdf,.doc,.docx,.dotx,.docm,.xls,.xlsx,.xlsm,.xlsb,.xltx,.ppt,.pptx,.pptm,.potx,.rtf,.odt,.ods,.odp,.csv,.tsv,.txt,.log,.md,.json,.xml';

const taskSchema = z.object({
  title: z.string().min(1, 'Title is required').max(300),
  description: z.string().trim().min(1, 'Description is required').max(10000),
  activityStartDate: z.string().min(1, 'Date is required'),
  assignedToIds: z.array(z.string()).min(1, 'Assign To is required'),
  informationIds: z.array(z.string()).optional().default([]),
  companyId: z.string().optional(),
  deptId: z.string().min(1, 'Department is required'),
  status: z.enum(['open', 'in_progress', 'completed', 'cancelled']),
  priority: z.enum(['low', 'medium', 'high', 'critical']),
  lastFollowUpDate: z.string().optional(),
  nextFollowUpDate: z.string().optional(),
  targetCompletionDate: z.string().min(1, 'Target Date is required'),
});

type TaskFormValues = z.infer<typeof taskSchema>;

interface AssigneeOption {
  id: number;
  username: string;
  display_name: string | null;
  email?: string | null;
  source?: 'local' | 'ldap';
}

interface TaskFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task?: Task | null;
  onSuccess: () => void;
}

export function TaskForm({ open, onOpenChange, task, onSuccess }: TaskFormProps) {
  const isEdit = !!task;
  const { data: session } = useSession();
  const today = React.useMemo(() => {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    return local.toISOString().split('T')[0];
  }, []);
  const nowLocalDateTime = React.useMemo(() => {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  }, []);
  const [loading, setLoading] = useState(false);
  const descEditorRef = useRef<HTMLDivElement>(null);
  const attachInputRef = useRef<HTMLInputElement>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [pendingProgress, setPendingProgress] = useState<Record<number, number>>({});
  const [existingAttachments, setExistingAttachments] = useState<TaskAttachment[]>([]);
  const [attachDragging, setAttachDragging] = useState(false);
  const [assigneeOptions, setAssigneeOptions] = useState<AssigneeOption[]>([]);
  const [assigneeQuery, setAssigneeQuery] = useState('');
  const [assigneeLoading, setAssigneeLoading] = useState(false);
  const [informationQuery, setInformationQuery] = useState('');
  const [informationLoading, setInformationLoading] = useState(false);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [deptCompanyMap, setDeptCompanyMap] = useState<DeptCompanyMap[]>([]);

  // Cache org data so we don't refetch on every dialog open
  const orgCacheRef = useRef<{
    companies: Company[];
    departments: Department[];
    deptCompanyMap: DeptCompanyMap[];
  } | null>(null);

  const form = useForm<TaskFormValues>({
    resolver: zodResolver(taskSchema),
    defaultValues: {
      title: '',
      description: '',
      activityStartDate: today,
      assignedToIds: [],
      informationIds: [],
      companyId: '',
      deptId: '',
      status: 'open',
      priority: 'medium',
      lastFollowUpDate: '',
      nextFollowUpDate: '',
      targetCompletionDate: nowLocalDateTime,
    },
  });

  const assignedToIds = form.watch('assignedToIds');
  const informationIds = form.watch('informationIds') ?? [];
  const selectedCompanyId = form.watch('companyId');
  const targetCompletionDateValue = form.watch('targetCompletionDate');
  const showAssigneeResults = assigneeLoading || assigneeQuery.trim().length >= 2;
  const showInformationResults = informationLoading || informationQuery.trim().length >= 2;
  const normalizedAssigneeQuery = assigneeQuery.trim().toLowerCase();
  const normalizedInformationQuery = informationQuery.trim().toLowerCase();

  const displayedAssigneeOptions = React.useMemo(() => {
    if (normalizedAssigneeQuery.length < 2) {
      return [] as AssigneeOption[];
    }

    const selectedSet = new Set(assignedToIds);
    const meId = session?.user?.id ? String(session.user.id) : '';

    const matches = assigneeOptions.filter((u) => {
      const name = (u.display_name || '').toLowerCase();
      const username = (u.username || '').toLowerCase();
      const email = (u.email || '').toLowerCase();
      return name.includes(normalizedAssigneeQuery)
        || username.includes(normalizedAssigneeQuery)
        || email.includes(normalizedAssigneeQuery);
    });

    const rank = (u: AssigneeOption) => {
      const id = String(u.id);
      const name = (u.display_name || '').toLowerCase();
      const username = (u.username || '').toLowerCase();
      const email = (u.email || '').toLowerCase();

      let score = 0;
      if (selectedSet.has(id)) score -= 200;
      if (meId && id === meId) score -= 120;

      if (name === normalizedAssigneeQuery || username === normalizedAssigneeQuery || email === normalizedAssigneeQuery) score -= 80;
      if (name.startsWith(normalizedAssigneeQuery) || username.startsWith(normalizedAssigneeQuery) || email.startsWith(normalizedAssigneeQuery)) score -= 40;

      return score;
    };

    return matches.sort((a, b) => {
      const scoreDiff = rank(a) - rank(b);
      if (scoreDiff !== 0) return scoreDiff;
      return (a.display_name || a.username).localeCompare(b.display_name || b.username);
    });
  }, [assigneeOptions, assignedToIds, normalizedAssigneeQuery, session?.user?.id]);

  const displayedInformationOptions = React.useMemo(() => {
    if (normalizedInformationQuery.length < 2) {
      return [] as AssigneeOption[];
    }

    const assigneeSet = new Set(assignedToIds);
    const infoSet = new Set(informationIds);

    const matches = assigneeOptions.filter((u) => {
      if (assigneeSet.has(String(u.id))) return false;
      const name = (u.display_name || '').toLowerCase();
      const username = (u.username || '').toLowerCase();
      const email = (u.email || '').toLowerCase();
      return name.includes(normalizedInformationQuery)
        || username.includes(normalizedInformationQuery)
        || email.includes(normalizedInformationQuery);
    });

    return matches.sort((a, b) => {
      const aSelected = infoSet.has(String(a.id)) ? -100 : 0;
      const bSelected = infoSet.has(String(b.id)) ? -100 : 0;
      if (aSelected !== bSelected) return aSelected - bSelected;
      return (a.display_name || a.username).localeCompare(b.display_name || b.username);
    });
  }, [assigneeOptions, assignedToIds, informationIds, normalizedInformationQuery]);

  const allowedDepartments = React.useMemo(() => {
    let base: Department[];
    if (!selectedCompanyId) {
      base = departments;
    } else {
      const mappedDeptIds = new Set(
        deptCompanyMap
          .filter((m) => String(m.company_id) === selectedCompanyId)
          .map((m) => String(m.dept_id))
      );
      base = departments.filter((d) => mappedDeptIds.has(String(d.id)));
    }

    // In edit mode, always include the task's assigned department even if it's outside the user's scope
    if (isEdit && task?.dept_id) {
      const taskDeptIdStr = String(task.dept_id);
      if (!base.some((d) => String(d.id) === taskDeptIdStr)) {
        const existingDept = departments.find((d) => String(d.id) === taskDeptIdStr);
        const deptEntry: Department = existingDept ?? ({
          id: task.dept_id,
          name: (task as Task & { dept_name?: string }).dept_name ?? `Department #${task.dept_id}`,
          active: true,
        } as Department);
        base = [...base, deptEntry];
      }
    }

    return base;
  }, [departments, deptCompanyMap, selectedCompanyId, isEdit, task]);

  // In edit mode, always include the task's company in the dropdown even if outside user scope
  const availableCompanies = React.useMemo(() => {
    if (!isEdit || !task?.company_id) return companies;
    if (companies.some((c) => c.id === task.company_id)) return companies;
    return [
      ...companies,
      {
        id: task.company_id,
        name: (task as Task & { company_name?: string }).company_name ?? `Company #${task.company_id}`,
        code: '',
        active: true,
      } as Company,
    ];
  }, [companies, isEdit, task]);

  const resolveDefaultScope = React.useCallback((companyId?: string, deptId?: string) => {
    if (companies.length === 0) {
      return { companyId: '', deptId: '' };
    }

    const availableCompanyIds = new Set(companies.map((c) => String(c.id)));
    const sessionCompanyId = session?.user?.companyId ? String(session.user.companyId) : '';
    const fallbackCompanyId = availableCompanyIds.has(sessionCompanyId)
      ? sessionCompanyId
      : String(companies[0].id);
    const nextCompanyId = companyId && availableCompanyIds.has(companyId) ? companyId : fallbackCompanyId;

    const mappedDeptIds = new Set(
      deptCompanyMap
        .filter((m) => String(m.company_id) === nextCompanyId)
        .map((m) => String(m.dept_id))
    );

    const availableDeptIds = departments
      .map((d) => String(d.id))
      .filter((id) => mappedDeptIds.has(id));

    if (availableDeptIds.length === 0) {
      return { companyId: nextCompanyId, deptId: '' };
    }

    if (deptId && availableDeptIds.includes(deptId)) {
      return { companyId: nextCompanyId, deptId };
    }

    const sessionDeptId = session?.user?.deptId ? String(session.user.deptId) : '';
    if (sessionDeptId && availableDeptIds.includes(sessionDeptId)) {
      return { companyId: nextCompanyId, deptId: sessionDeptId };
    }

    return {
      companyId: nextCompanyId,
      deptId: availableDeptIds.length === 1 ? availableDeptIds[0] : '',
    };
  }, [companies, departments, deptCompanyMap, session?.user?.companyId, session?.user?.deptId]);

  const mergeAssigneeOptions = (incoming: AssigneeOption[]) => {
    setAssigneeOptions((prev) => {
      const map = new Map<number, AssigneeOption>();
      for (const option of [...prev, ...incoming]) {
        map.set(option.id, option);
      }
      return Array.from(map.values()).sort((a, b) => (a.display_name || a.username).localeCompare(b.display_name || b.username));
    });
  };

  useEffect(() => {
    if (!open) {
      return;
    }

    const loadFormOptions = async () => {
      try {
        // Reuse previously loaded org data to avoid repeated network requests
        const usedCache = !!orgCacheRef.current;
        if (orgCacheRef.current) {
          setCompanies(orgCacheRef.current.companies);
          setDepartments(orgCacheRef.current.departments);
          setDeptCompanyMap(orgCacheRef.current.deptCompanyMap);
        }

        // Build the list of IDs we must have in assigneeOptions when editing an existing task.
        const existingUserIds = [
          ...(task?.assigned_to_ids?.length ? task.assigned_to_ids : (task?.assigned_to ? [task.assigned_to] : [])),
          ...(task?.information_ids?.length ? task.information_ids : []),
        ].filter((id): id is number => typeof id === 'number');

        const [usersRes, scopeRes, existingUsersRes] = await Promise.all([
          fetch('/api/users?limit=100'),
          orgCacheRef.current ? Promise.resolve(null) : fetch('/api/insights/filters'),
          existingUserIds.length > 0
            ? fetch(`/api/users/search?ids=${existingUserIds.join(',')}`)
            : Promise.resolve(null),
        ]);

        const usersData = usersRes.ok ? await usersRes.json() : { data: { items: [] } };
        const scopeData = scopeRes && scopeRes.ok
          ? await scopeRes.json()
          : { data: { companies: [], departments: [], deptCompanyMap: [] } };
        const existingUsersData = existingUsersRes && existingUsersRes.ok ? await existingUsersRes.json() : { data: [] };

        const userItems = usersData.data?.items || [];
        mergeAssigneeOptions(
          userItems.map((u: User) => ({
            id: u.id,
            username: u.username,
            display_name: u.display_name,
            email: u.email,
            source: 'local',
          }))
        );

        // Preload existing task assignees and information recipients so their chips render correctly,
        // even when the user doesn't have access to /api/users (e.g. role='user').
        if (Array.isArray(existingUsersData.data) && existingUsersData.data.length > 0) {
          mergeAssigneeOptions(
            (existingUsersData.data as Array<{ id: number; username: string; display_name: string | null; email: string | null }>).map((u) => ({
              id: u.id,
              username: u.username,
              display_name: u.display_name,
              email: u.email,
              source: 'local' as const,
            }))
          );
        }

        // Ensure current session user is available as "Me" even when /api/users is restricted.
        if (session?.user?.id) {
          mergeAssigneeOptions([
            {
              id: Number(session.user.id),
              username: session.user.username || 'me',
              display_name: session.user.username || 'Me',
              source: 'local',
            },
          ]);
        }

        let nextCompanies = scopeData.data?.companies || [];
        let nextDepartments = scopeData.data?.departments || [];
        let nextMap = scopeData.data?.deptCompanyMap || [];

        // Fallback for domain users without assignment rows yet: derive from org masters + session scope.
        if (!usedCache && (session?.user?.companyId || session?.user?.deptId) && (nextCompanies.length === 0 || nextMap.length === 0 || nextDepartments.length === 0)) {
          const [companiesRes, departmentsRes, mapRes] = await Promise.all([
            fetch('/api/org/companies'),
            fetch('/api/org/departments'),
            fetch(`/api/org/mappings?type=dept-company&sourceId=${session?.user?.companyId || ''}`),
          ]);

          const [companiesData, departmentsData, mapData] = await Promise.all([
            companiesRes.json(),
            departmentsRes.json(),
            mapRes.json(),
          ]);

          const allCompanies: Company[] = companiesData.data || [];
          const allDepartments: Department[] = departmentsData.data || [];
          const allMap: Array<Pick<DeptCompanyMap, 'company_id' | 'dept_id'>> = Array.isArray(mapData.data)
            ? mapData.data
            : (mapData.data?.deptCompany || []);

          const sessionCompanyId = session?.user?.companyId ? Number(session.user.companyId) : null;
          const sessionDeptId = session?.user?.deptId ? Number(session.user.deptId) : null;

          if (sessionCompanyId) {
            if (nextCompanies.length === 0) {
              nextCompanies = allCompanies.filter((c) => c.id === sessionCompanyId && c.active);
            }
            nextMap = allMap.filter((m) => m.company_id === sessionCompanyId);

            if (sessionDeptId) {
              if (nextDepartments.length === 0) {
                nextDepartments = allDepartments.filter((d) => d.id === sessionDeptId && d.active);
              }
              if (!nextMap.some((m: Pick<DeptCompanyMap, 'company_id' | 'dept_id'>) => m.company_id === sessionCompanyId && m.dept_id === sessionDeptId)) {
                nextMap = [...nextMap, { id: -1, company_id: sessionCompanyId, dept_id: sessionDeptId }];
              }
            } else {
              const deptIds = new Set(nextMap.map((m: Pick<DeptCompanyMap, 'company_id' | 'dept_id'>) => m.dept_id));
              nextDepartments = allDepartments.filter((d) => deptIds.has(d.id) && d.active);
            }
          }
        }

        // Only update state if we fetched fresh data; cache hits already set state above.
        if (!usedCache) {
          setCompanies(nextCompanies);
          setDepartments(nextDepartments);
          setDeptCompanyMap(nextMap);
          orgCacheRef.current = { companies: nextCompanies, departments: nextDepartments, deptCompanyMap: nextMap };
        }
      } catch {
        setCompanies([]);
        setDepartments([]);
        setDeptCompanyMap([]);
        toast.error('Failed to load company/department scope options');
      }
    };

    void loadFormOptions();

    if (task) {
      const existingAssignees = task.assigned_to_ids?.length
        ? task.assigned_to_ids.map((id) => String(id))
        : (task.assigned_to ? [String(task.assigned_to)] : []);
      const existingInfoIds = task.information_ids?.length
        ? task.information_ids.map((id) => String(id))
        : [];
      form.reset({
        title: task.title || '',
        description: task.description || '',
        activityStartDate: task.activity_start_date
          ? `${task.activity_start_date.split('T')[0]}T${(task.activity_start_time || '00:00:00').slice(0, 5)}`
          : '',
        assignedToIds: existingAssignees,
        informationIds: existingInfoIds,
        companyId: task.company_id ? String(task.company_id) : '',
        deptId: task.dept_id ? String(task.dept_id) : '',
        status: task.status,
        priority: task.priority,
        lastFollowUpDate: task.last_follow_up_date ? task.last_follow_up_date.split('T')[0] : '',
        nextFollowUpDate: task.follow_up_date ? task.follow_up_date.split('T')[0] : '',
        targetCompletionDate: task.due_date
          ? `${task.due_date.split('T')[0]}T${(task.due_time || '00:00:00').slice(0, 5)}`
          : '',
      });
    } else {
      const defaultAssignee = session?.user?.id ? [String(session.user.id)] : [];
      form.reset({
        title: '',
        description: '',
        activityStartDate: today,
        assignedToIds: defaultAssignee,
        informationIds: [],
        companyId: '',
        deptId: '',
        status: 'open',
        priority: 'medium',
        lastFollowUpDate: '',
        nextFollowUpDate: '',
        targetCompletionDate: nowLocalDateTime,
      });
    }
  }, [open, task, form, today, nowLocalDateTime, session?.user?.id]);

  // Sync description editor when dialog opens or task changes
  useEffect(() => {
    if (!open) return;
    // Wait a tick so the editor DOM is mounted
    setTimeout(() => {
      if (descEditorRef.current) {
        descEditorRef.current.innerHTML = task?.description || '';
      }
    }, 0);
  }, [open, task]);


  useEffect(() => {
    if (!open || isEdit) {
      return;
    }

    const me = session?.user?.id ? String(session.user.id) : '';
    if (!me) {
      return;
    }

    const current = form.getValues('assignedToIds') || [];
    if (current.length === 0) {
      form.setValue('assignedToIds', [me], { shouldDirty: false, shouldValidate: true });
    }
  }, [open, isEdit, session?.user?.id, form]);

  useEffect(() => {
    if (!open || companies.length === 0) {
      return;
    }

    // In edit mode, company and dept are pre-set by form.reset() from the task — don't override them
    if (isEdit && form.getValues('companyId') && form.getValues('deptId')) {
      return;
    }

    const currentCompanyId = form.getValues('companyId');
    const currentDeptId = form.getValues('deptId');
    const next = resolveDefaultScope(currentCompanyId, currentDeptId);

    if (!currentCompanyId && next.companyId) {
      form.setValue('companyId', next.companyId, { shouldDirty: false });
    }

    if ((!currentDeptId || currentCompanyId !== next.companyId) && currentDeptId !== next.deptId) {
      form.setValue('deptId', next.deptId, { shouldDirty: false });
    }
  }, [open, companies, form, resolveDefaultScope, isEdit]);

  useEffect(() => {
    if (!open || !informationQuery.trim() || informationQuery.trim().length < 2) {
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setInformationLoading(true);
      try {
        const res = await fetch(`/api/users/search?q=${encodeURIComponent(informationQuery.trim())}&limit=12`, { signal: controller.signal });
        const data = await res.json();
        if (data.success && Array.isArray(data.data)) {
          mergeAssigneeOptions(data.data);
        }
      } catch {
        // no-op
      } finally {
        setInformationLoading(false);
      }
    }, 250);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [informationQuery, open]);

  useEffect(() => {
    if (!open || !assigneeQuery.trim() || assigneeQuery.trim().length < 2) {
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setAssigneeLoading(true);
      try {
        const res = await fetch(`/api/users/search?q=${encodeURIComponent(assigneeQuery.trim())}&limit=12`, { signal: controller.signal });
        const data = await res.json();
        if (data.success && Array.isArray(data.data)) {
          mergeAssigneeOptions(data.data);
        }
      } catch {
        // no-op for transient search failures
      } finally {
        setAssigneeLoading(false);
      }
    }, 250);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [assigneeQuery, open]);

  useEffect(() => {
    if (!selectedCompanyId) {
      if (form.getValues('deptId')) {
        form.setValue('deptId', '');
      }
      return;
    }

    if (deptCompanyMap.length === 0) {
      return;
    }

    const currentDeptId = form.getValues('deptId');

    // In edit mode, never auto-clear the task's originally assigned department
    if (isEdit && task?.dept_id && currentDeptId === String(task.dept_id)) {
      return;
    }

    const mappedDeptIds = new Set(
      deptCompanyMap
        .filter((m) => String(m.company_id) === selectedCompanyId)
        .map((m) => String(m.dept_id))
    );

    const mappedAvailableDeptIds = departments
      .map((d) => String(d.id))
      .filter((id) => mappedDeptIds.has(id));

    if (currentDeptId && mappedAvailableDeptIds.includes(currentDeptId)) {
      return;
    }

    const sessionDeptId = session?.user?.deptId ? String(session.user.deptId) : '';
    const nextDeptId = sessionDeptId && mappedAvailableDeptIds.includes(sessionDeptId)
      ? sessionDeptId
      : (mappedAvailableDeptIds.length === 1 ? mappedAvailableDeptIds[0] : '');

    if (currentDeptId !== nextDeptId) {
      form.setValue('deptId', nextDeptId, { shouldDirty: true });
    }
  }, [selectedCompanyId, deptCompanyMap, departments, form, session?.user?.deptId, isEdit, task?.dept_id]);

  const toggleAssignee = (userId: string) => {
    const current = form.getValues('assignedToIds') || [];
    const next = current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId];
    form.setValue('assignedToIds', next, { shouldDirty: true, shouldValidate: true });
  };

  const selectAssigneeFromSearch = (userId: string) => {
    toggleAssignee(userId);
    setAssigneeQuery('');
  };

  // Reset staged files on every dialog open; load existing attachments in edit mode
  useEffect(() => {
    if (!open) return;
    setPendingFiles([]);
    setPendingProgress({});
    setAttachDragging(false);
    if (task?.id) {
      fetch(`/api/tasks/${task.id}/attachments`)
        .then((r) => r.json())
        .then((d) => { if (d.success && Array.isArray(d.data)) setExistingAttachments(d.data); })
        .catch(() => { /* non-blocking */ });
    } else {
      setExistingAttachments([]);
    }
  }, [open, task]);

  const addPendingFiles = (list: FileList | File[]) => {
    const accepted: File[] = [];
    for (const f of Array.from(list)) {
      if (f.size > MAX_FILE_SIZE_BYTES) {
        toast.error(`"${f.name}" exceeds the 30MB limit`);
        continue;
      }
      accepted.push(f);
    }
    if (accepted.length) setPendingFiles((prev) => [...prev, ...accepted]);
  };

  const removePendingFile = (idx: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const deleteExistingAttachment = async (attachId: number) => {
    if (!task?.id) return;
    try {
      const res = await fetch(`/api/tasks/${task.id}/attachments?attachId=${attachId}`, { method: 'DELETE' });
      const d = await res.json();
      if (d.success) {
        setExistingAttachments((prev) => prev.filter((a) => a.id !== attachId));
        toast.success('Attachment deleted');
      } else {
        toast.error(d.error || 'Delete failed');
      }
    } catch {
      toast.error('Delete failed');
    }
  };

  const uploadOneFile = (file: File, taskId: number, onProgress: (pct: number) => void): Promise<{ success: boolean; error?: string }> => {
    return new Promise((resolve) => {
      const fd = new FormData();
      fd.append('file', file);
      const xhr = new XMLHttpRequest();
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        try {
          const d = JSON.parse(xhr.responseText);
          resolve(xhr.status >= 200 && xhr.status < 300 && d.success ? { success: true } : { success: false, error: d.error });
        } catch {
          resolve({ success: false });
        }
      };
      xhr.onerror = () => resolve({ success: false });
      xhr.open('POST', `/api/tasks/${taskId}/attachments`);
      xhr.send(fd);
    });
  };

  // Uploads staged files to the saved task; returns the number of failures
  const uploadPendingFiles = async (taskId: number): Promise<number> => {
    let failed = 0;
    for (let i = 0; i < pendingFiles.length; i++) {
      const f = pendingFiles[i];
      setPendingProgress((prev) => ({ ...prev, [i]: 0 }));
      const result = await uploadOneFile(f, taskId, (pct) => setPendingProgress((prev) => ({ ...prev, [i]: pct })));
      if (!result.success) {
        failed++;
        toast.error(`"${f.name}": ${result.error || 'upload failed'}`);
      }
    }
    return failed;
  };

  const toggleInformationUser = (userId: string) => {
    const current = form.getValues('informationIds') || [];
    const next = current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId];
    form.setValue('informationIds', next, { shouldDirty: true });
  };

  const selectInformationFromSearch = (userId: string) => {
    toggleInformationUser(userId);
    setInformationQuery('');
  };

  const handleSubmit = async (values: TaskFormValues) => {
    if (!isEdit && !values.nextFollowUpDate) {
      form.setError('nextFollowUpDate', { type: 'manual', message: 'Reminder Date & Time is required' });
      return;
    }

    if (!isEdit && values.nextFollowUpDate && values.targetCompletionDate) {
      const reminderAt = new Date(values.nextFollowUpDate).getTime();
      const targetAt = new Date(values.targetCompletionDate).getTime();
      if (!Number.isNaN(reminderAt) && !Number.isNaN(targetAt) && reminderAt > targetAt) {
        form.setError('nextFollowUpDate', { type: 'manual', message: 'Reminder Date & Time cannot be after Target Date' });
        return;
      }
    }

    setLoading(true);
    try {
      const body = {
        title: values.title.trim(),
        description: values.description.trim(),
        activityStartDate: values.activityStartDate,
        assignedTo: values.assignedToIds?.[0] ? parseInt(values.assignedToIds[0], 10) : undefined,
        assignedToIds: values.assignedToIds?.map((id) => parseInt(id, 10)).filter((id) => !Number.isNaN(id)),
        informationIds: (values.informationIds ?? []).map((id) => parseInt(id, 10)).filter((id) => !Number.isNaN(id)),
        companyId: values.companyId ? parseInt(values.companyId, 10) : undefined,
        deptId: values.deptId ? parseInt(values.deptId, 10) : undefined,
        status: values.status,
        priority: values.priority,
        lastFollowUpDate: values.lastFollowUpDate || undefined,
        nextFollowUpDate: values.nextFollowUpDate || undefined,
        targetCompletionDate: values.targetCompletionDate,
      };

      const res = await fetch(isEdit ? `/api/tasks/${task!.id}` : '/api/tasks', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (data.success) {
        const savedTaskId = isEdit ? task!.id : (data.data as Task | undefined)?.id;
        let failedUploads = 0;
        if (pendingFiles.length > 0 && savedTaskId) {
          failedUploads = await uploadPendingFiles(savedTaskId);
        }
        if (failedUploads > 0) {
          toast.error(
            `${isEdit ? 'Task updated' : 'Task created'}, but ${failedUploads} attachment${failedUploads > 1 ? 's' : ''} failed — add ${failedUploads > 1 ? 'them' : 'it'} from the task's Files tab`,
            { duration: 6000 }
          );
        } else {
          toast.success(isEdit ? 'Task updated' : 'Task created');
        }
        setPendingFiles([]);
        setPendingProgress({});
        onSuccess();
      } else {
        toast.error(data.error || 'Failed');
      }
    } catch {
      toast.error('Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[94vw] max-w-3xl flex flex-col max-h-[90vh] overflow-hidden"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="shrink-0">
          <DialogTitle>{isEdit ? 'Edit Task' : 'Create Task'}</DialogTitle>
          <DialogDescription>
            Company and department are auto-filled from your accessible scope and can be changed when multiple options are available.
          </DialogDescription>
        </DialogHeader>

        <form className="flex-1 overflow-y-auto space-y-4 py-2 pr-1" onSubmit={form.handleSubmit(handleSubmit)}>
          <div className="space-y-2">
            <label className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Title *</label>
            <Input id="task-title" placeholder="Task title" {...form.register('title')} />
            {form.formState.errors.title && <p className="text-xs text-destructive">{form.formState.errors.title.message}</p>}
          </div>

          <div className="space-y-2">
            <label className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Date & Time *</label>
            <Input id="task-start-date" type="datetime-local" min={isEdit ? undefined : nowLocalDateTime} {...form.register('activityStartDate')} />
            {form.formState.errors.activityStartDate && <p className="text-xs text-destructive">{form.formState.errors.activityStartDate.message}</p>}
          </div>

          <>
            <div className="space-y-2 min-w-0">
              <label className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Description *</label>
              {/* Formatting toolbar */}
              <div className="flex items-center gap-0.5 border border-border rounded-lg px-1 py-0.5 w-fit bg-muted/70">
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); document.execCommand('bold', false, undefined); }}
                  className="h-7 w-7 flex items-center justify-center rounded hover:bg-card text-muted-foreground hover:text-foreground"
                  title="Bold (Ctrl+B)"
                >
                  <Bold className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); document.execCommand('italic', false, undefined); }}
                  className="h-7 w-7 flex items-center justify-center rounded hover:bg-card text-muted-foreground hover:text-foreground"
                  title="Italic (Ctrl+I)"
                >
                  <Italic className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); document.execCommand('underline', false, undefined); }}
                  className="h-7 w-7 flex items-center justify-center rounded hover:bg-card text-muted-foreground hover:text-foreground"
                  title="Underline (Ctrl+U)"
                >
                  <Underline className="h-3.5 w-3.5" />
                </button>
                <div className="w-px h-4 bg-border mx-0.5" />
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); document.execCommand('insertUnorderedList', false, undefined); }}
                  className="h-7 w-7 flex items-center justify-center rounded hover:bg-card text-muted-foreground hover:text-foreground"
                  title="Bullet list"
                >
                  <List className="h-3.5 w-3.5" />
                </button>
              </div>
              <div
                ref={descEditorRef}
                contentEditable
                suppressContentEditableWarning
                data-placeholder="Details... (paste tables from Excel/Word supported)"
                onInput={() => {
                  const html = descEditorRef.current?.innerHTML ?? '';
                  const text = descEditorRef.current?.textContent ?? '';
                  form.setValue('description', text.trim() ? html : '', { shouldValidate: true });
                }}
                className="min-h-[80px] max-h-[200px] overflow-y-auto rounded-xl border border-border bg-input px-3 py-2 text-sm ring-offset-background transition-all duration-200 hover:border-primary/30 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/15 focus-visible:border-primary/60
                  empty:before:content-[attr(data-placeholder)] empty:before:text-muted-foreground empty:before:pointer-events-none
                  [&_table]:w-full [&_table]:border-collapse [&_table]:my-1 [&_table]:text-xs
                  [&_td]:border [&_td]:border-border [&_td]:px-1.5 [&_td]:py-0.5
                  [&_th]:border [&_th]:border-border [&_th]:px-1.5 [&_th]:py-0.5 [&_th]:bg-muted [&_th]:font-semibold
                  [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5"
              />
              {form.formState.errors.description && <p className="text-xs text-destructive">{form.formState.errors.description.message}</p>}
            </div>

            <div className="space-y-2 min-w-0">
              <label className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Attachments</label>
              <input
                ref={attachInputRef}
                type="file"
                multiple
                className="hidden"
                accept={ATTACHMENT_ACCEPT}
                onChange={(e) => { if (e.target.files?.length) addPendingFiles(e.target.files); e.target.value = ''; }}
              />
              <div
                onDragOver={(e) => { e.preventDefault(); setAttachDragging(true); }}
                onDragLeave={(e) => { e.preventDefault(); setAttachDragging(false); }}
                onDrop={(e) => { e.preventDefault(); setAttachDragging(false); if (e.dataTransfer.files?.length) addPendingFiles(e.dataTransfer.files); }}
                onClick={() => attachInputRef.current?.click()}
                className={`flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-4 cursor-pointer transition-colors select-none ${
                  attachDragging
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'border-primary/20 bg-accent/30 hover:border-primary/45 hover:bg-accent/50 text-muted-foreground hover:text-foreground'
                }`}
              >
                <Upload className="h-5 w-5" />
                <p className="text-xs font-medium">
                  {attachDragging ? 'Drop files to attach' : 'Drag & drop or click to add files'}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Up to 30 MB each · uploaded when the task is {isEdit ? 'updated' : 'created'}
                </p>
              </div>

              <div className="space-y-1">
                {existingAttachments.map((att) => (
                  <div key={att.id} className="flex items-center gap-2.5 py-1.5 px-2.5 rounded-xl border border-transparent hover:border-border hover:bg-muted/50 group transition-all duration-150">
                    <FileIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{att.original_name}</p>
                      <p className="text-[10px] text-muted-foreground">{formatFileSize(att.size_bytes)} · uploaded</p>
                    </div>
                    <button
                      type="button"
                      title="Delete attachment"
                      className="h-6 w-6 flex items-center justify-center rounded-md text-muted-foreground/60 opacity-0 group-hover:opacity-100 hover:text-destructive hover:bg-destructive/10 transition-all"
                      onClick={() => { void deleteExistingAttachment(att.id); }}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}

                {pendingFiles.map((f, idx) => {
                  const progress = pendingProgress[idx];
                  const isUploading = loading && progress !== undefined;
                  return (
                    <div key={`${f.name}-${idx}`} className="flex items-center gap-2.5 py-1.5 px-2.5 rounded-xl border border-primary/20 bg-primary/5 group transition-all duration-150">
                      <FileIcon className="h-4 w-4 text-primary shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{f.name}</p>
                        {isUploading ? (
                          <div className="mt-1 h-1.5 w-full rounded-full bg-muted overflow-hidden">
                            <div className="h-full rounded-full bg-primary transition-all duration-150" style={{ width: `${progress}%` }} />
                          </div>
                        ) : (
                          <p className="text-[10px] text-muted-foreground">{formatFileSize(f.size)} · will upload on save</p>
                        )}
                      </div>
                      {isUploading ? (
                        <span className="text-[11px] font-semibold tabular-nums text-primary shrink-0">{progress}%</span>
                      ) : (
                        <button
                          type="button"
                          title="Remove file"
                          className="h-6 w-6 flex items-center justify-center rounded-md text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 transition-all"
                          onClick={() => removePendingFile(idx)}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </>

          <div className="space-y-2">
            <label className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Assign To *</label>
            <div className="space-y-2">
              <Input
                id="task-assigned-search"
                placeholder="Search user (LDAP/local)..."
                value={assigneeQuery}
                onChange={(e) => setAssigneeQuery(e.target.value)}
              />

              {assignedToIds.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {assignedToIds.map((id) => {
                    const selected = assigneeOptions.find((u) => String(u.id) === id);
                    if (!selected) return null;
                    return (
                      <span key={id} className="inline-flex items-center gap-1 rounded-full bg-primary/12 text-primary px-2.5 py-1 text-xs font-medium">
                        {selected.display_name || selected.username}
                        <button
                          type="button"
                          className="text-primary/70 hover:text-primary"
                          onClick={() => toggleAssignee(id)}
                          aria-label={`Remove ${selected.display_name || selected.username}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}

              {showAssigneeResults && (
                <div className="rounded-xl glass-subtle max-h-36 overflow-y-auto p-2 space-y-2">
                  {displayedAssigneeOptions.length === 0 && !assigneeLoading && (
                    <p className="text-xs text-muted-foreground px-1">No users found. Start typing to search LDAP.</p>
                  )}
                  {assigneeLoading && <p className="text-xs text-muted-foreground px-1">Searching LDAP users...</p>}

                  {displayedAssigneeOptions.map((u) => {
                    const userId = String(u.id);
                    const checked = assignedToIds.includes(userId);
                    return (
                      <label key={u.id} className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-muted cursor-pointer">
                        <Checkbox checked={checked} onCheckedChange={() => selectAssigneeFromSearch(userId)} />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium leading-tight">{u.display_name || u.username}</span>
                          <span className="block text-xs text-muted-foreground truncate">{u.username}{u.email ? ` ·${u.email}` : ''}{u.source ? ` ·${u.source.toUpperCase()}` : ''}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}

              <p className="text-xs text-muted-foreground">First selected assignee is treated as primary. Default is Me.</p>
              {form.formState.errors.assignedToIds && <p className="text-xs text-destructive">{form.formState.errors.assignedToIds.message}</p>}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Information</label>
            <div className="space-y-2">
              <Input
                id="task-information-search"
                placeholder="Search user (LDAP/local)..."
                value={informationQuery}
                onChange={(e) => setInformationQuery(e.target.value)}
              />

              {informationIds.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {informationIds.map((id) => {
                    const selected = assigneeOptions.find((u) => String(u.id) === id);
                    if (!selected) return null;
                    return (
                      <span key={id} className="inline-flex items-center gap-1 rounded-full bg-muted text-muted-foreground px-2.5 py-1 text-xs font-medium border border-border">
                        {selected.display_name || selected.username}
                        <button
                          type="button"
                          className="text-muted-foreground/70 hover:text-foreground"
                          onClick={() => toggleInformationUser(id)}
                          aria-label={`Remove ${selected.display_name || selected.username}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}

              {showInformationResults && (
                <div className="rounded-xl glass-subtle max-h-36 overflow-y-auto p-2 space-y-2">
                  {displayedInformationOptions.length === 0 && !informationLoading && (
                    <p className="text-xs text-muted-foreground px-1">No users found. Start typing to search LDAP.</p>
                  )}
                  {informationLoading && <p className="text-xs text-muted-foreground px-1">Searching LDAP users...</p>}

                  {displayedInformationOptions.map((u) => {
                    const userId = String(u.id);
                    const checked = informationIds.includes(userId);
                    return (
                      <label key={u.id} className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-muted cursor-pointer">
                        <Checkbox checked={checked} onCheckedChange={() => selectInformationFromSearch(userId)} />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium leading-tight">{u.display_name || u.username}</span>
                          <span className="block text-xs text-muted-foreground truncate">{u.username}{u.email ? ` ·${u.email}` : ''}{u.source ? ` ·${u.source.toUpperCase()}` : ''}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}

              <p className="text-xs text-muted-foreground">These users will receive all task emails but are not assignees.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Company</label>
              <Select
                value={form.watch('companyId') || '__none__'}
                onValueChange={(v) => form.setValue('companyId', v === '__none__' ? '' : v, { shouldDirty: true })}
              >
                <SelectTrigger id="task-company"><SelectValue placeholder="Select Company" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Select Company</SelectItem>
                  {availableCompanies.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.code ? `${c.code} - ` : ''}{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Department *</label>
              <Select
                value={form.watch('deptId') || '__none__'}
                onValueChange={(v) => form.setValue('deptId', v === '__none__' ? '' : v, { shouldDirty: true, shouldValidate: true })}
              >
                <SelectTrigger id="task-department"><SelectValue placeholder="Select Department" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Select Department</SelectItem>
                  {allowedDepartments.map((d) => <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {!!selectedCompanyId && allowedDepartments.length === 0 && (
                <p className="text-xs text-muted-foreground">No departments are mapped to this company yet.</p>
              )}
              {form.formState.errors.deptId && <p className="text-xs text-destructive">{form.formState.errors.deptId.message}</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Priority *</label>
              <Select value={form.watch('priority')} onValueChange={(v) => form.setValue('priority', v as TaskFormValues['priority'])}>
                <SelectTrigger id="task-priority"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRIORITY_OPTIONS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Target Date *</label>
              <Input id="task-target-date" type="datetime-local" min={nowLocalDateTime} {...form.register('targetCompletionDate')} />
              {form.formState.errors.targetCompletionDate && <p className="text-xs text-destructive">{form.formState.errors.targetCompletionDate.message}</p>}
            </div>
          </div>

          {!isEdit && (
            <div className="space-y-2">
              <label className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Reminder Date & Time *</label>
              <Input id="task-reminder-date" type="datetime-local" min={nowLocalDateTime} max={targetCompletionDateValue || undefined} {...form.register('nextFollowUpDate')} />
              {form.formState.errors.nextFollowUpDate && <p className="text-xs text-destructive">{form.formState.errors.nextFollowUpDate.message}</p>}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {isEdit ? 'Update' : 'Create'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

