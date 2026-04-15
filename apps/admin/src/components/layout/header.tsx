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
    <header className="flex h-16 items-center justify-between border-b border-white/10 bg-panel/95 px-6 backdrop-blur">
      <h1 className="text-sm font-medium tracking-wide text-muted">Wrist Caviar · Admin</h1>
      <div className="flex items-center gap-4">
        <span className="text-sm text-white/90">{user?.email ?? 'Unknown user'}</span>
        <button
          type="button"
          onClick={onLogout}
          className="ui-btn-ghost px-3 py-1.5 text-sm"
        >
          Logout
        </button>
      </div>
    </header>
  );
}
