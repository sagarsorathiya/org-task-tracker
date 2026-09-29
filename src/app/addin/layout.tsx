import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Task Tracker Add-in',
};

export default function AddinLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground font-sans antialiased text-sm">
      {children}
    </div>
  );
}
