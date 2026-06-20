'use client';

import { FormEvent, useState } from 'react';

import { createReservationCheckout, type PublicWatch } from '@/lib/api';
import { buildWhatsAppUrl } from '@/lib/whatsapp';
import { formatMxn, watchTitle } from '@/lib/format';

import { TrustBadges } from './TrustBadges';
import {
  PriceBlock,
  WatchDescription,
  WatchImageGallery,
  WatchMetaLine,
} from './WatchDisplay';

type Props = {
  watch: PublicWatch;
};

const CHECKOUT_ERROR =
  'We could not start checkout. Please try again or contact us on WhatsApp.';

export function WatchDetailView({ watch }: Props) {
  const [modalOpen, setModalOpen] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const whatsappMessage = `Hello, I am interested in the ${watchTitle(watch)} (${watch.publicSlug}). Could we discuss?`;
  const whatsappUrl = buildWhatsAppUrl(whatsappMessage);

  async function handleReserve(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const result = await createReservationCheckout({
        slug: watch.publicSlug,
        customerName: customerName.trim(),
        customerEmail: customerEmail.trim(),
        customerPhone: customerPhone.trim() || undefined,
      });

      if (result.checkoutUrl) {
        window.location.href = result.checkoutUrl;
        return;
      }

      setError(CHECKOUT_ERROR);
    } catch {
      setError(CHECKOUT_ERROR);
    } finally {
      setSubmitting(false);
    }
  }

  const purchasePanel = (
    <>
      <div className="space-y-1">
        <p className="sf-eyebrow">{watch.brand}</p>
        <h1 className="sf-display text-2xl leading-tight sm:text-3xl lg:text-[2rem]">
          {watch.model}
        </h1>
      </div>

      <div className="mt-5">
        <WatchMetaLine label="Reference" value={watch.reference} />
        <WatchMetaLine label="Condition" value={watch.condition} />
        <div className="flex items-center justify-between gap-4 border-b border-white/[0.06] py-3.5">
          <span className="sf-eyebrow text-[9px]">Availability</span>
          <span className="inline-flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-champagne">
            <span className="h-1.5 w-1.5 rounded-full bg-champagne" />
            Available
          </span>
        </div>
      </div>

      <PriceBlock
        publicPrice={watch.publicPrice}
        reservationAmount={watch.reservationAmount}
        size="lg"
      />

      <div className="mt-6 flex flex-col gap-3">
        <button
          type="button"
          onClick={() => {
            setError(null);
            setModalOpen(true);
          }}
          className="sf-btn-primary w-full"
        >
          Reserve This Piece
        </button>
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="sf-btn-secondary w-full text-center"
        >
          Inquire via WhatsApp
        </a>
      </div>

      <TrustBadges />

      <p className="mt-5 text-[11px] leading-relaxed text-white/30">
        Availability subject to final confirmation. Reservation secures the piece upon payment.
      </p>
    </>
  );

  return (
    <>
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:gap-10 xl:gap-14">
        <div className="lg:col-span-8">
          <WatchImageGallery watch={watch} />
          {watch.publicDescription ? (
            <div className="mt-8 lg:hidden">
              <WatchDescription text={watch.publicDescription} />
            </div>
          ) : null}
        </div>

        <div className="hidden lg:col-span-4 lg:block">
          <div className="sticky top-20 border border-white/[0.08] bg-panel p-6 xl:p-7">
            {purchasePanel}
            {watch.publicDescription ? (
              <div className="mt-6">
                <WatchDescription text={watch.publicDescription} />
              </div>
            ) : null}
          </div>
        </div>

        <div className="lg:hidden">{purchasePanel}</div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/[0.08] bg-black/95 px-4 py-3 backdrop-blur-md lg:hidden">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-lg tabular-nums text-white">
              {formatMxn(watch.publicPrice)}
            </p>
            <p className="truncate text-[10px] uppercase tracking-wider text-white/35">
              {watch.brand} · {watch.model}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setModalOpen(true);
            }}
            className="sf-btn-primary shrink-0 px-5 py-3"
          >
            Reserve
          </button>
        </div>
      </div>

      <div className="h-20 lg:hidden" aria-hidden />

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
          <button
            type="button"
            aria-label="Close"
            className="absolute inset-0 bg-black/85 backdrop-blur-sm"
            onClick={() => !submitting && setModalOpen(false)}
          />
          <div className="relative w-full max-w-md border border-white/10 bg-panel p-6 sm:p-8">
            <div className="mb-6">
              <p className="sf-eyebrow">Reservation</p>
              <h2 className="sf-display mt-2 text-2xl text-white">Reserve this piece</h2>
              <p className="mt-2 text-sm text-white/45">
                {watchTitle(watch)} — deposit of {formatMxn(watch.reservationAmount)}
              </p>
            </div>

            <form onSubmit={handleReserve} className="space-y-4">
              <label className="block text-sm">
                <span className="mb-1.5 block sf-eyebrow text-[9px]">Full name</span>
                <input
                  required
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  className="sf-input"
                  autoComplete="name"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1.5 block sf-eyebrow text-[9px]">Email</span>
                <input
                  required
                  type="email"
                  value={customerEmail}
                  onChange={(e) => setCustomerEmail(e.target.value)}
                  className="sf-input"
                  autoComplete="email"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1.5 block sf-eyebrow text-[9px]">Phone (optional)</span>
                <input
                  type="tel"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  className="sf-input"
                  autoComplete="tel"
                  placeholder="+52 ..."
                />
              </label>

              {error ? (
                <p className="border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
                  {error}
                </p>
              ) : null}

              <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => setModalOpen(false)}
                  className="sf-btn-secondary px-4 py-2"
                >
                  Cancel
                </button>
                <button type="submit" disabled={submitting} className="sf-btn-primary px-5 py-2">
                  {submitting ? 'Redirecting…' : 'Continue to payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
