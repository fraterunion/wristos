import Link from 'next/link';

import type { PublicWatch } from '@/lib/api';
import { formatMxn } from '@/lib/format';

import { WatchImage } from './WatchDisplay';

type Props = {
  watch: PublicWatch;
  priority?: boolean;
  variant?: 'default' | 'luxury';
};

export function WatchCard({ watch, priority = false, variant = 'default' }: Props) {
  const isLuxury = variant === 'luxury';

  return (
    <article className={isLuxury ? 'sf-watch-card' : 'group'}>
      <Link
        href={`/watches/${watch.publicSlug}`}
        className={`sf-image-zoom block ${isLuxury ? 'bg-graphite' : 'bg-graphite/40'}`}
      >
        <WatchImage
          watch={watch}
          priority={priority}
          className="aspect-[3/4] w-full"
        />
      </Link>

      <div className={`space-y-2 ${isLuxury ? 'border-t border-white/[0.06] px-5 py-5' : 'mt-5 px-0.5'}`}>
        <p className="sf-eyebrow text-[9px]">{watch.brand}</p>
        <h2 className="sf-display text-lg leading-snug sm:text-xl">
          <Link
            href={`/watches/${watch.publicSlug}`}
            className="transition hover:text-champagne-light"
          >
            {watch.model}
          </Link>
        </h2>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 pt-1">
          {watch.reference ? (
            <p className="font-mono text-[10px] tracking-wide text-white/30">
              Ref. {watch.reference}
            </p>
          ) : (
            <span />
          )}
          <p className="text-sm tabular-nums text-white/70">{formatMxn(watch.publicPrice)}</p>
        </div>
        {watch.condition ? (
          <p className="text-[11px] uppercase tracking-[0.12em] text-white/30">{watch.condition}</p>
        ) : null}
      </div>
    </article>
  );
}

export function WatchGrid({ watches }: { watches: PublicWatch[] }) {
  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 lg:gap-8">
      {watches.map((watch, index) => (
        <WatchCard key={watch.id} watch={watch} priority={index < 3} variant="luxury" />
      ))}
    </div>
  );
}

export function EmptyCatalog() {
  return (
    <div className="mx-auto max-w-md py-20 text-center">
      <p className="sf-display text-2xl text-white">Inventory in preparation</p>
      <p className="mt-4 text-sm leading-relaxed text-white/40">
        New pieces are being prepared for our catalog. Return soon.
      </p>
    </div>
  );
}
