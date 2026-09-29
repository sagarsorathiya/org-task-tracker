'use client';

import React from 'react';
import { PageHeader } from '@/components/shared/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useNotifications } from '@/hooks/useNotifications';
import { formatDateTime } from '@/lib/utils';

export default function NotificationsPage() {
  const { notifications, unreadCount, isLoading, markRead } = useNotifications();

  return (
    <div className="space-y-6">
      <PageHeader title="Notifications" subtitle={`${unreadCount} unread`}>
        <Button variant="outline" size="sm" onClick={() => markRead()} disabled={isLoading || unreadCount === 0}>
          Mark all read
        </Button>
      </PageHeader>

      <div className="space-y-3">
        {!isLoading && notifications.length === 0 && (
          <Card>
            <CardContent className="py-8 text-sm text-muted-foreground">No notifications found.</CardContent>
          </Card>
        )}

        {notifications.map((n) => (
          <Card key={n.id}>
            <CardContent className="py-4 flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Badge variant={n.is_read ? 'secondary' : 'destructive'}>{n.is_read ? 'Read' : 'Unread'}</Badge>
                  <span className="text-xs text-muted-foreground uppercase tracking-wide">{n.type}</span>
                </div>
                <p className="text-sm">{n.message}</p>
                <p className="text-xs text-muted-foreground">{formatDateTime(n.created_at)}</p>
              </div>

              {!n.is_read && (
                <Button variant="ghost" size="sm" onClick={() => markRead(n.id)}>
                  Mark read
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
