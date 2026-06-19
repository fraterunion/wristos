'use client';

import { FormEvent, useState } from 'react';

import { createReservationCheckout, type PublicWatch } from '@/lib/api';
import { buildWhatsAppUrl } from '@/lib/whatsapp';
import { formatMxn, watchTitle } from '@/lib/format';

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
  'No pudimos iniciar el checkout. Intenta de nuevo o contáctanos por WhatsApp.';

export function WatchDetailView({ watch }: Props) {
  const [modalOpen, setModalOpen] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const whatsappMessage = `Hola, me interesa el ${watchTitle(watch)} (${watch.publicSlug}). ¿Podemos hablar?`;
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

  return (
    <>
      <div className="grid grid-cols-1 gap-12 lg:grid-cols-10 lg:gap-10 xl:gap-14">
        <div className="lg:col-span-7">
          <WatchImageGallery watch={watch} />
        </div>

        <div className="lg:col-span-3">
          <div className="lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:pr-1">
            <div className="space-y-1">
              <p className="sf-eyebrow">{watch.brand}</p>
              <h1 className="sf-display text-3xl leading-tight sm:text-4xl">{watch.model}</h1>
            </div>

            <div className="mt-6 space-y-0">
              <WatchMetaLine label="Referencia" value={watch.reference} />
              <WatchMetaLine label="Condición" value={watch.condition} />
              <div className="flex items-center justify-between gap-4 border-b border-white/[0.06] py-3">
                <span className="sf-eyebrow text-[9px]">Disponibilidad</span>
                <span className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-emerald">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald" />
                  Disponible
                </span>
              </div>
            </div>

            {watch.publicDescription ? (
              <div className="mt-2">
                <WatchDescription text={watch.publicDescription} />
              </div>
            ) : null}

            <PriceBlock
              publicPrice={watch.publicPrice}
              reservationAmount={watch.reservationAmount}
              size="lg"
            />

            <div className="mt-8 flex flex-col gap-3">
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setModalOpen(true);
                }}
                className="sf-btn-primary w-full"
              >
                Apartar con Stripe
              </button>
              <a
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="sf-btn-secondary w-full text-center"
              >
                Contactar por WhatsApp
              </a>
            </div>

            <div className="mt-8 space-y-2 text-xs leading-relaxed text-white/35">
              <p>Disponibilidad sujeta a confirmación final.</p>
              <p>El apartado reserva la pieza después de confirmarse el pago.</p>
            </div>
          </div>
        </div>
      </div>

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
          <button
            type="button"
            aria-label="Cerrar"
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            onClick={() => !submitting && setModalOpen(false)}
          />
          <div className="relative w-full max-w-md border border-white/10 bg-panel p-6 shadow-2xl sm:p-8">
            <div className="mb-6">
              <p className="sf-eyebrow">Apartado</p>
              <h2 className="sf-display mt-2 text-2xl text-white">Reservar pieza</h2>
              <p className="mt-2 text-sm text-white/45">
                {watchTitle(watch)} — apartado de {formatMxn(watch.reservationAmount)}
              </p>
            </div>

            <form onSubmit={handleReserve} className="space-y-4">
              <label className="block text-sm">
                <span className="mb-1.5 block sf-eyebrow text-[9px]">Nombre completo</span>
                <input
                  required
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  className="sf-input"
                  autoComplete="name"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1.5 block sf-eyebrow text-[9px]">Correo electrónico</span>
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
                <span className="mb-1.5 block sf-eyebrow text-[9px]">Teléfono (opcional)</span>
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
                  Cancelar
                </button>
                <button type="submit" disabled={submitting} className="sf-btn-primary px-5 py-2">
                  {submitting ? 'Redirigiendo…' : 'Continuar a Stripe'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
