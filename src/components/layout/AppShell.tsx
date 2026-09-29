'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { cn } from '@/lib/utils';

export function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = React.useState(false);
  const pathname = usePathname();

  // Start collapsed on small screens so the rail never covers content.
  React.useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      setCollapsed(true);
    }
  }, []);

  return (
    <div className="flex min-h-screen">
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} />
      <div
        className={cn(
          'flex-1 flex flex-col transition-all duration-300 min-w-0 ml-14',
          collapsed ? 'md:ml-14' : 'md:ml-[220px]'
        )}
      >
        <Topbar />
        {/* Keyed on pathname so every route change replays the staggered
            section entrance (see .page-enter in globals.css). */}
        <main key={pathname} className="flex-1 p-4 sm:p-6 page-enter">
          {children}
        </main>
      </div>
    </div>
  );
}
