import useSWR from 'swr';
import type { Notification, ApiResponse } from '@/types';

const fetcher = (url: string) => fetch(url, { cache: 'no-store' }).then((r) => r.json());

export function useNotifications() {
  const { data, error, isLoading, mutate } = useSWR<ApiResponse<Notification[]>>(
    '/api/notifications',
    fetcher,
    { refreshInterval: 10000, revalidateOnFocus: true }
  );

  const notifications = data?.data || [];
  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const markRead = async (id?: number) => {
    await fetch('/api/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(id ? { id } : { readAll: true }),
    });
    mutate();
  };

  return {
    notifications,
    unreadCount,
    isLoading,
    isError: error,
    mutate,
    markRead,
  };
}
