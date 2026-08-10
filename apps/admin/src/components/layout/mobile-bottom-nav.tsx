'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bot, Boxes, LayoutDashboard, Menu, WalletCards, X } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { useAuthContext } from '@/lib/auth-context';

const primary = [
  { href: '/assistant', label: 'Asistente', icon: Bot },
  { href: '/dashboard', label: 'Panel', icon: LayoutDashboard },
  { href: '/inventory', label: 'Inventario', icon: Boxes },
  { href: '/cuentas', label: 'Cuentas', icon: WalletCards },
] as const;

const more = [
  ['/ventas', 'Ventas'], ['/crm', 'CRM'], ['/expenses', 'Gastos'], ['/capital', 'Capital'],
  ['/crypto', 'Crypto'], ['/history', 'Historial'], ['/automations', 'Automatizaciones'],
] as const;

export function MobileBottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { logout } = useAuthContext();
  const [open, setOpen] = useState(false);

  const onLogout = async () => {
    setOpen(false);
    await logout();
    router.replace('/login');
  };

  return (
    <>
      {open ? (
        <div className="fixed inset-0 z-40 bg-black/65 backdrop-blur-sm lg:hidden" onClick={() => setOpen(false)}>
          <section
            className="absolute inset-x-3 bottom-[calc(5.25rem+env(safe-area-inset-bottom))] rounded-2xl border border-white/15 bg-panel p-4 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
            aria-label="Más secciones"
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">Más secciones</h2>
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-2 text-muted" aria-label="Cerrar menú">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {more.map(([href, label]) => (
                <Link key={href} href={href} onClick={() => setOpen(false)} className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm">
                  {label}
                </Link>
              ))}
            </div>
            <button
              type="button"
              onClick={() => void onLogout()}
              className="mt-3 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-left text-sm text-white/70"
            >
              Cerrar sesión
            </button>
          </section>
        </div>
      ) : null}
      <nav className="fixed inset-x-0 bottom-0 z-50 grid grid-cols-5 border-t border-white/10 bg-panel/95 px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden" aria-label="Navegación principal">
        {primary.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link key={href} href={href} className={`flex min-h-16 flex-col items-center justify-center gap-1 px-1 text-[10px] ${active ? 'text-emerald-300' : 'text-white/55'}`}>
              <Icon className="h-5 w-5" aria-hidden /><span>{label}</span>
            </Link>
          );
        })}
        <button type="button" onClick={() => setOpen((value) => !value)} className={`flex min-h-16 flex-col items-center justify-center gap-1 px-1 text-[10px] ${open ? 'text-emerald-300' : 'text-white/55'}`} aria-expanded={open}>
          <Menu className="h-5 w-5" aria-hidden /><span>Más</span>
        </button>
      </nav>
    </>
  );
}
