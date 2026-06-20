import Link from 'next/link';

import type { PublicWatch } from '@/lib/api';

import { WatchCard } from './WatchCard';

type Props = {
  watches: PublicWatch[];
};

export function FeaturedInventory({ watches }: Props) {
  if (watches.length === 0) return null;

  return (
    <section>
      <div className="sf-container py-12 sm:py-16 lg:py-20">
        <div className="mb-8 flex flex-col gap-4 sm:mb-10 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="sf-eyebrow">Current Inventory</p>
            <h2 className="sf-display mt-3 text-2xl sm:text-3xl">Available Now</h2>
          </div>
          <Link
            href="/watches"
            className="text-[11px] font-medium uppercase tracking-[0.2em] text-silver transition hover:text-champagne-light"
          >
            View all pieces →
          </Link>
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 lg:gap-8">
          {watches.map((watch, index) => (
            <WatchCard key={watch.id} watch={watch} priority={index < 3} variant="luxury" />
          ))}
        </div>
      </div>
    </section>
  );
}
