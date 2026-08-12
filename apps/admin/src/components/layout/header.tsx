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
      <div className="flex min-w-0 items-center gap-2.5">
        <h1 className="min-w-0 text-xs font-medium tracking-wide text-muted sm:text-sm">
          Consola de administración
        </h1>
        {user?.isDemo && (
          <span
            title="Datos 100% sintéticos — sin información real de clientes"
            className="shrink-0 rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-300"
          >
            Demo · Datos sintéticos
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 sm:gap-4">
        <span className="max-w-[min(100%,12rem)] truncate text-xs text-white/90 sm:max-w-[20rem] sm:text-sm md:max-w-none">
          {user?.email ?? 'Usuario desconocido'}
        </span>
        <button
          type="button"
          onClick={onLogout}
          className="ui-btn-ghost shrink-0 px-3 py-1.5 text-sm"
        >
          Cerrar sesión
        </button>
      </div>
    </header>
  );
}
