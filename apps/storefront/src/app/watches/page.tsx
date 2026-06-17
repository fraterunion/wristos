import type { Metadata } from 'next';

import { EmptyCatalog, WatchGrid } from '@/components/WatchCard';
import { SiteHeader } from '@/components/SiteHeader';
import { listPublicWatches } from '@/lib/api';

export const metadata: Metadata = {
  title: 'Catálogo — Wrist Caviar',
  description: 'Curated pre-owned luxury watches',
};

export const revalidate = 60;

export default async function WatchesPage() {
  let watches: Awaited<ReturnType<typeof listPublicWatches>> = [];
  let loadError: string | null = null;

  try {
    watches = await listPublicWatches();
  } catch {
    loadError = 'No pudimos cargar el catálogo en este momento.';
  }

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="sf-container py-10 sm:py-14">
        {loadError ? (
          <div className="sf-card mx-auto max-w-lg px-6 py-12 text-center">
            <p className="text-sm text-rose-100/90">{loadError}</p>
          </div>
        ) : watches.length === 0 ? (
          <EmptyCatalog />
        ) : (
          <WatchGrid watches={watches} />
        )}
      </main>
    </div>
  );
}
