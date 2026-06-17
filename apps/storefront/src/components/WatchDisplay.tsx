import type { PublicWatch } from '@/lib/api';
import { formatMxn } from '@/lib/format';

type Props = {
  watch: Pick<PublicWatch, 'brand' | 'model' | 'imageUrl'>;
  className?: string;
  priority?: boolean;
};

export function WatchImage({ watch, className = '', priority = false }: Props) {
  const alt = `${watch.brand} ${watch.model}`;

  if (watch.imageUrl) {
    return (
      <div className={`relative overflow-hidden bg-graphite ${className}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={watch.imageUrl}
          alt={alt}
          loading={priority ? 'eager' : 'lazy'}
          className="h-full w-full object-cover"
        />
      </div>
    );
  }

  return (
    <div
      className={`relative flex items-center justify-center overflow-hidden bg-gradient-to-br from-graphite via-panel to-surface ${className}`}
      aria-hidden
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.06),transparent_55%)]" />
      <div className="relative text-center">
        <div className="mx-auto mb-3 h-px w-12 bg-white/20" />
        <p className="text-[10px] font-medium uppercase tracking-[0.3em] text-muted/80">
          {watch.brand}
        </p>
        <p className="mt-1 text-xs text-white/40">{watch.model}</p>
      </div>
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
