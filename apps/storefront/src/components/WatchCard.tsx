import Link from 'next/link';

import type { PublicWatch } from '@/lib/api';
import { formatMxn } from '@/lib/format';

import { WatchImage } from './WatchDisplay';

type Props = {
  watch: PublicWatch;
  priority?: boolean;
};

export function WatchCard({ watch, priority = false }: Props) {
  return (
    <article className="group">
      <Link
        href={`/watches/${watch.publicSlug}`}
        className="sf-image-zoom block bg-graphite/40"
      >
        <WatchImage
          watch={watch}
          priority={priority}
          className="aspect-[3/4] w-full"
        />
      </Link>

      <div className="mt-5 space-y-2 px-0.5">
        <p className="sf-eyebrow">{watch.brand}</p>
        <h2 className="sf-display text-xl leading-snug sm:text-2xl">
          <Link
            href={`/watches/${watch.publicSlug}`}
            className="transition hover:text-white/85"
          >
            {watch.model}
          </Link>
        </h2>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 pt-1">
          {watch.reference ? (
            <p className="font-mono text-[11px] tracking-wide text-white/30">
              Ref. {watch.reference}
            </p>
          ) : null}
          <p className="text-[13px] tabular-nums text-white/45">{formatMxn(watch.publicPrice)}</p>
        </div>
      </div>
    </article>
  );
}

export function WatchGrid({ watches }: { watches: PublicWatch[] }) {
  return (
    <div className="grid grid-cols-1 gap-10 md:grid-cols-2 md:gap-x-8 md:gap-y-14 lg:gap-x-12 lg:gap-y-16">
      {watches.map((watch, index) => (
        <WatchCard key={watch.id} watch={watch} priority={index < 2} />
      ))}
    </div>
  );
}

export function EmptyCatalog() {
  return (
    <div className="mx-auto max-w-md py-24 text-center">
      <p className="sf-display text-2xl text-white">Colección en preparación</p>
      <p className="mt-4 text-sm leading-relaxed text-white/40">
        Vuelve pronto — actualizamos el catálogo con piezas seleccionadas.
      </p>
    </div>
  );
}
