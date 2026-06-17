import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

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
  if (!watch) return { title: 'Reloj no encontrado — Wrist Caviar' };
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
    <div className="min-h-screen">
      <SiteHeader />
      <main className="sf-container py-8 sm:py-12">
        <Link
          href="/watches"
          className="mb-8 inline-flex text-sm text-muted transition hover:text-white"
        >
          ← Volver al catálogo
        </Link>
        <WatchDetailView watch={watch} />
      </main>
    </div>
  );
}
