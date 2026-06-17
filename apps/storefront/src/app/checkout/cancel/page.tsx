import type { Metadata } from 'next';
import Link from 'next/link';

import { SiteHeader } from '@/components/SiteHeader';

export const metadata: Metadata = {
  title: 'Apartado cancelado — Wrist Caviar',
  robots: { index: false },
};

export default function CheckoutCancelPage() {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="sf-container py-16 sm:py-24">
        <div className="sf-card mx-auto max-w-lg px-6 py-12 text-center sm:px-10">
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            Checkout cancelado
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            No se realizó ningún cargo. La pieza sigue disponible si deseas intentar de
            nuevo o contactarnos directamente.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Link href="/watches" className="sf-btn-primary">
              Ver catálogo
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
