import type { WatchStatus } from '@/types/domain';

const STYLES: Record<WatchStatus, string> = {
  AVAILABLE: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200',
  RESERVED: 'border-amber-500/40 bg-amber-500/15 text-amber-100',
  SOLD: 'border-white/15 bg-white/5 text-white/50',
  IN_TRANSIT: 'border-white/20 bg-white/8 text-white/70',
  IN_SERVICE: 'border-white/20 bg-white/8 text-white/70',
};

const LABELS: Record<WatchStatus, string> = {
  AVAILABLE: 'Disponible',
  RESERVED: 'Reservado',
  SOLD: 'Vendido',
  IN_TRANSIT: 'En tránsito',
  IN_SERVICE: 'En servicio',
};

export function StatusBadge({ status }: { status: WatchStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium uppercase tracking-wide ${STYLES[status]}`}
    >
      {LABELS[status]}
    </span>
  );
}
