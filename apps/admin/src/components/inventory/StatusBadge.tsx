import type { WatchStatus } from '@/types/domain';

const STYLES: Record<WatchStatus, string> = {
  AVAILABLE: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200',
  RESERVED: 'border-amber-500/40 bg-amber-500/15 text-amber-100',
  SOLD: 'border-slate-400/30 bg-slate-500/15 text-slate-200',
  IN_TRANSIT: 'border-sky-500/40 bg-sky-500/15 text-sky-100',
  IN_SERVICE: 'border-violet-500/40 bg-violet-500/15 text-violet-100',
};

export function StatusBadge({ status }: { status: WatchStatus }) {
  const label = status.replaceAll('_', ' ');
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium uppercase tracking-wide ${STYLES[status]}`}
    >
      {label}
    </span>
  );
}
