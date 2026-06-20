import type { Metadata } from 'next';

import { BrandsSection } from '@/components/BrandsSection';
import { FeaturedInventory } from '@/components/FeaturedInventory';
import { HomeHero } from '@/components/HomeHero';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { TrustSection } from '@/components/TrustSection';
import { listPublicWatches } from '@/lib/api';

export const metadata: Metadata = {
  title: 'Wrist Caviar — Exceptional Timepieces',
  description: 'Private dealer of verified luxury watches for discerning collectors.',
};

export const revalidate = 60;

const FEATURED_COUNT = 6;

export default async function HomePage() {
  let watches: Awaited<ReturnType<typeof listPublicWatches>> = [];

  try {
    watches = await listPublicWatches();
  } catch {
    watches = [];
  }

  const heroWatch = watches[0] ?? null;
  const featuredWatches = watches.slice(0, FEATURED_COUNT);

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      <main className="flex-1">
        <HomeHero heroWatch={heroWatch} />
        <TrustSection />
        <FeaturedInventory watches={featuredWatches} />
        <BrandsSection />
      </main>

      <SiteFooter />
    </div>
  );
}
