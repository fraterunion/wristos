import type { Metadata } from 'next';

import { EmptyCatalog, WatchGrid } from '@/components/WatchCard';
import { SiteFooter } from '@/components/SiteFooter';
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
    <div className="flex min-h-screen flex-col">
      <SiteHeader variant="minimal" />
      <main className="sf-container flex-1 py-12 sm:py-16 lg:py-20">
        <header className="mb-12 max-w-2xl sm:mb-16 lg:mb-20">
          <p className="sf-eyebrow">Colección</p>
          <h1 className="sf-display mt-4 text-3xl sm:text-4xl lg:text-5xl">Catálogo</h1>
          <p className="mt-5 text-[15px] leading-relaxed text-white/45">
            Piezas seleccionadas de las casas más prestigiosas. Cada reloj es inspeccionado y
            presentado con el detalle que merece.
          </p>
          {!loadError && watches.length > 0 ? (
            <p className="mt-4 text-xs uppercase tracking-[0.2em] text-white/30">
              {watches.length} {watches.length === 1 ? 'pieza disponible' : 'piezas disponibles'}
            </p>
          ) : null}
        </header>

        {loadError ? (
          <div className="mx-auto max-w-md py-16 text-center">
            <p className="text-sm text-rose-100/90">{loadError}</p>
          </div>
        ) : watches.length === 0 ? (
          <EmptyCatalog />
        ) : (
          <WatchGrid watches={watches} />
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
