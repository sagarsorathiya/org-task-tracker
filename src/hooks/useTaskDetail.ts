import useSWR from 'swr';
import type { Task, Subtask, TaskComment, TaskActivity, TaskAttachment, ReminderRule, User, ApiResponse } from '@/types';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface TaskDetailData {
  task: Task;
  subtasks: Subtask[];
  comments: TaskComment[];
  activity: TaskActivity[];
  attachments: TaskAttachment[];
  reminders: ReminderRule[];
  assignedUsers?: Array<Pick<User, 'id' | 'username' | 'display_name'>>;
}

export function useTaskDetail(taskId: number | string | null) {
  const { data, error, isLoading, mutate } = useSWR<ApiResponse<TaskDetailData>>(
    taskId ? `/api/tasks/${taskId}` : null,
    fetcher,
    { revalidateOnFocus: false }
  );

  return {
    data: data?.data || null,
    task: data?.data?.task || null,
    subtasks: data?.data?.subtasks || [],
    comments: data?.data?.comments || [],
    activity: data?.data?.activity || [],
    attachments: data?.data?.attachments || [],
    reminders: data?.data?.reminders || [],
    assignedUsers: data?.data?.assignedUsers || [],
    isLoading,
    isError: !!error,
    notFound: !!data && !data.success,
    apiError: data?.error,
    mutate,
  };
}
