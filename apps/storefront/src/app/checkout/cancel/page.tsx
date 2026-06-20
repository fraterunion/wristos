import type { Metadata } from 'next';
import Link from 'next/link';

import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';

export const metadata: Metadata = {
  title: 'Reservation cancelled — Wrist Caviar',
  robots: { index: false },
};

export default function CheckoutCancelPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="sf-container flex flex-1 flex-col items-center justify-center py-16 sm:py-24">
        <div className="mx-auto max-w-md text-center">
          <p className="sf-eyebrow">Cancelled</p>
          <h1 className="sf-display mt-3 text-3xl text-white">Checkout cancelled</h1>
          <p className="mt-4 text-sm leading-relaxed text-white/45">
            No charge was made. The piece remains available if you wish to try again or contact us
            directly.
          </p>
          <Link href="/watches" className="sf-btn-primary mt-10 inline-flex">
            View collection
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
