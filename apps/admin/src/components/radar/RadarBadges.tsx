import type { RadarIntent, RadarReferenceSource, RadarReviewStatus } from '@/types/radar';

const INTENT_STYLES: Record<RadarIntent, string> = {
  SELL_OFFER: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200',
  BUY_REQUEST: 'border-white/20 bg-white/8 text-white/80',
  PRICE_SIGNAL: 'border-amber-500/40 bg-amber-500/15 text-amber-100',
  GENERAL_INQUIRY: 'border-white/15 bg-white/5 text-muted',
};

const INTENT_LABELS: Record<RadarIntent, string> = {
  SELL_OFFER: 'Sell',
  BUY_REQUEST: 'Buy',
  PRICE_SIGNAL: 'Price Signal',
  GENERAL_INQUIRY: 'Inquiry',
};

export function IntentBadge({ intent }: { intent: RadarIntent }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium tracking-wide ${INTENT_STYLES[intent]}`}
    >
      {INTENT_LABELS[intent]}
    </span>
  );
}

const STATUS_STYLES: Record<RadarReviewStatus, string> = {
  PENDING_REVIEW: 'border-amber-500/40 bg-amber-500/15 text-amber-100',
  CONFIRMED: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200',
  DISMISSED: 'border-white/15 bg-white/5 text-muted',
};

const STATUS_LABELS: Record<RadarReviewStatus, string> = {
  PENDING_REVIEW: 'Pending',
  CONFIRMED: 'Confirmed',
  DISMISSED: 'Dismissed',
};

export function ReviewStatusBadge({ status }: { status: RadarReviewStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium tracking-wide ${STATUS_STYLES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

export function SourceBadge({ source }: { source: RadarReferenceSource | null }) {
  if (!source) return null;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${
        source === 'EXPLICIT'
          ? 'border-white/30 bg-white/10 text-white'
          : 'border-white/15 bg-white/5 text-muted'
      }`}
    >
      {source === 'EXPLICIT' ? 'Explicit' : 'Inferred'}
    </span>
  );
}

export function ConfidenceBar({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  const color =
    pct >= 80 ? 'bg-emerald-400' : pct >= 60 ? 'bg-amber-400' : 'bg-rose-400';
  return (
    <div className="h-1.5 w-20 overflow-hidden rounded-full bg-white/10">
      <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}
