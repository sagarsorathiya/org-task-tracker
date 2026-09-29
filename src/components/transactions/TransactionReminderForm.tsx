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
import { Loader2, X, Upload, FileIcon } from 'lucide-react';
import { MAX_FILE_SIZE_BYTES, TRANSACTION_REMINDER_TYPE_OPTIONS, TRANSACTION_REMINDER_RECURRENCE_OPTIONS } from '@/constants';
import { formatFileSize } from '@/lib/utils';
import toast from 'react-hot-toast';
import type { Company, Department, DeptCompanyMap, TransactionReminder, TransactionReminderAttachment } from '@/types';

const ATTACHMENT_ACCEPT = 'image/*,.eml,.msg,.pdf,.doc,.docx,.dotx,.docm,.xls,.xlsx,.xlsm,.xlsb,.xltx,.ppt,.pptx,.pptm,.potx,.rtf,.odt,.ods,.odp,.csv,.tsv,.txt,.log,.md,.json,.xml';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface DomainUserOption {
  id: number;
  username: string;
  display_name: string | null;
  email: string | null;
  source?: 'local' | 'ldap';
}

const transactionSchema = z.object({
  type: z.enum(['subscription', 'payment']),
  partyName: z.string().min(1, 'Party Name is required').max(300),
  vendorCode: z.string().max(100).optional(),
  place: z.string().max(200).optional(),
  agreement: z.string().max(5000).optional(),
  executionDate: z.string().optional(),
  billDate: z.string().optional(),
  reminderDate: z.string().min(1, 'Reminder Date is required'),
  reminderTime: z.string().min(1, 'Reminder Time is required'),
  recurrence: z.enum(['none', 'weekly', 'monthly', 'yearly']),
  reminderEmails: z.array(z.string().email()).min(1, 'At least one reminder email is required'),
  companyId: z.string().optional(),
  deptId: z.string().min(1, 'Department is required'),
});

type TransactionFormValues = z.infer<typeof transactionSchema>;

interface TransactionReminderFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  record?: TransactionReminder | null;
  onSuccess: () => void;
}

export function TransactionReminderForm({ open, onOpenChange, record, onSuccess }: TransactionReminderFormProps) {
  const isEdit = !!record;
  const { data: session } = useSession();
  const [loading, setLoading] = useState(false);
  const [emailInput, setEmailInput] = useState('');
  const [domainOptions, setDomainOptions] = useState<DomainUserOption[]>([]);
  const [domainLoading, setDomainLoading] = useState(false);
  const attachInputRef = useRef<HTMLInputElement>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [pendingProgress, setPendingProgress] = useState<Record<number, number>>({});
  const [existingAttachments, setExistingAttachments] = useState<TransactionReminderAttachment[]>([]);
  const [attachDragging, setAttachDragging] = useState(false);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [deptCompanyMap, setDeptCompanyMap] = useState<DeptCompanyMap[]>([]);

  const orgCacheRef = useRef<{ companies: Company[]; departments: Department[]; deptCompanyMap: DeptCompanyMap[] } | null>(null);

  const form = useForm<TransactionFormValues>({
    resolver: zodResolver(transactionSchema),
    defaultValues: {
      type: 'payment',
      partyName: '',
      vendorCode: '',
      place: '',
      agreement: '',
      executionDate: '',
      billDate: '',
      reminderDate: '',
      reminderTime: '09:00',
      recurrence: 'none',
      reminderEmails: [],
      companyId: '',
      deptId: '',
    },
  });

  const reminderEmails = form.watch('reminderEmails') ?? [];
  const selectedCompanyId = form.watch('companyId');

  const allowedDepartments = React.useMemo(() => {
    let base: Department[];
    if (!selectedCompanyId) {
      base = departments;
    } else {
      const mappedDeptIds = new Set(
        deptCompanyMap.filter((m) => String(m.company_id) === selectedCompanyId).map((m) => String(m.dept_id))
      );
      base = departments.filter((d) => mappedDeptIds.has(String(d.id)));
    }

    if (isEdit && record?.dept_id) {
      const recordDeptIdStr = String(record.dept_id);
      if (!base.some((d) => String(d.id) === recordDeptIdStr)) {
        const existingDept = departments.find((d) => String(d.id) === recordDeptIdStr);
        base = [...base, existingDept ?? ({ id: record.dept_id, name: record.dept_name ?? `Department #${record.dept_id}`, active: true } as Department)];
      }
    }

    return base;
  }, [departments, deptCompanyMap, selectedCompanyId, isEdit, record]);

  const availableCompanies = React.useMemo(() => {
    if (!isEdit || !record?.company_id) return companies;
    if (companies.some((c) => c.id === record.company_id)) return companies;
    return [...companies, { id: record.company_id, name: record.company_name ?? `Company #${record.company_id}`, code: '', active: true } as Company];
  }, [companies, isEdit, record]);

  useEffect(() => {
    if (!open) return;

    const loadFormOptions = async () => {
      try {
        if (orgCacheRef.current) {
          setCompanies(orgCacheRef.current.companies);
          setDepartments(orgCacheRef.current.departments);
          setDeptCompanyMap(orgCacheRef.current.deptCompanyMap);
          return;
        }

        const res = await fetch('/api/insights/filters');
        const data = res.ok ? await res.json() : { data: { companies: [], departments: [], deptCompanyMap: [] } };
        let nextCompanies: Company[] = data.data?.companies || [];
        let nextDepartments: Department[] = data.data?.departments || [];
        let nextMap: DeptCompanyMap[] = data.data?.deptCompanyMap || [];

        // Fallback for domain users without assignment rows yet: derive from org masters + session scope.
        if ((session?.user?.companyId || session?.user?.deptId) && (nextCompanies.length === 0 || nextMap.length === 0 || nextDepartments.length === 0)) {
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
            nextMap = allMap.filter((m) => m.company_id === sessionCompanyId) as DeptCompanyMap[];

            if (sessionDeptId) {
              if (nextDepartments.length === 0) {
                nextDepartments = allDepartments.filter((d) => d.id === sessionDeptId && d.active);
              }
              if (!nextMap.some((m) => m.company_id === sessionCompanyId && m.dept_id === sessionDeptId)) {
                nextMap = [...nextMap, { id: -1, company_id: sessionCompanyId, dept_id: sessionDeptId }];
              }
            } else {
              const deptIds = new Set(nextMap.map((m) => m.dept_id));
              nextDepartments = allDepartments.filter((d) => deptIds.has(d.id) && d.active);
            }
          }
        }

        setCompanies(nextCompanies);
        setDepartments(nextDepartments);
        setDeptCompanyMap(nextMap);
        orgCacheRef.current = { companies: nextCompanies, departments: nextDepartments, deptCompanyMap: nextMap };
      } catch {
        setCompanies([]);
        setDepartments([]);
        setDeptCompanyMap([]);
        toast.error('Failed to load company/department scope options');
      }
    };

    void loadFormOptions();

    if (record) {
      form.reset({
        type: record.type || 'payment',
        partyName: record.party_name || '',
        vendorCode: record.vendor_code || '',
        place: record.place || '',
        agreement: record.agreement || '',
        executionDate: record.execution_date ? record.execution_date.split('T')[0] : '',
        billDate: record.bill_date ? record.bill_date.split('T')[0] : '',
        reminderDate: record.reminder_date ? record.reminder_date.split('T')[0] : '',
        reminderTime: (record.reminder_time || '09:00:00').slice(0, 5),
        recurrence: record.recurrence || 'none',
        reminderEmails: record.reminder_emails || [],
        companyId: record.company_id ? String(record.company_id) : '',
        deptId: record.dept_id ? String(record.dept_id) : '',
      });
    } else {
      form.reset({
        type: 'payment',
        partyName: '',
        vendorCode: '',
        place: '',
        agreement: '',
        executionDate: '',
        billDate: '',
        reminderDate: '',
        reminderTime: '09:00',
        recurrence: 'none',
        reminderEmails: [],
        companyId: session?.user?.companyId ? String(session.user.companyId) : '',
        deptId: session?.user?.deptId ? String(session.user.deptId) : '',
      });
    }
  }, [open, record, form, session?.user?.companyId, session?.user?.deptId]);

  useEffect(() => {
    if (!open) return;
    setPendingFiles([]);
    setPendingProgress({});
    setAttachDragging(false);
    setEmailInput('');
    setDomainOptions([]);
    if (record?.id) {
      fetch(`/api/transactions/${record.id}/attachments`)
        .then((r) => r.json())
        .then((d) => { if (d.success && Array.isArray(d.data)) setExistingAttachments(d.data); })
        .catch(() => { /* non-blocking */ });
    } else {
      setExistingAttachments([]);
    }
  }, [open, record]);

  useEffect(() => {
    if (!selectedCompanyId) return;
    if (deptCompanyMap.length === 0) return;

    const currentDeptId = form.getValues('deptId');
    if (isEdit && record?.dept_id && currentDeptId === String(record.dept_id)) return;

    const mappedDeptIds = new Set(
      deptCompanyMap.filter((m) => String(m.company_id) === selectedCompanyId).map((m) => String(m.dept_id))
    );
    const mappedAvailableDeptIds = departments.map((d) => String(d.id)).filter((id) => mappedDeptIds.has(id));

    if (currentDeptId && mappedAvailableDeptIds.includes(currentDeptId)) return;

    form.setValue('deptId', mappedAvailableDeptIds.length === 1 ? mappedAvailableDeptIds[0] : '', { shouldDirty: true });
  }, [selectedCompanyId, deptCompanyMap, departments, form, isEdit, record?.dept_id]);

  useEffect(() => {
    if (!open || !emailInput.trim() || emailInput.trim().length < 2) {
      setDomainOptions([]);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setDomainLoading(true);
      try {
        const res = await fetch(`/api/users/search?q=${encodeURIComponent(emailInput.trim())}&limit=12`, { signal: controller.signal });
        const data = await res.json();
        if (data.success && Array.isArray(data.data)) {
          setDomainOptions(data.data);
        }
      } catch {
        // no-op for transient search failures
      } finally {
        setDomainLoading(false);
      }
    }, 250);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [emailInput, open]);

  const addEmailValue = (value: string) => {
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) return;
    if (!EMAIL_RE.test(trimmed)) {
      toast.error(`"${trimmed}" is not a valid email address`);
      return;
    }
    const current = form.getValues('reminderEmails') || [];
    if (!current.includes(trimmed)) {
      form.setValue('reminderEmails', [...current, trimmed], { shouldDirty: true, shouldValidate: true });
    }
    setEmailInput('');
    setDomainOptions([]);
  };

  const addEmail = () => addEmailValue(emailInput);

  const addEmailFromDomainUser = (user: DomainUserOption) => {
    if (!user.email) {
      toast.error(`${user.display_name || user.username} has no email address on file`);
      return;
    }
    addEmailValue(user.email);
  };

  const removeEmail = (email: string) => {
    const current = form.getValues('reminderEmails') || [];
    form.setValue('reminderEmails', current.filter((e) => e !== email), { shouldDirty: true, shouldValidate: true });
  };

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
    if (!record?.id) return;
    try {
      const res = await fetch(`/api/transactions/${record.id}/attachments?attachId=${attachId}`, { method: 'DELETE' });
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

  const uploadOneFile = (file: File, transactionId: number, onProgress: (pct: number) => void): Promise<{ success: boolean; error?: string }> => {
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
      xhr.open('POST', `/api/transactions/${transactionId}/attachments`);
      xhr.send(fd);
    });
  };

  const uploadPendingFiles = async (transactionId: number): Promise<number> => {
    let failed = 0;
    for (let i = 0; i < pendingFiles.length; i++) {
      const f = pendingFiles[i];
      setPendingProgress((prev) => ({ ...prev, [i]: 0 }));
      const result = await uploadOneFile(f, transactionId, (pct) => setPendingProgress((prev) => ({ ...prev, [i]: pct })));
      if (!result.success) {
        failed++;
        toast.error(`"${f.name}": ${result.error || 'upload failed'}`);
      }
    }
    return failed;
  };

  const handleSubmit = async (values: TransactionFormValues) => {
    setLoading(true);
    try {
      const body = {
        type: values.type,
        partyName: values.partyName.trim(),
        vendorCode: values.vendorCode?.trim() || undefined,
        place: values.place?.trim() || undefined,
        agreement: values.agreement?.trim() || undefined,
        executionDate: values.executionDate || undefined,
        billDate: values.billDate || undefined,
        reminderDate: values.reminderDate,
        reminderTime: values.reminderTime,
        recurrence: values.recurrence,
        reminderEmails: values.reminderEmails,
        companyId: values.companyId ? parseInt(values.companyId, 10) : undefined,
        deptId: values.deptId ? parseInt(values.deptId, 10) : undefined,
      };

      const res = await fetch(isEdit ? `/api/transactions/${record!.id}` : '/api/transactions', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (data.success) {
        const savedId = isEdit ? record!.id : (data.data as TransactionReminder | undefined)?.id;
        let failedUploads = 0;
        if (pendingFiles.length > 0 && savedId) {
          failedUploads = await uploadPendingFiles(savedId);
        }
        if (failedUploads > 0) {
          toast.error(
            `${isEdit ? 'Record updated' : 'Record created'}, but ${failedUploads} attachment${failedUploads > 1 ? 's' : ''} failed to upload`,
            { duration: 6000 }
          );
        } else {
          toast.success(isEdit ? 'Record updated' : 'Record created');
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
        className="w-[94vw] max-w-2xl flex flex-col max-h-[90vh] overflow-hidden"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="shrink-0">
          <DialogTitle>{isEdit ? 'Edit Transaction Reminder' : 'New Transaction Reminder'}</DialogTitle>
          <DialogDescription>
            A one-time reminder email with all details and attachments will be sent to the listed emails at the reminder date &amp; time.
          </DialogDescription>
        </DialogHeader>

        <form className="flex-1 overflow-y-auto space-y-4 py-2 pr-1" onSubmit={form.handleSubmit(handleSubmit)}>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Type *</label>
              <Select
                value={form.watch('type')}
                onValueChange={(v) => form.setValue('type', v as TransactionFormValues['type'], { shouldDirty: true })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TRANSACTION_REMINDER_TYPE_OPTIONS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Party Name *</label>
              <Input placeholder="Party / vendor name" {...form.register('partyName')} />
              {form.formState.errors.partyName && <p className="text-xs text-destructive">{form.formState.errors.partyName.message}</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Vendor Code</label>
              <Input placeholder="Vendor code" {...form.register('vendorCode')} />
            </div>
            <div className="space-y-2">
              <label className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Place</label>
              <Input placeholder="Place" {...form.register('place')} />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Agreement</label>
            <Input placeholder="Agreement / reference no." {...form.register('agreement')} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Execution Date</label>
              <Input type="date" {...form.register('executionDate')} />
            </div>
            <div className="space-y-2">
              <label className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Bill Date</label>
              <Input type="date" {...form.register('billDate')} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Reminder Date *</label>
              <Input type="date" {...form.register('reminderDate')} />
              {form.formState.errors.reminderDate && <p className="text-xs text-destructive">{form.formState.errors.reminderDate.message}</p>}
            </div>
            <div className="space-y-2">
              <label className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Reminder Time *</label>
              <Input type="time" {...form.register('reminderTime')} />
              {form.formState.errors.reminderTime && <p className="text-xs text-destructive">{form.formState.errors.reminderTime.message}</p>}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Repeat</label>
            <Select
              value={form.watch('recurrence')}
              onValueChange={(v) => form.setValue('recurrence', v as TransactionFormValues['recurrence'], { shouldDirty: true })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {TRANSACTION_REMINDER_RECURRENCE_OPTIONS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              When set, after each reminder is sent the Reminder Date (and Bill Date, if set) automatically advance to the next occurrence — no need to re-create this record.
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Reminder Emails *</label>
            <div className="flex gap-2">
              <Input
                placeholder="Search domain user or type an email..."
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault();
                    addEmail();
                  }
                }}
              />
              <Button type="button" variant="outline" onClick={addEmail}>Add</Button>
            </div>

            {(domainLoading || emailInput.trim().length >= 2) && (
              <div className="rounded-xl glass-subtle max-h-36 overflow-y-auto p-2 space-y-2">
                {domainLoading && <p className="text-xs text-muted-foreground px-1">Searching LDAP users...</p>}
                {!domainLoading && domainOptions.length === 0 && (
                  <p className="text-xs text-muted-foreground px-1">No users found. Press Enter to add &ldquo;{emailInput.trim()}&rdquo; as a manual email.</p>
                )}
                {domainOptions.map((u) => {
                  const alreadyAdded = !!u.email && reminderEmails.includes(u.email.toLowerCase());
                  return (
                    <label key={u.id} className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-muted cursor-pointer">
                      <Checkbox checked={alreadyAdded} onCheckedChange={() => addEmailFromDomainUser(u)} />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium leading-tight">{u.display_name || u.username}</span>
                        <span className="block text-xs text-muted-foreground truncate">
                          {u.email || 'No email on file'}{u.source ? ` ·${u.source.toUpperCase()}` : ''}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            )}

            {reminderEmails.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {reminderEmails.map((email) => (
                  <span key={email} className="inline-flex items-center gap-1 rounded-full bg-primary/12 text-primary px-2.5 py-1 text-xs font-medium">
                    {email}
                    <button type="button" className="text-primary/70 hover:text-primary" onClick={() => removeEmail(email)} aria-label={`Remove ${email}`}>
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {form.formState.errors.reminderEmails && <p className="text-xs text-destructive">{form.formState.errors.reminderEmails.message}</p>}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Company</label>
              <Select
                value={form.watch('companyId') || '__none__'}
                onValueChange={(v) => form.setValue('companyId', v === '__none__' ? '' : v, { shouldDirty: true })}
              >
                <SelectTrigger><SelectValue placeholder="Select Company" /></SelectTrigger>
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
                <SelectTrigger><SelectValue placeholder="Select Department" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Select Department</SelectItem>
                  {allowedDepartments.map((d) => <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {form.formState.errors.deptId && <p className="text-xs text-destructive">{form.formState.errors.deptId.message}</p>}
            </div>
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
                Up to 30 MB each · sent with the reminder email
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
