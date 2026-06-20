import type { Metadata } from 'next';
import Link from 'next/link';

import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';

export const metadata: Metadata = {
  title: 'Reservation confirmed — Wrist Caviar',
  robots: { index: false },
};

type Props = {
  searchParams: Promise<{ session_id?: string }>;
};

export default async function CheckoutSuccessPage({ searchParams }: Props) {
  const { session_id: sessionId } = await searchParams;

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="sf-container flex flex-1 flex-col items-center justify-center py-16 sm:py-24">
        <div className="mx-auto max-w-md text-center">
          <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center border border-champagne/30 bg-champagne/10">
            <span className="text-xl text-champagne">✓</span>
          </div>
          <p className="sf-eyebrow">Confirmed</p>
          <h1 className="sf-display mt-3 text-3xl text-white">Reservation received</h1>
          <p className="mt-4 text-sm leading-relaxed text-white/45">
            Thank you for your reservation. We will confirm payment and contact you with next
            steps.
          </p>
          {sessionId ? (
            <p className="mt-6 font-mono text-[10px] text-white/25">Reference: {sessionId}</p>
          ) : null}
          <Link href="/watches" className="sf-btn-primary mt-10 inline-flex">
            Back to collection
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
