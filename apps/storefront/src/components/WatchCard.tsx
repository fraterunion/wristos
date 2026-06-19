import Link from 'next/link';

import type { PublicWatch } from '@/lib/api';
import { formatMxn } from '@/lib/format';

import { WatchImage } from './WatchDisplay';

type Props = {
  watch: PublicWatch;
};

export function WatchCard({ watch }: Props) {
  return (
    <article className="sf-card group flex flex-col overflow-hidden transition duration-200 hover:border-white/20">
      <Link href={`/watches/${watch.publicSlug}`} className="block">
        <WatchImage
          watch={watch}
          className="aspect-[4/3] w-full transition duration-300 group-hover:scale-[1.01]"
        />
      </Link>

      <div className="flex flex-1 flex-col gap-3 p-5">
        <div className="space-y-1">
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted">
            {watch.brand}
          </p>
          <h2 className="text-lg font-semibold tracking-tight text-white">
            <Link href={`/watches/${watch.publicSlug}`} className="hover:text-white/90">
              {watch.model}
            </Link>
          </h2>
          {watch.reference ? (
            <p className="font-mono text-xs text-muted/80">Ref. {watch.reference}</p>
          ) : null}
          <p className="text-sm text-muted">{watch.condition}</p>
        </div>

        <div className="mt-auto flex items-end justify-between gap-4 border-t border-white/10 pt-4">
          <p className="text-lg font-semibold tabular-nums text-white">
            {formatMxn(watch.publicPrice)}
          </p>
          <Link
            href={`/watches/${watch.publicSlug}`}
            className="sf-btn-secondary px-4 py-2 text-xs uppercase tracking-wide"
          >
            View details
          </Link>
        </div>
      </div>
    </article>
  );
}

export function WatchGrid({ watches }: { watches: PublicWatch[] }) {
  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {watches.map((watch) => (
        <WatchCard key={watch.id} watch={watch} />
      ))}
    </div>
  );
}

export function EmptyCatalog() {
  return (
    <div className="sf-card mx-auto max-w-lg px-6 py-16 text-center">
      <p className="text-lg font-medium text-white">No watches available right now.</p>
      <p className="mt-2 text-sm text-muted">
        Vuelve pronto — actualizamos el catálogo con piezas seleccionadas.
      </p>
    </div>
  );
}
