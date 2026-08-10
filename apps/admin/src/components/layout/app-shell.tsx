'use client';

import { Header } from '@/components/layout/header';
import { MobileBottomNav } from '@/components/layout/mobile-bottom-nav';
import { Sidebar } from '@/components/layout/sidebar';
import { usePathname } from 'next/navigation';

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const assistantImmersive = pathname === '/assistant' || pathname.startsWith('/assistant/');

  return (
    <div className="flex min-h-screen flex-col bg-surface lg:flex-row">
      <Sidebar />
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
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
