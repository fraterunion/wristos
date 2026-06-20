import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { WatchDetailView } from '@/components/WatchDetailView';
import { getPublicWatch } from '@/lib/api';
import { watchTitle } from '@/lib/format';

type Props = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const watch = await getPublicWatch(slug);
  if (!watch) return { title: 'Watch not found — Wrist Caviar' };
  return {
    title: `${watchTitle(watch)} — Wrist Caviar`,
    description: watch.publicDescription ?? `${watch.brand} ${watch.model}`,
  };
}

export const revalidate = 60;

export default async function WatchDetailPage({ params }: Props) {
  const { slug } = await params;
  const watch = await getPublicWatch(slug);
  if (!watch) notFound();

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="sf-container flex-1 py-6 sm:py-10 lg:py-12">
        <Link
          href="/watches"
          className="mb-6 inline-flex text-[10px] font-medium uppercase tracking-[0.22em] text-white/35 transition hover:text-champagne-light sm:mb-8"
        >
          ← Collection
        </Link>
        <WatchDetailView watch={watch} />
      </main>
      <SiteFooter />
    </div>
  );
}
