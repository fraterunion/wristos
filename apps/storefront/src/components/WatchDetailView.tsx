'use client';

import { FormEvent, useState } from 'react';

import { createReservationCheckout, type PublicWatch } from '@/lib/api';
import { buildWhatsAppUrl } from '@/lib/whatsapp';
import { formatMxn, watchTitle } from '@/lib/format';

import { PriceBlock, WatchImage, WatchMetaLine } from './WatchDisplay';

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
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-2 lg:gap-14">
        <WatchImage watch={watch} className="aspect-square w-full rounded-2xl" priority />

        <div className="flex flex-col gap-6">
          <div className="space-y-3">
            <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-muted">
              {watch.brand}
            </p>
            <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              {watch.model}
            </h1>
            <WatchMetaLine label="Referencia" value={watch.reference} />
            <WatchMetaLine label="Condición" value={watch.condition} />
            <span className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-emerald">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald" />
              Disponible
            </span>
          </div>

          {watch.publicDescription ? (
            <p className="max-w-prose text-sm leading-relaxed text-white/75">
              {watch.publicDescription}
            </p>
          ) : null}

          <PriceBlock
            publicPrice={watch.publicPrice}
            reservationAmount={watch.reservationAmount}
            size="lg"
          />

          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => {
                setError(null);
                setModalOpen(true);
              }}
              className="sf-btn-primary"
            >
              Apartar con Stripe
            </button>
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="sf-btn-secondary text-center"
            >
              Contactar por WhatsApp
            </a>
          </div>

          <div className="space-y-2 border-t border-white/10 pt-5 text-xs leading-relaxed text-muted">
            <p>Disponibilidad sujeta a confirmación final.</p>
            <p>El apartado reserva la pieza después de confirmarse el pago.</p>
          </div>
        </div>
      </div>

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
          <button
            type="button"
            aria-label="Cerrar"
            className="absolute inset-0 bg-black/75 backdrop-blur-sm"
            onClick={() => !submitting && setModalOpen(false)}
          />
          <div className="relative w-full max-w-md rounded-2xl border border-white/10 bg-panel p-6 shadow-2xl">
            <div className="mb-5">
              <h2 className="text-lg font-semibold text-white">Apartar pieza</h2>
              <p className="mt-1 text-sm text-muted">
                {watchTitle(watch)} — apartado de {formatMxn(watch.reservationAmount)}
              </p>
            </div>

            <form onSubmit={handleReserve} className="space-y-4">
              <label className="block text-sm">
                <span className="mb-1.5 block text-xs text-muted">Nombre completo</span>
                <input
                  required
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  className="sf-input"
                  autoComplete="name"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1.5 block text-xs text-muted">Correo electrónico</span>
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
                <span className="mb-1.5 block text-xs text-muted">Teléfono (opcional)</span>
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
                <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
                  {error}
                </p>
              ) : null}

              <div className="flex justify-end gap-3 pt-2">
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
