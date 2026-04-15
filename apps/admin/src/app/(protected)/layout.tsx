'use client';

import { AppShell } from '@/components/layout/app-shell';
import { useAuthGuard } from '@/hooks/useAuthGuard';

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const { isLoading, user } = useAuthGuard();

  if (isLoading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted">
        Loading session...
      </div>
    );
  }

  return <AppShell>{children}</AppShell>;
}
