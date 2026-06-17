import type { Metadata } from 'next';
import Link from 'next/link';

import { SiteHeader } from '@/components/SiteHeader';

export const metadata: Metadata = {
  title: 'Apartado confirmado — Wrist Caviar',
  robots: { index: false },
};

type Props = {
  searchParams: Promise<{ session_id?: string }>;
};

export default async function CheckoutSuccessPage({ searchParams }: Props) {
  const { session_id: sessionId } = await searchParams;

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="sf-container py-16 sm:py-24">
        <div className="sf-card mx-auto max-w-lg px-6 py-12 text-center sm:px-10">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-emerald/40 bg-emerald/10">
            <span className="text-lg text-emerald">✓</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            Apartado recibido
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            Gracias por tu apartado. Confirmaremos el pago y te contactaremos para los
            siguientes pasos.
          </p>
          {sessionId ? (
            <p className="mt-4 font-mono text-[10px] text-white/30">
              Referencia: {sessionId}
            </p>
          ) : null}
          <Link href="/watches" className="sf-btn-primary mt-8 inline-flex">
            Volver al catálogo
          </Link>
        </div>
      </main>
    </div>
  );
}
