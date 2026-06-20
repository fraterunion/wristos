'use client';

import { useRef, useState } from 'react';

import type { PublicWatch } from '@/lib/api';
import { getWatchDisplayImages, watchImageAlt } from '@/lib/watch-images';
import { formatMxn } from '@/lib/format';

type ImageProps = {
  watch: PublicWatch;
  className?: string;
  priority?: boolean;
};

export function WatchImagePlaceholder({
  brand,
  model,
  className = '',
}: {
  brand: string;
  model: string;
  className?: string;
}) {
  return (
    <div
      className={`relative flex items-center justify-center overflow-hidden bg-graphite ${className}`}
      aria-hidden
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,rgba(201,169,98,0.06),transparent_60%)]" />
      <div className="relative text-center">
        <div className="mx-auto mb-3 h-px w-10 bg-champagne/30" />
        <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-white/35">
          {brand}
        </p>
        <p className="mt-1 text-xs text-white/25">{model}</p>
      </div>
    </div>
  );
}

export function WatchImage({ watch, className = '', priority = false }: ImageProps) {
  const images = getWatchDisplayImages(watch);
  const [broken, setBroken] = useState(false);
  const first = images[0];

  if (!first || broken) {
    return <WatchImagePlaceholder brand={watch.brand} model={watch.model} className={className} />;
  }

  return (
    <div className={`relative overflow-hidden bg-graphite ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={first.url}
        alt={watchImageAlt(first, watch)}
        loading={priority ? 'eager' : 'lazy'}
        className="h-full w-full object-cover"
        onError={() => setBroken(true)}
      />
    </div>
  );
}

export function WatchImageGallery({ watch }: { watch: PublicWatch }) {
  const images = getWatchDisplayImages(watch);
  const [activeIndex, setActiveIndex] = useState(0);
  const [brokenUrls, setBrokenUrls] = useState<Set<string>>(() => new Set());
  const [zoomOpen, setZoomOpen] = useState(false);
  const touchStartX = useRef<number | null>(null);

  const visibleImages = images.filter((image) => !brokenUrls.has(image.url));

  if (visibleImages.length === 0) {
    return (
      <WatchImagePlaceholder
        brand={watch.brand}
        model={watch.model}
        className="aspect-[4/5] w-full lg:min-h-[75vh] lg:aspect-auto"
      />
    );
  }

  const safeIndex = Math.min(activeIndex, visibleImages.length - 1);
  const active = visibleImages[safeIndex];
  const heroAlt = watchImageAlt(active, watch);

  function markBroken(url: string) {
    setBrokenUrls((prev) => {
      const next = new Set(prev);
      next.add(url);
      return next;
    });
  }

  function goTo(index: number) {
    setActiveIndex((index + visibleImages.length) % visibleImages.length);
  }

  function goPrev() {
    goTo(safeIndex - 1);
  }

  function goNext() {
    goTo(safeIndex + 1);
  }

  function handleTouchStart(event: React.TouchEvent) {
    touchStartX.current = event.touches[0]?.clientX ?? null;
  }

  function handleTouchEnd(event: React.TouchEvent) {
    if (touchStartX.current === null) return;
    const endX = event.changedTouches[0]?.clientX;
    if (endX === undefined) return;

    const diff = touchStartX.current - endX;
    touchStartX.current = null;

    if (Math.abs(diff) < 48) return;
    if (diff > 0) goNext();
    else goPrev();
  }

  return (
    <>
      <div className="space-y-4">
        <div
          className="sf-image-zoom group relative aspect-[4/5] w-full overflow-hidden border border-white/[0.06] bg-graphite lg:min-h-[75vh] lg:aspect-auto"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          <button
            type="button"
            className="absolute inset-0 z-0 cursor-zoom-in"
            onClick={() => setZoomOpen(true)}
            aria-label="Ampliar imagen"
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={active.url}
            src={active.url}
            alt={heroAlt}
            className="pointer-events-none relative z-0 h-full w-full object-contain p-3 sm:object-cover sm:p-0"
            onError={() => markBroken(active.url)}
          />

          <span className="pointer-events-none absolute bottom-3 right-3 z-10 border border-white/15 bg-black/50 px-2.5 py-1 text-[9px] uppercase tracking-[0.2em] text-white/50 opacity-0 backdrop-blur-sm transition group-hover:opacity-100">
            Click to zoom
          </span>

          {visibleImages.length > 1 ? (
            <>
              <button
                type="button"
                onClick={goPrev}
                className="absolute left-3 top-1/2 z-10 hidden -translate-y-1/2 border border-white/15 bg-black/50 px-3 py-2.5 text-white/60 backdrop-blur-sm transition hover:border-champagne/40 hover:text-white sm:block"
                aria-label="Imagen anterior"
              >
                ←
              </button>
              <button
                type="button"
                onClick={goNext}
                className="absolute right-3 top-1/2 z-10 hidden -translate-y-1/2 border border-white/15 bg-black/50 px-3 py-2.5 text-white/60 backdrop-blur-sm transition hover:border-champagne/40 hover:text-white sm:block"
                aria-label="Imagen siguiente"
              >
                →
              </button>
              <p className="absolute bottom-3 left-3 z-10 bg-black/50 px-2 py-1 text-[10px] uppercase tracking-widest text-white/45 backdrop-blur-sm sm:hidden">
                {safeIndex + 1} / {visibleImages.length}
              </p>
            </>
          ) : null}
        </div>

        {visibleImages.length > 1 ? (
          <div className="sf-gallery-scroll">
            {visibleImages.map((image, index) => {
              const selected = index === safeIndex;
              const thumbAlt = watchImageAlt(image, watch);
              return (
                <button
                  key={image.id}
                  type="button"
                  onClick={() => setActiveIndex(index)}
                  className={`relative h-16 w-16 shrink-0 snap-start overflow-hidden border bg-graphite transition sm:h-[4.5rem] sm:w-[4.5rem] ${
                    selected
                      ? 'border-champagne opacity-100'
                      : 'border-white/10 opacity-50 hover:opacity-90'
                  }`}
                  aria-label={`Ver imagen ${index + 1}`}
                  aria-current={selected ? 'true' : undefined}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={image.url}
                    alt={thumbAlt}
                    className="h-full w-full object-cover"
                    onError={() => markBroken(image.url)}
                  />
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      {zoomOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 p-4">
          <button
            type="button"
            aria-label="Cerrar"
            className="absolute inset-0"
            onClick={() => setZoomOpen(false)}
          />
          <div className="relative max-h-[90vh] max-w-5xl">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={active.url}
              alt={heroAlt}
              className="max-h-[90vh] w-full object-contain"
            />
            {visibleImages.length > 1 ? (
              <div className="mt-4 flex items-center justify-center gap-4">
                <button
                  type="button"
                  onClick={goPrev}
                  className="border border-white/20 px-4 py-2 text-xs uppercase tracking-widest text-white/60 hover:border-champagne/40 hover:text-white"
                >
                  Prev
                </button>
                <span className="text-xs text-white/40">
                  {safeIndex + 1} / {visibleImages.length}
                </span>
                <button
                  type="button"
                  onClick={goNext}
                  className="border border-white/20 px-4 py-2 text-xs uppercase tracking-widest text-white/60 hover:border-champagne/40 hover:text-white"
                >
                  Next
                </button>
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => setZoomOpen(false)}
            className="absolute right-4 top-4 border border-white/20 px-3 py-2 text-xs uppercase tracking-widest text-white/60 hover:text-white"
          >
            Close
          </button>
        </div>
      ) : null}
    </>
  );
}

export function WatchMetaLine({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  if (!value?.trim()) return null;
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-white/[0.06] py-3.5">
      <span className="sf-eyebrow text-[9px]">{label}</span>
      <span className="text-right text-sm text-white/75">{value}</span>
    </div>
  );
}

export function WatchDescription({ text }: { text: string }) {
  const paragraphs = text
    .split(/\n{2,}|\r\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const blocks =
    paragraphs.length > 0 ? paragraphs : text.trim() ? [text.trim()] : [];

  if (blocks.length === 0) return null;

  return (
    <div className="space-y-4 border-t border-white/[0.06] pt-6">
      <p className="sf-eyebrow">About This Piece</p>
      <div className="sf-prose space-y-4">
        {blocks.map((paragraph, index) => (
          <p key={index}>{paragraph}</p>
        ))}
      </div>
    </div>
  );
}

export function PriceBlock({
  publicPrice,
  reservationAmount,
  size = 'md',
}: {
  publicPrice: string;
  reservationAmount: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const priceClass =
    size === 'lg'
      ? 'text-4xl sm:text-[2.75rem]'
      : size === 'sm'
        ? 'text-lg'
        : 'text-2xl';

  return (
    <div className="space-y-2 border-t border-white/[0.06] pt-6">
      <p className="sf-eyebrow">Price</p>
      <p className={`font-display tabular-nums tracking-tight text-white ${priceClass}`}>
        {formatMxn(publicPrice)}
      </p>
      <p className="text-sm text-white/40">
        Reserve with{' '}
        <span className="text-champagne/90">{formatMxn(reservationAmount)}</span>
      </p>
    </div>
  );
}
