'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, ListTodo, Users, Building2, Bell, Settings, Menu, ChevronLeft, ChartColumn, Lock, ChevronRight, ClipboardList, CalendarClock, FileClock,
} from 'lucide-react';
import { useSession } from 'next-auth/react';
import useSWR from 'swr';
import { canViewInsights, cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { AvatarInitials } from '@/components/ui/avatar-initials';
import type { DashboardStats, ApiResponse } from '@/types';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
  adminOnly?: boolean;
}

const mainNavItems: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/tasks', label: 'Tasks', icon: ListTodo },
  { href: '/transactions', label: 'Transaction Reminder', icon: FileClock },
  { href: '/personal', label: 'Personal', icon: Lock },
  { href: '/reminders', label: 'Alerts', icon: Bell },
  { href: '/insights', label: 'Insights', icon: ChartColumn },
];

const settingsNavItems: NavItem[] = [
  { href: '/config', label: 'Config', icon: Settings, adminOnly: true },
  { href: '/audit', label: 'Audit', icon: ClipboardList, adminOnly: true },
  { href: '/users', label: 'Users', icon: Users, adminOnly: true },
  { href: '/org', label: 'Organization', icon: Building2, adminOnly: true },
];

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const role = session?.user?.role;
  const insightsAccess = session?.user?.insightsAccess;

  const { data: statsData } = useSWR<ApiResponse<DashboardStats>>(
    '/api/dashboard/stats',
    fetcher,
    { revalidateOnFocus: false, refreshInterval: 60000 }
  );
  const overdueCount = statsData?.data?.overdue  || 0;
  const dueTodayCount = statsData?.data?.dueToday || 0;
  const completedCount = statsData?.data?.completed || 0;

  const filterByRole = (item: NavItem) => {
    if (item.adminOnly && role !== 'admin') return false;
    if (item.href === '/insights' && !canViewInsights(role, insightsAccess)) return false;
    return true;
  };

  const visibleMainItems = mainNavItems.filter(filterByRole);
  const visibleSettingsItems = settingsNavItems.filter(filterByRole);

  const isActiveItem = (item: NavItem) => {
    const baseHref = item.href.split('?')[0];
    return pathname.startsWith(baseHref);
  };

  const username = session?.user?.username || 'User';
  const initials = username.slice(0, 2).toUpperCase();

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={cn(
          'fixed left-0 top-0 z-40 h-screen border-r flex flex-col transition-all duration-300 glass-panel rail-border',
          collapsed ? 'w-14' : 'w-[220px] max-md:shadow-2xl'
        )}
      >
        {/* Logo / Brand */}
        <div className={cn('flex h-12 items-center border-b rail-border shrink-0', collapsed ? 'justify-center px-2' : 'justify-between px-3')}>
          {!collapsed && (
            <Link href="/dashboard" className="flex items-center gap-2 min-w-0 flex-1 group">
              <div className="h-7 w-7 rounded-lg btn-gradient-primary flex items-center justify-center shrink-0 transition-transform duration-200 group-hover:scale-105">
                <span className="text-[11px] font-bold text-primary-foreground leading-none">TT</span>
              </div>
              <span className="font-heading text-sm rail-text truncate">TaskTracker</span>
            </Link>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-foreground/50 hover:text-foreground hover:bg-primary/10"
            onClick={onToggle}
            id="sidebar-toggle"
          >
            {collapsed ? <Menu className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </Button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
          {visibleMainItems.map((item) => {
            const isActive = isActiveItem(item);
            const Icon = item.icon;

            const link = (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'group flex items-center gap-2.5 h-9 rounded-full text-[13px] font-semibold transition-all duration-200 relative',
                  isActive
                    ? 'sidebar-active pl-3 pr-2.5'
                    : 'px-3 sidebar-item'
                )}
              >
                <Icon className="h-4 w-4 shrink-0 transition-transform duration-200 group-hover:scale-110" strokeWidth={2.75} />
                {!collapsed && (
                  <>
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.href === '/tasks' && overdueCount > 0 && (
                      <span className="ml-auto inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground px-1 leading-none">
                        {overdueCount > 99 ? '99+' : overdueCount}
                      </span>
                    )}
                  </>
                )}
                {collapsed && item.href === '/tasks' && overdueCount > 0 && (
                  <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-primary" />
                )}
              </Link>
            );

            if (collapsed) {
              return (
                <Tooltip key={item.href}>
                  <TooltipTrigger asChild>{link}</TooltipTrigger>
                  <TooltipContent side="right" className="text-xs">{item.label}</TooltipContent>
                </Tooltip>
              );
            }

            return link;
          })}

          {visibleSettingsItems.length > 0 && (
            <div className="pt-3">
              {!collapsed && (
                <div className="px-3 pb-1.5 text-[10px] uppercase tracking-widest rail-muted opacity-80 font-semibold">
                  Admin
                </div>
              )}
              {visibleSettingsItems.map((item) => {
                const isActive = isActiveItem(item);
                const Icon = item.icon;

                const link = (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'group flex items-center gap-2.5 h-9 rounded-full text-[13px] font-semibold transition-all duration-200 relative',
                      isActive
                        ? 'sidebar-active pl-3 pr-2.5'
                        : 'px-3 sidebar-item'
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0 transition-transform duration-200 group-hover:scale-110" strokeWidth={2.75} />
                    {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
                  </Link>
                );

                if (collapsed) {
                  return (
                    <Tooltip key={item.href}>
                      <TooltipTrigger asChild>{link}</TooltipTrigger>
                      <TooltipContent side="right" className="text-xs">{item.label}</TooltipContent>
                    </Tooltip>
                  );
                }

                return link;
              })}
            </div>
          )}
        </nav>

        {/* Today mini panel — only when expanded */}
        {!collapsed && (
          <div className="px-3 pb-3 shrink-0">
            <div className="rounded-2xl border rail-border bg-primary/5 px-3.5 py-3 space-y-2">
              <div className="flex items-center gap-2">
                <div className="h-6 w-6 rounded-lg bg-primary/15 text-primary flex items-center justify-center shrink-0">
                  <CalendarClock className="h-3.5 w-3.5" strokeWidth={2.75} />
                </div>
                <p className="text-[9px] font-semibold uppercase tracking-[0.14em] rail-muted">Today Summary</p>
              </div>
              {overdueCount > 0 && (
                <div className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-destructive shrink-0" />
                  <span className="text-[11px] rail-text">{overdueCount} overdue</span>
                </div>
              )}
              {dueTodayCount > 0 && (
                <div className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                  <span className="text-[11px] rail-text">{dueTodayCount} due today</span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-success shrink-0" />
                <span className="text-[11px] rail-text">{completedCount} completed</span>
              </div>
            </div>
          </div>
        )}

        {/* User info chip at bottom */}
        <div className={cn('border-t rail-border p-2 shrink-0', collapsed ? 'flex justify-center' : '')}>
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="cursor-default">
                  <AvatarInitials name={username} size="sm" />
                </div>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs">{username}</TooltipContent>
            </Tooltip>
          ) : (
            <div className="flex items-center gap-2 px-1 py-1 rounded-2xl transition-colors duration-200 hover:bg-primary/8">
              <AvatarInitials name={username} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold rail-text truncate">{username}</p>
                <p className="text-[10px] rail-muted capitalize truncate">{role}</p>
              </div>
              <ChevronRight className="h-3.5 w-3.5 rail-muted opacity-60 shrink-0" />
            </div>
          )}
        </div>
      </aside>
    </TooltipProvider>
  );
}
