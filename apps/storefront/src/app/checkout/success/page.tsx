import type { Metadata } from 'next';
import Link from 'next/link';

import { SiteFooter } from '@/components/SiteFooter';
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
    <div className="flex min-h-screen flex-col">
      <SiteHeader variant="minimal" />
      <main className="sf-container flex flex-1 flex-col items-center justify-center py-16 sm:py-24">
        <div className="mx-auto max-w-md text-center">
          <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center border border-emerald/30 bg-emerald/10">
            <span className="text-xl text-emerald">✓</span>
          </div>
          <p className="sf-eyebrow">Confirmado</p>
          <h1 className="sf-display mt-3 text-3xl text-white">Apartado recibido</h1>
          <p className="mt-4 text-sm leading-relaxed text-white/45">
            Gracias por tu apartado. Confirmaremos el pago y te contactaremos para los
            siguientes pasos.
          </p>
          {sessionId ? (
            <p className="mt-6 font-mono text-[10px] text-white/25">
              Referencia: {sessionId}
            </p>
          ) : null}
          <Link href="/watches" className="sf-btn-primary mt-10 inline-flex">
            Volver al catálogo
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
