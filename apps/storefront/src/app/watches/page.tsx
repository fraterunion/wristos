import type { Metadata } from 'next';

import { EmptyCatalog, WatchGrid } from '@/components/WatchCard';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { TrustSection } from '@/components/TrustSection';
import { listPublicWatches } from '@/lib/api';

export const metadata: Metadata = {
  title: 'Collection — Wrist Caviar',
  description: 'Browse verified luxury watches from Wrist Caviar.',
};

export const revalidate = 60;

export default async function WatchesPage() {
  let watches: Awaited<ReturnType<typeof listPublicWatches>> = [];
  let loadError: string | null = null;

  try {
    watches = await listPublicWatches();
  } catch {
    loadError = 'We could not load the collection at this time.';
  }

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="flex-1">
        <div className="sf-container py-10 sm:py-12 lg:py-14">
          <header className="max-w-xl">
            <p className="sf-eyebrow">Wrist Caviar</p>
            <h1 className="sf-display mt-4 text-3xl sm:text-4xl">The Collection</h1>
            <p className="mt-4 text-[15px] leading-relaxed text-white/45">
              Every piece verified, photographed, and presented with the care it deserves.
            </p>
            {!loadError && watches.length > 0 ? (
              <p className="mt-3 text-[11px] uppercase tracking-[0.18em] text-white/30">
                {watches.length} {watches.length === 1 ? 'piece' : 'pieces'} available
              </p>
            ) : null}
          </header>
        </div>

        <div className="sf-container pb-12 sm:pb-16 lg:pb-20">
          {loadError ? (
            <div className="mx-auto max-w-md py-16 text-center">
              <p className="text-sm text-rose-100/90">{loadError}</p>
            </div>
          ) : watches.length === 0 ? (
            <EmptyCatalog />
          ) : (
            <WatchGrid watches={watches} />
          )}
        </div>

        <TrustSection />
      </main>
      <SiteFooter />
    </div>
  );
}
