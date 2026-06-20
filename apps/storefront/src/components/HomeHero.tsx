import Link from 'next/link';

import type { PublicWatch } from '@/lib/api';
import { formatMxn } from '@/lib/format';

import { WatchImage } from './WatchDisplay';

type Props = {
  heroWatch: PublicWatch | null;
};

export function HomeHero({ heroWatch }: Props) {
  return (
    <section className="border-b border-white/[0.06]">
      <div className="sf-container">
        <div className="grid grid-cols-1 items-center gap-8 py-10 sm:gap-10 sm:py-14 lg:grid-cols-2 lg:gap-16 lg:py-16">
          <div className="order-2 lg:order-1 lg:py-4">
            <p className="sf-eyebrow text-champagne/80">Wrist Caviar</p>
            <h1 className="sf-display mt-5 text-[2rem] leading-[1.12] sm:text-5xl lg:text-[3.25rem]">
              Rare. Authentic.
              <br />
              Timeless.
            </h1>
            <p className="mt-6 max-w-md text-[15px] leading-relaxed text-white/50 sm:text-base">
              A private selection of exceptional timepieces for discerning collectors. Verified
              authenticity. Discreet service. No compromises.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link href="/watches" className="sf-btn-primary">
                View Collection
              </Link>
              {heroWatch ? (
                <Link
                  href={`/watches/${heroWatch.publicSlug}`}
                  className="sf-btn-ghost px-0 sm:px-4"
                >
                  Featured piece →
                </Link>
              ) : null}
            </div>
          </div>

          <div className="order-1 lg:order-2">
            {heroWatch ? (
              <Link
                href={`/watches/${heroWatch.publicSlug}`}
                className="sf-image-zoom group block border border-white/[0.08] bg-graphite"
              >
                <WatchImage
                  watch={heroWatch}
                  priority
                  className="aspect-[4/5] w-full sm:aspect-[5/6] lg:aspect-[4/5]"
                />
                <div className="border-t border-white/[0.06] px-5 py-4 sm:px-6">
                  <p className="sf-eyebrow text-[9px]">{heroWatch.brand}</p>
                  <p className="mt-1 font-display text-lg text-white sm:text-xl">
                    {heroWatch.model}
                  </p>
                  <div className="mt-2 flex items-baseline justify-between gap-4">
                    {heroWatch.reference ? (
                      <p className="font-mono text-[11px] text-white/30">
                        Ref. {heroWatch.reference}
                      </p>
                    ) : (
                      <span />
                    )}
                    <p className="text-sm tabular-nums text-champagne/90">
                      {formatMxn(heroWatch.publicPrice)}
                    </p>
                  </div>
                </div>
              </Link>
            ) : (
              <div className="flex aspect-[4/5] items-center justify-center border border-white/[0.08] bg-graphite sm:aspect-[5/6]">
                <p className="sf-eyebrow text-center">Collection arriving soon</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
