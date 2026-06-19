import type { Metadata } from 'next';
import Link from 'next/link';

import { FeaturedWatch } from '@/components/FeaturedWatch';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { listPublicWatches } from '@/lib/api';

export const metadata: Metadata = {
  title: 'Wrist Caviar — Luxury Watches',
  description: 'Curated pre-owned luxury watches',
};

export const revalidate = 60;

export default async function HomePage() {
  let featuredWatch: Awaited<ReturnType<typeof listPublicWatches>>[number] | null = null;

  try {
    const watches = await listPublicWatches();
    featuredWatch = watches[0] ?? null;
  } catch {
    featuredWatch = null;
  }

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader variant="minimal" />

      <main className="flex-1">
        <section className="relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_20%_0%,rgba(16,185,129,0.08),transparent_50%)]" />
          <div className="absolute inset-0 bg-[linear-gradient(to_bottom,transparent_60%,rgba(5,5,5,1))]" />

          <div className="sf-container relative flex min-h-[calc(100vh-4rem)] flex-col justify-center py-20 sm:min-h-[calc(100vh-4.5rem)] sm:py-28 lg:py-32">
            <div className="max-w-3xl">
              <p className="sf-eyebrow">Wrist Caviar</p>
              <h1 className="sf-display mt-6 text-[2.5rem] leading-[1.08] sm:text-5xl lg:text-6xl xl:text-7xl">
                Relojes de lujo,
                <br />
                <span className="text-white/55">curados con precisión.</span>
              </h1>
              <p className="mt-8 max-w-lg text-base leading-relaxed text-white/45 sm:text-lg">
                Una selección privada de piezas excepcionales. Autenticidad verificada, presentación
                impecable y servicio personalizado.
              </p>
              <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:items-center">
                <Link href="/watches" className="sf-btn-primary">
                  Explorar colección
                </Link>
                <Link href="/watches" className="sf-btn-ghost px-0 sm:px-6">
                  Ver catálogo completo
                </Link>
              </div>
            </div>
          </div>
        </section>

        {featuredWatch ? <FeaturedWatch watch={featuredWatch} /> : null}

        <section className="border-t border-white/[0.06]">
          <div className="sf-container py-16 sm:py-20">
            <div className="flex flex-col items-start justify-between gap-8 sm:flex-row sm:items-center">
              <div>
                <p className="sf-eyebrow">Colección</p>
                <h2 className="sf-display mt-3 text-2xl sm:text-3xl">
                  Descubre piezas seleccionadas
                </h2>
              </div>
              <Link href="/watches" className="sf-btn-secondary shrink-0">
                Ver todo el catálogo
              </Link>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
