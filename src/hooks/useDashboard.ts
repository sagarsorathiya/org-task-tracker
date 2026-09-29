import useSWR from 'swr';
import type { DashboardStats, Task, ApiResponse } from '@/types';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useDashboard() {
  const { data: statsData, isLoading: statsLoading } = useSWR<ApiResponse<DashboardStats>>(
    '/api/dashboard/stats',
    fetcher,
    { revalidateOnFocus: false, refreshInterval: 60000 }
  );

  const { data: upcomingData, isLoading: upcomingLoading } = useSWR<ApiResponse<Task[]>>(
    '/api/dashboard/upcoming',
    fetcher,
    { revalidateOnFocus: false, refreshInterval: 60000 }
  );

  return {
    stats: statsData?.data || null,
    upcoming: upcomingData?.data || [],
    isLoading: statsLoading || upcomingLoading,
  };
}
