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
  { href: '/history', label: 'History' },
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
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`shrink-0 rounded-lg px-3 py-2 text-sm whitespace-nowrap transition lg:block lg:whitespace-normal ${
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
