'use client';

import React from 'react';
import { SessionProvider } from 'next-auth/react';
import { AppShell } from '@/components/layout/AppShell';
import { OnboardingModal } from '@/components/auth/OnboardingModal';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <AppShell>
        {children}
      </AppShell>
      <OnboardingModal />
    </SessionProvider>
  );
}
