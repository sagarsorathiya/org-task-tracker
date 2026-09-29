import './globals.css';
import { Toaster } from 'react-hot-toast';
import type { Metadata } from 'next';
import { UIStateProvider } from '@/context/ui-state';

export const metadata: Metadata = {
  title: 'Organization Activity Tracker',
  description: 'Internal task and activity management portal for the Organization',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans antialiased">
        <UIStateProvider>
          {children}
          <Toaster
            position="top-right"
            toastOptions={{
              className: '!bg-card !text-card-foreground !border !border-border !shadow-lg',
              duration: 4000,
            }}
          />
        </UIStateProvider>
      </body>
    </html>
  );
}
