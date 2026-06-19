'use client';

import { useState } from 'react';

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
      className={`relative flex items-center justify-center overflow-hidden bg-gradient-to-br from-graphite via-panel to-surface ${className}`}
      aria-hidden
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.06),transparent_55%)]" />
      <div className="relative text-center">
        <div className="mx-auto mb-3 h-px w-12 bg-white/20" />
        <p className="text-[10px] font-medium uppercase tracking-[0.3em] text-muted/80">
          {brand}
        </p>
        <p className="mt-1 text-xs text-white/40">{model}</p>
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

  const visibleImages = images.filter((image) => !brokenUrls.has(image.url));

  if (visibleImages.length === 0) {
    return (
      <WatchImagePlaceholder
        brand={watch.brand}
        model={watch.model}
        className="aspect-square w-full rounded-2xl"
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

  return (
    <div className="space-y-3">
      <div className="aspect-square w-full overflow-hidden rounded-2xl bg-graphite ring-1 ring-white/10">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={active.url}
          src={active.url}
          alt={heroAlt}
          className="h-full w-full object-contain sm:object-cover"
          onError={() => markBroken(active.url)}
        />
      </div>

      {visibleImages.length > 1 ? (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {visibleImages.map((image, index) => {
            const selected = index === safeIndex;
            const thumbAlt = watchImageAlt(image, watch);
            return (
              <button
                key={image.id}
                type="button"
                onClick={() => setActiveIndex(index)}
                className={`relative h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-graphite ring-1 transition ${
                  selected
                    ? 'ring-emerald/60 ring-offset-2 ring-offset-surface'
                    : 'ring-white/10 hover:ring-white/25'
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
    <p className="text-sm text-muted">
      <span className="text-white/50">{label}: </span>
      {value}
    </p>
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
      ? 'text-3xl sm:text-4xl'
      : size === 'sm'
        ? 'text-lg'
        : 'text-2xl';

  return (
    <div className="space-y-2">
      <p className={`font-semibold tabular-nums tracking-tight text-white ${priceClass}`}>
        {formatMxn(publicPrice)}
      </p>
      <p className="text-sm text-muted">
        Apartado:{' '}
        <span className="font-medium text-emerald">{formatMxn(reservationAmount)}</span>
      </p>
    </div>
  );
}
