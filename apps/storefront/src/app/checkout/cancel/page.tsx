import type { Metadata } from 'next';
import Link from 'next/link';

import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';

export const metadata: Metadata = {
  title: 'Apartado cancelado — Wrist Caviar',
  robots: { index: false },
};

export default function CheckoutCancelPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader variant="minimal" />
      <main className="sf-container flex flex-1 flex-col items-center justify-center py-16 sm:py-24">
        <div className="mx-auto max-w-md text-center">
          <p className="sf-eyebrow">Cancelado</p>
          <h1 className="sf-display mt-3 text-3xl text-white">Checkout cancelado</h1>
          <p className="mt-4 text-sm leading-relaxed text-white/45">
            No se realizó ningún cargo. La pieza sigue disponible si deseas intentar de
            nuevo o contactarnos directamente.
          </p>
          <Link href="/watches" className="sf-btn-primary mt-10 inline-flex">
            Ver catálogo
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
