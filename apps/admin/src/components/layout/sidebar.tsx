'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navItems = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/inventory', label: 'Inventory' },
  { href: '/crm', label: 'CRM' },
  { href: '/deals', label: 'Deals' },
  { href: '/matching', label: 'Matching' },
  { href: '/automations', label: 'Automations' },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 border-r border-white/10 bg-panel px-4 py-5">
      <div className="mb-6 text-lg font-semibold tracking-wide text-white">Wrist Caviar</div>
      <nav className="space-y-1.5">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`block rounded-lg px-3 py-2 text-sm transition ${
                isActive
                  ? 'bg-accent/20 font-medium text-accent'
                  : 'text-muted hover:bg-white/8 hover:text-white'
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
