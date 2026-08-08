'use client';

import Link from 'next/link';
import {
  ArrowLeftRight,
  Bitcoin,
  Bot,
  Boxes,
  History,
  LayoutDashboard,
  Radar,
  ReceiptText,
  ScanSearch,
  Store,
  TrendingUp,
  Users,
  WalletCards,
  Upload,
  Activity,
  type LucideIcon,
} from 'lucide-react';
import { usePathname } from 'next/navigation';

const navItems: { href: string; label: string; icon: LucideIcon }[] = [
  { href: '/assistant', label: 'Asistente', icon: Bot },
  { href: '/dashboard', label: 'Panel', icon: LayoutDashboard },
  { href: '/inventory', label: 'Inventario', icon: Boxes },
  { href: '/storefront', label: 'Tienda', icon: Store },
  { href: '/crm', label: 'CRM', icon: Users },
  { href: '/ventas', label: 'Ventas', icon: ReceiptText },
  { href: '/cuentas', label: 'Cuentas', icon: ArrowLeftRight },
  { href: '/matching', label: 'Coincidencias', icon: ScanSearch },
  { href: '/automations', label: 'Automatizaciones', icon: Bot },
  { href: '/history', label: 'Historial', icon: History },
  { href: '/expenses', label: 'Gastos', icon: WalletCards },
  { href: '/capital', label: 'Capital', icon: TrendingUp },
  { href: '/crypto', label: 'Crypto', icon: Bitcoin },
  { href: '/radar', label: 'Radar', icon: Radar },
  { href: '/data-onboarding', label: 'Importar datos', icon: Upload },
  { href: '/platform/migrations/wrist-caviar', label: 'Migración WC', icon: Upload },
  { href: '/platform/assistant-health', label: 'Assistant Health', icon: Activity },
];
export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-64 shrink-0 border-r border-white/10 bg-panel px-4 py-5 lg:block">
      <div className="mb-3 text-base font-semibold tracking-wide text-white lg:mb-6 lg:text-lg">
        WristOS
      </div>
      <nav className="space-y-1.5">
        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition ${
                isActive
                  ? 'bg-emerald-500/[0.12] font-medium text-emerald-400'
                  : 'text-muted hover:bg-white/8 hover:text-white'
              }`}
            >
              <Icon
                className={`h-[18px] w-[18px] shrink-0 ${
                  isActive ? 'text-emerald-400' : 'text-white/45'
                }`}
                strokeWidth={1.75}
                aria-hidden
              />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
