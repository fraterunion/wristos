'use client';

import { Header } from '@/components/layout/header';
import { MobileBottomNav } from '@/components/layout/mobile-bottom-nav';
import { Sidebar } from '@/components/layout/sidebar';
import { usePathname } from 'next/navigation';

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const assistantImmersive = pathname === '/assistant' || pathname.startsWith('/assistant/');

  return (
    // min-h-dvh (dynamic viewport height), not min-h-screen (100vh, static):
    // on iOS, 100vh is sized as if browser chrome were fully hidden, so a
    // page taller than the ACTUAL visible viewport ends up scrollable —
    // which is exactly the trigger that can bring a Home Screen bookmark's
    // chrome back mid-navigation on a page that overflows (the assistant's
    // tall, dynamically-growing thread is far more likely to hit this than
    // a shorter, more static page like the dashboard). pt-[env(...)] pairs
    // with appleWebApp's black-translucent status bar (layout.tsx) so
    // content never renders under the notch/status bar.
    <div className="flex min-h-dvh flex-col bg-surface pt-[env(safe-area-inset-top)] lg:flex-row">
      <Sidebar />
      <div className="flex min-h-dvh min-w-0 flex-1 flex-col">
        {assistantImmersive ? null : <Header />}
        <main
          className={
            assistantImmersive
              ? 'flex-1 px-3 py-3 pb-24 sm:px-5 sm:pb-24 md:px-7 lg:pb-6'
              : 'flex-1 px-3 py-4 pb-24 sm:px-5 sm:py-5 sm:pb-24 md:px-7 md:py-6 lg:pb-6'
          }
        >
          {children}
        </main>
      </div>
      <MobileBottomNav />
    </div>
  );
}
