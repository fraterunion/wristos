'use client';

import Link from 'next/link';
import {
  ArrowLeftRight,
  Bot,
  Boxes,
  CircleDollarSign,
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
  type LucideIcon,
} from 'lucide-react';
import { usePathname } from 'next/navigation';

const navItems: { href: string; label: string; icon: LucideIcon }[] = [
  { href: '/dashboard', label: 'Panel', icon: LayoutDashboard },
  { href: '/inventory', label: 'Inventario', icon: Boxes },
  { href: '/storefront', label: 'Tienda', icon: Store },
  { href: '/crm', label: 'CRM', icon: Users },
  { href: '/ventas', label: 'Ventas', icon: ReceiptText },
  { href: '/receivables', label: 'Cuentas por cobrar', icon: CircleDollarSign },
  { href: '/cuentas', label: 'Cuentas', icon: ArrowLeftRight },
  { href: '/matching', label: 'Coincidencias', icon: ScanSearch },
  { href: '/automations', label: 'Automatizaciones', icon: Bot },
  { href: '/history', label: 'Historial', icon: History },
  { href: '/expenses', label: 'Gastos', icon: WalletCards },
  { href: '/capital', label: 'Capital', icon: TrendingUp },
  { href: '/radar', label: 'Radar', icon: Radar },
  { href: '/data-onboarding', label: 'Importar datos', icon: Upload },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-full shrink-0 border-b border-white/10 bg-panel px-3 py-3 lg:w-64 lg:border-b-0 lg:border-r lg:px-4 lg:py-5">
      <div className="mb-3 text-base font-semibold tracking-wide text-white lg:mb-6 lg:text-lg">
        WristOS
      </div>
      <nav className="-mx-1 flex flex-row gap-1 overflow-x-auto pb-1 lg:mx-0 lg:flex-col lg:space-y-1.5 lg:overflow-visible lg:pb-0">
        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`inline-flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm whitespace-nowrap transition lg:flex lg:w-full lg:whitespace-normal ${
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
