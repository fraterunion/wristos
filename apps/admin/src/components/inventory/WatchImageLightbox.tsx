'use client';

import { useEffect, useState } from 'react';

import type { Watch } from '@/types/domain';

type Props = {
  watch: Watch | null;
  onClose: () => void;
};

function formatMoney(value: string | null | undefined) {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'MXN',
    maximumFractionDigits: 0,
  }).format(Number.isFinite(n) ? n : 0);
}

export function WatchImageLightbox({ watch, onClose }: Props) {
  const [imgError, setImgError] = useState(false);

  // Reset error state whenever a different watch is opened
  useEffect(() => {
    setImgError(false);
  }, [watch]);

  // Close on Escape key
  useEffect(() => {
    if (!watch) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [watch, onClose]);

  if (!watch) return null;

  const priceStr =
    watch.priceMin == null && watch.priceMax == null
      ? '—'
      : watch.priceMin === watch.priceMax || watch.priceMax == null
        ? formatMoney(watch.priceMin ?? watch.priceMax)
        : watch.priceMin == null
          ? formatMoney(watch.priceMax)
          : `${formatMoney(watch.priceMin)} – ${formatMoney(watch.priceMax)}`;

  return (
    // Backdrop — click anywhere outside the card to close
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${watch.brand ?? ''} ${watch.model ?? ''}`.trim() || 'Watch'}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* Modal card — stops propagation so clicking inside doesn't close */}
      <div
        className="relative flex max-h-[90vh] w-full max-w-3xl flex-col items-center gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute -right-2 -top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-sm text-white/60 transition hover:bg-white/20 hover:text-white"
        >
          ✕
        </button>

        {/* Image or fallback */}
        {imgError ? (
          <div className="flex h-64 w-full items-center justify-center rounded-2xl bg-white/5 ring-1 ring-white/10">
            <p className="text-sm text-muted">Image could not be loaded.</p>
          </div>
        ) : (
          <img
            src={watch.imageUrl ?? ''}
            alt={`${watch.brand ?? ''} ${watch.model ?? ''}`.trim() || 'Watch'}
            className="max-h-[70vh] max-w-full rounded-2xl object-contain shadow-2xl ring-1 ring-white/15"
            onError={() => setImgError(true)}
          />
        )}

        {/* Watch info panel */}
        <div className="w-full rounded-xl bg-white/[0.06] px-5 py-3.5 ring-1 ring-white/10">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="truncate text-base font-semibold text-white">{watch.brand}</p>
              <p className="truncate text-sm text-muted">{watch.model}</p>
            </div>
            <p className="shrink-0 text-base font-semibold tabular-nums text-white">{priceStr}</p>
          </div>
          {watch.serialNumber ? (
            <p className="mt-2 text-xs text-muted/70">
              Serial{' '}
              <span className="font-mono text-muted">{watch.serialNumber}</span>
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
