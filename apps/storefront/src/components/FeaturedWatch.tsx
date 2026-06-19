import Link from 'next/link';

import type { PublicWatch } from '@/lib/api';
import { formatMxn, watchTitle } from '@/lib/format';

import { WatchImage } from './WatchDisplay';

type Props = {
  watch: PublicWatch;
};

export function FeaturedWatch({ watch }: Props) {
  return (
    <section className="border-t border-white/[0.06] bg-panel/20">
      <div className="sf-container py-16 sm:py-20 lg:py-28">
        <div className="mb-10 flex flex-col gap-2 sm:mb-14 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="sf-eyebrow">Destacado</p>
            <h2 className="sf-display mt-3 text-2xl sm:text-3xl">Pieza seleccionada</h2>
          </div>
          <Link
            href={`/watches/${watch.publicSlug}`}
            className="text-[11px] font-medium uppercase tracking-[0.2em] text-white/45 transition hover:text-emerald"
          >
            Ver detalle →
          </Link>
        </div>

        <Link
          href={`/watches/${watch.publicSlug}`}
          className="group grid grid-cols-1 items-center gap-8 lg:grid-cols-2 lg:gap-16"
        >
          <div className="sf-image-zoom bg-graphite/30">
            <WatchImage watch={watch} priority className="aspect-[4/5] w-full lg:aspect-[3/4]" />
          </div>

          <div className="space-y-6 lg:py-8">
            <div className="space-y-3">
              <p className="sf-eyebrow">{watch.brand}</p>
              <h3 className="sf-display text-3xl leading-tight sm:text-4xl lg:text-[2.75rem]">
                {watch.model}
              </h3>
              {watch.reference ? (
                <p className="font-mono text-xs tracking-wide text-white/30">
                  Ref. {watch.reference}
                </p>
              ) : null}
            </div>

            {watch.publicDescription ? (
              <p className="max-w-md text-[15px] leading-relaxed text-white/50 line-clamp-3">
                {watch.publicDescription}
              </p>
            ) : null}

            <p className="text-2xl tabular-nums tracking-tight text-white sm:text-3xl">
              {formatMxn(watch.publicPrice)}
            </p>

            <span className="inline-flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-emerald transition group-hover:text-emerald-glow">
              Explorar {watchTitle(watch)}
              <span aria-hidden>→</span>
            </span>
          </div>
        </Link>
      </div>
    </section>
  );
}
