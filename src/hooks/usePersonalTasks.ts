import useSWR from 'swr';
import type { PersonalTask, PersonalSubtask, PersonalReminder, PersonalActivity, PersonalComment, PersonalRecurrence, ApiResponse } from '@/types';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export type PersonalStatusFilter = 'all' | 'pending' | 'done';

export function usePersonalTasks(status: PersonalStatusFilter = 'all') {
  const url = `/api/personal-tasks${status !== 'all' ? `?status=${status}` : ''}`;

  const { data, error, isLoading, mutate } = useSWR<ApiResponse<PersonalTask[]>>(url, fetcher, {
    revalidateOnFocus: false,
  });

  const tasks = data?.data ?? [];

  async function create(payload: {
    title: string;
    notes?: string | null;
    priority?: 'low' | 'medium' | 'high';
    due_date?: string | null;
    due_time?: string | null;
    recurrence_rule?: PersonalRecurrence;
  }) {
    const optimisticTask: PersonalTask = {
      id: -Date.now(),
      user_id: 0,
      title: payload.title,
      notes: payload.notes ?? null,
      priority: payload.priority ?? 'medium',
      due_date: payload.due_date ?? null,
      due_time: payload.due_time ?? null,
      status: 'pending',
      remind_at: null,
      remind_channel: null,
      recurrence_rule: payload.recurrence_rule ?? 'none',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      subtasks: [],
      reminders: [],
    };

    const optimisticData: ApiResponse<PersonalTask[]> = {
      success: true,
      data: status === 'done' ? tasks : [optimisticTask, ...tasks],
    };

    const res = await mutate(
      async () => {
        const r = await fetch('/api/personal-tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const json: ApiResponse<PersonalTask> = await r.json();
        if (!json.success) throw new Error(json.error);
        const fetched: ApiResponse<PersonalTask[]> = await fetch(url).then((x) => x.json());
        return fetched;
      },
      { optimisticData, rollbackOnError: true, revalidate: false }
    );

    return (res?.data ?? [])[0] ?? optimisticTask;
  }

  async function update(id: number, payload: Partial<{
    title: string;
    notes: string | null;
    priority: 'low' | 'medium' | 'high';
    due_date: string | null;
    due_time: string | null;
    remind_at: string | null;
    remind_channel: 'email' | 'whatsapp' | 'both' | 'in_app' | null;
    status: 'pending' | 'done';
    recurrence_rule: PersonalRecurrence;
  }>) {
    const res = await fetch(`/api/personal-tasks/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json: ApiResponse<PersonalTask> = await res.json();
    if (!json.success) throw new Error(json.error);
    await mutate();
    return json.data!;
  }

  async function toggleDone(id: number) {
    const current = tasks.find((t) => t.id === id);
    const newStatus = current?.status === 'done' ? 'pending' : 'done';

    const optimisticData: ApiResponse<PersonalTask[]> = {
      success: true,
      data: tasks.map((t) => t.id === id ? { ...t, status: newStatus } : t),
    };

    await mutate(
      async () => {
        const r = await fetch(`/api/personal-tasks/${id}`, { method: 'PATCH' });
        const json: ApiResponse<PersonalTask> = await r.json();
        if (!json.success) throw new Error(json.error);
        return { success: true, data: tasks.map((t) => t.id === id ? json.data! : t) };
      },
      { optimisticData, rollbackOnError: true, revalidate: true }
    );
  }

  async function remove(id: number) {
    const optimisticData: ApiResponse<PersonalTask[]> = {
      success: true,
      data: tasks.filter((t) => t.id !== id),
    };
    await mutate(
      async () => {
        const r = await fetch(`/api/personal-tasks/${id}`, { method: 'DELETE' });
        const json: ApiResponse<null> = await r.json();
        if (!json.success) throw new Error(json.error);
        return { success: true, data: tasks.filter((t) => t.id !== id) };
      },
      { optimisticData, rollbackOnError: true, revalidate: false }
    );
  }

  async function addSubtask(taskId: number, title: string): Promise<PersonalSubtask> {
    const res = await fetch(`/api/personal-tasks/${taskId}/subtasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    const json: ApiResponse<PersonalSubtask> = await res.json();
    if (!json.success) throw new Error(json.error);
    await mutate();
    return json.data!;
  }

  async function toggleSubtask(taskId: number, subtaskId: number): Promise<PersonalSubtask> {
    const res = await fetch(`/api/personal-tasks/${taskId}/subtasks/${subtaskId}`, { method: 'PATCH' });
    const json: ApiResponse<PersonalSubtask> = await res.json();
    if (!json.success) throw new Error(json.error);
    await mutate(
      (prev) => prev
        ? {
            ...prev,
            data: (prev.data ?? []).map((t) =>
              t.id === taskId
                ? { ...t, subtasks: t.subtasks.map((s) => s.id === subtaskId ? json.data! : s) }
                : t
            ),
          }
        : prev,
      { revalidate: false }
    );
    return json.data!;
  }

  async function removeSubtask(taskId: number, subtaskId: number) {
    const res = await fetch(`/api/personal-tasks/${taskId}/subtasks/${subtaskId}`, { method: 'DELETE' });
    const json: ApiResponse<null> = await res.json();
    if (!json.success) throw new Error(json.error);
    await mutate(
      (prev) => prev
        ? {
            ...prev,
            data: (prev.data ?? []).map((t) =>
              t.id === taskId
                ? { ...t, subtasks: t.subtasks.filter((s) => s.id !== subtaskId) }
                : t
            ),
          }
        : prev,
      { revalidate: false }
    );
  }

  async function addReminder(taskId: number, remind_at: string, channel: PersonalReminder['channel']): Promise<PersonalReminder> {
    const res = await fetch(`/api/personal-tasks/${taskId}/reminders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ remind_at, channel }),
    });
    const json: ApiResponse<PersonalReminder> = await res.json();
    if (!json.success) throw new Error(json.error);
    await mutate(
      (prev) => prev
        ? {
            ...prev,
            data: (prev.data ?? []).map((t) =>
              t.id === taskId
                ? { ...t, reminders: [...t.reminders, json.data!] }
                : t
            ),
          }
        : prev,
      { revalidate: false }
    );
    return json.data!;
  }

  async function deleteReminder(taskId: number, reminderId: number) {
    const res = await fetch(`/api/personal-tasks/${taskId}/reminders/${reminderId}`, { method: 'DELETE' });
    const json: ApiResponse<null> = await res.json();
    if (!json.success) throw new Error(json.error);
    await mutate(
      (prev) => prev
        ? {
            ...prev,
            data: (prev.data ?? []).map((t) =>
              t.id === taskId
                ? { ...t, reminders: t.reminders.filter((r) => r.id !== reminderId) }
                : t
            ),
          }
        : prev,
      { revalidate: false }
    );
  }

  return {
    tasks,
    isLoading,
    isError: !!error,
    mutate,
    create,
    update,
    toggleDone,
    remove,
    addSubtask,
    toggleSubtask,
    removeSubtask,
    addReminder,
    deleteReminder,
  };
}

export function usePersonalTaskActivity(taskId: number | null) {
  const url = taskId ? `/api/personal-tasks/${taskId}/activity` : null;
  const { data, isLoading, mutate } = useSWR<ApiResponse<PersonalActivity[]>>(url, fetcher, {
    revalidateOnFocus: false,
  });
  return {
    activity: data?.data ?? [],
    isLoading,
    mutate,
  };
}

export function usePersonalTaskComments(taskId: number | null) {
  const url = taskId ? `/api/personal-tasks/${taskId}/comments` : null;
  const { data, isLoading, mutate } = useSWR<ApiResponse<PersonalComment[]>>(url, fetcher, {
    revalidateOnFocus: false,
  });

  async function postComment(body: string) {
    const res = await fetch(`/api/personal-tasks/${taskId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    });
    const json: ApiResponse<PersonalComment> = await res.json();
    if (!json.success) throw new Error(json.error);
    await mutate();
    return json.data!;
  }

  async function deleteComment(commentId: number) {
    const res = await fetch(`/api/personal-tasks/${taskId}/comments?commentId=${commentId}`, { method: 'DELETE' });
    const json: ApiResponse<null> = await res.json();
    if (!json.success) throw new Error(json.error);
    await mutate();
  }

  return {
    comments: data?.data ?? [],
    isLoading,
    postComment,
    deleteComment,
    mutate,
  };
}
