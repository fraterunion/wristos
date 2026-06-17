import type { Metadata } from 'next';
import Link from 'next/link';

import { SiteHeader } from '@/components/SiteHeader';

export const metadata: Metadata = {
  title: 'Wrist Caviar — Luxury Watches',
  description: 'Curated pre-owned luxury watches',
};

export default function HomePage() {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="sf-container py-16 sm:py-24">
        <div className="mx-auto max-w-xl text-center">
          <p className="text-sm text-muted">
            Colección privada de relojes de lujo seleccionados.
          </p>
          <Link href="/watches" className="sf-btn-primary mt-8 inline-flex">
            Ver catálogo
          </Link>
        </div>
      </main>
    </div>
  );
}
