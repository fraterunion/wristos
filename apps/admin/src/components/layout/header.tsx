'use client';

import { useRouter } from 'next/navigation';
import { useAuthContext } from '@/lib/auth-context';

export function Header() {
  const { user, logout } = useAuthContext();
  const router = useRouter();

  const onLogout = async () => {
    await logout();
    router.replace('/login');
  };

  return (
    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-panel/95 px-3 py-3 backdrop-blur sm:h-16 sm:flex-nowrap sm:items-center sm:gap-3 sm:px-5 md:px-6">
      <h1 className="min-w-0 text-xs font-medium tracking-wide text-muted sm:text-sm">
        Admin Console
      </h1>
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 sm:gap-4">
        <span className="max-w-[min(100%,12rem)] truncate text-xs text-white/90 sm:max-w-[20rem] sm:text-sm md:max-w-none">
          {user?.email ?? 'Unknown user'}
        </span>
        <button
          type="button"
          onClick={onLogout}
          className="ui-btn-ghost shrink-0 px-3 py-1.5 text-sm"
        >
          Logout
        </button>
      </div>
    </header>
  );
}
