'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { useRouter, usePathname } from 'next/navigation';
import { Bell, Check, CheckCheck, LogOut, X, Calendar, Clock, ArrowRightLeft, UserPlus, AlertTriangle, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNotifications } from '@/hooks/useNotifications';
import toast from 'react-hot-toast';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatSystemRole } from '@/lib/utils';
import { OutlookAddinModal } from '@/components/layout/OutlookAddinModal';
import { AvatarInitials } from '@/components/ui/avatar-initials';
import { ThemeToggle } from '@/components/shared/ThemeToggle';
import type { Notification } from '@/types';

function notifIcon(type: string) {
  if (type === 'reminder_sent')       return { Icon: Clock,           bg: 'bg-warning/15',     color: 'text-warning' };
  if (type === 'task_status_changed') return { Icon: ArrowRightLeft,  bg: 'bg-info/15',        color: 'text-info' };
  if (type === 'task_assigned')       return { Icon: UserPlus,        bg: 'bg-primary/15',     color: 'text-primary' };
  if (type === 'task_overdue')        return { Icon: AlertTriangle,   bg: 'bg-destructive/15', color: 'text-destructive' };
  if (type === 'comment_added')       return { Icon: MessageSquare,   bg: 'bg-success/15',     color: 'text-success' };
  return                                     { Icon: Bell,            bg: 'bg-muted',          color: 'text-muted-foreground' };
}

const PAGE_LABELS: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/tasks': 'Tasks',
  '/personal': 'Personal Tasks',
  '/reminders': 'Alerts',
  '/insights': 'Insights',
  '/config': 'Config',
  '/users': 'Users',
  '/org': 'Organization',
};

function PageBreadcrumb() {
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean);
  const topLevel = '/' + (segments[0] ?? '');
  const label = PAGE_LABELS[topLevel] ?? segments[0];
  const subLabel = segments.length > 1 ? `#${segments[segments.length - 1]}` : null;

  return (
    <div className="flex items-center gap-1.5 text-sm">
      <span className="font-medium text-foreground">{label}</span>
      {subLabel && (
        <>
          <span className="text-muted-foreground/50">/</span>
          <span className="text-muted-foreground text-xs">{subLabel}</span>
        </>
      )}
    </div>
  );
}

export function Topbar() {
  const { data: session } = useSession();
  const router = useRouter();
  const { notifications, unreadCount, markRead, isLoading } = useNotifications();
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [addinModalOpen, setAddinModalOpen] = useState(false);
  const knownNotificationIdsRef = useRef<Set<number>>(new Set());
  const initializedRef = useRef(false);

  const username = session?.user?.username || 'User';

  const handleSignOut = async () => {
    try {
      await fetch('/api/auth/logout-audit', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    } catch {
      // non-blocking
    } finally {
      await signOut({ redirectTo: '/login' });
    }
  };

  useEffect(() => {
    // Wait for the first real fetch before initializing — prevents a toast storm at login
    // where SWR initially returns [] then arrives with all unread notifications at once.
    if (isLoading) return;

    const ids = new Set(notifications.map((n) => n.id));
    if (!initializedRef.current) {
      knownNotificationIdsRef.current = ids;
      initializedRef.current = true;
      return;
    }

    const incoming = notifications.filter((n) => !knownNotificationIdsRef.current.has(n.id) && !n.is_read);
    if (incoming.length > 1) {
      // Group multiple new notifications into a single toast
      toast.custom(
        (t) => (
          <div className="pointer-events-auto flex max-w-md items-start gap-2 rounded-xl border border-border glass-card px-3 py-2 text-sm text-card-foreground shadow-lg">
            <span className="mt-0.5 text-primary">●</span>
            <p className="flex-1 leading-snug">
              <span className="font-medium">{incoming.length} new notifications</span>
              <button
                type="button"
                onClick={() => { toast.dismiss(t.id); setAlertsOpen(true); }}
                className="ml-2 text-primary underline underline-offset-2"
              >
                View
              </button>
            </p>
            <button
              type="button"
              aria-label="Close notification"
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
              onClick={() => toast.dismiss(t.id)}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ),
        { id: 'notif-group', duration: 5000 }
      );
    } else if (incoming.length === 1) {
      const item = incoming[0];
      toast.custom(
        (t) => (
          <div className="pointer-events-auto flex max-w-md items-start gap-2 rounded-xl border border-border glass-card px-3 py-2 text-sm text-card-foreground shadow-lg">
            <span className="mt-0.5 text-primary">●</span>
            <p className="flex-1 leading-snug">{item.message}</p>
            <button
              type="button"
              aria-label="Close notification"
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
              onClick={() => toast.dismiss(t.id)}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ),
        { id: `notif-${item.id}`, duration: 5000 }
      );
    }

    knownNotificationIdsRef.current = ids;
  }, [notifications, isLoading]);

  const recentNotifications = notifications.slice(0, 8);

  const openNotification = async (item: Notification) => {
    setAlertsOpen(false);
    if (!item.is_read) await markRead(item.id);
    if (item.ref_task_id) {
      router.push(`/tasks/${item.ref_task_id}`);
      return;
    }
    router.push('/reminders');
  };

  return (
    <header className="sticky top-0 z-30 flex h-12 items-center justify-between border-b border-border topbar-panel px-4">
      {/* Left — breadcrumb */}
      <PageBreadcrumb />

      {/* Right — actions */}
      <div className="flex items-center gap-1">
        {/* Theme toggle */}
        <ThemeToggle />

        {/* Notifications */}
        <DropdownMenu modal={false} open={alertsOpen} onOpenChange={setAlertsOpen}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="relative h-8 w-8 text-muted-foreground hover:text-foreground" id="notifications-bell" type="button">
              <Bell className="h-4 w-4" />
              {unreadCount > 0 && (
                <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-primary" />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[340px] p-0">
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">Alerts</span>
                {unreadCount > 0 && (
                  <span className="inline-flex h-4 min-w-[16px] items-center justify-center rounded bg-muted px-1 text-[10px] font-semibold text-primary">
                    {unreadCount}
                  </span>
                )}
              </div>
              <button
                type="button"
                disabled={unreadCount === 0}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); void markRead(); }}
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <CheckCheck className="h-3 w-3" /> All read
              </button>
            </div>

            {/* Items */}
            <div className="max-h-[360px] overflow-y-auto">
              {recentNotifications.length === 0 && (
                <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground">
                  <Bell className="h-6 w-6 opacity-30" />
                  <span className="text-sm">No alerts yet</span>
                </div>
              )}
              {recentNotifications.map((item) => {
                const icon = notifIcon(item.type);
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`w-full flex items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/60 border-b border-border last:border-0 ${!item.is_read ? 'bg-primary/5' : ''}`}
                    onClick={() => { void openNotification(item); }}
                  >
                    {/* Icon badge */}
                    <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${icon.bg}`}>
                      <icon.Icon className={`h-3.5 w-3.5 ${icon.color}`} />
                    </div>

                    {/* Text */}
                    <div className="min-w-0 flex-1">
                      <p className={`text-[12.5px] leading-snug ${!item.is_read ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>
                        {item.message}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground/70">
                        {new Date(item.created_at).toLocaleString()}
                      </p>
                    </div>

                    {/* Unread dot + mark read */}
                    <div className="flex flex-col items-center gap-1.5 shrink-0 pt-0.5">
                      {!item.is_read && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
                      {!item.is_read && (
                        <button
                          type="button"
                          title="Mark read"
                          className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground/50 hover:bg-muted hover:text-foreground transition-colors"
                          onClick={(e) => { e.stopPropagation(); void markRead(item.id); }}
                        >
                          <Check className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Footer */}
            <div className="border-t border-border px-3 py-2">
              <button
                type="button"
                className="w-full text-center text-[12px] font-medium text-primary hover:text-primary/80 transition-colors"
                onClick={() => { setAlertsOpen(false); router.push('/reminders'); }}
              >
                View all alerts
              </button>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* User menu */}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-8 w-8 p-0 rounded-lg" id="user-menu">
              <AvatarInitials name={username} size="sm" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel>
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">{username}</span>
                <span className="text-xs text-muted-foreground font-normal capitalize">
                  {formatSystemRole(session?.user?.role)}
                </span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="cursor-pointer text-sm"
              onClick={() => setAddinModalOpen(true)}
            >
              <Calendar className="mr-2 h-3.5 w-3.5" />
              Outlook Add-in
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="cursor-pointer text-sm" onClick={handleSignOut}>
              <LogOut className="mr-2 h-3.5 w-3.5" />
              Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <OutlookAddinModal open={addinModalOpen} onClose={() => setAddinModalOpen(false)} />
    </header>
  );
}
