import useSWR from 'swr';
import { buildSearchParams } from '@/lib/utils';
import type { Task, PaginatedResponse, ApiResponse } from '@/types';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface UseTasksParams {
  search?: string;
  status?: string;
  priority?: string;
  deptId?: string;
  companyId?: string;
  assignedTo?: string;
  deleted?: boolean;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortDir?: string;
}

export function useTasks(params: UseTasksParams = {}) {
  const qs = buildSearchParams({
    search: params.search,
    status: params.status,
    priority: params.priority,
    deptId: params.deptId,
    companyId: params.companyId,
    assignedTo: params.assignedTo,
    deleted: params.deleted ? 'true' : undefined,
    page: params.page || 1,
    limit: params.limit || 20,
    sortBy: params.sortBy,
    sortDir: params.sortDir,
  });

  const { data, error, isLoading, mutate } = useSWR<ApiResponse<PaginatedResponse<Task>>>(
    `/api/tasks?${qs}`,
    fetcher,
    { revalidateOnFocus: true, refreshInterval: 0 }
  );

  return {
    tasks: data?.data?.items || [],
    total: data?.data?.total || 0,
    page: data?.data?.page || 1,
    totalPages: data?.data?.totalPages || 1,
    isLoading,
    isError: error,
    mutate,
  };
}
