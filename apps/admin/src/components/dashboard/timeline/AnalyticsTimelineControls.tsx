'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';

export function AnalyticsTimelineControls({
  rangeLabel,
  canGoPrev,
  canGoNext,
  onPrev,
  onNext,
  onActual,
  isAtLatest,
}: {
  rangeLabel: string;
  canGoPrev: boolean;
  canGoNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onActual: () => void;
  isAtLatest: boolean;
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-2"
      role="group"
      aria-label="Navegación del timeline"
    >
      <button
        type="button"
        onClick={onPrev}
        disabled={!canGoPrev}
        aria-label="Periodo anterior"
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/10 text-white/70 transition hover:bg-white/5 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/40 disabled:cursor-not-allowed disabled:opacity-30"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
      </button>

      <p
        className="min-w-0 max-w-[14rem] truncate text-center text-xs tabular-nums text-white/55 sm:max-w-none sm:text-sm"
        aria-live="polite"
      >
        {rangeLabel}
      </p>

      <button
        type="button"
        onClick={onNext}
        disabled={!canGoNext}
        aria-label="Periodo siguiente"
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/10 text-white/70 transition hover:bg-white/5 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/40 disabled:cursor-not-allowed disabled:opacity-30"
      >
        <ChevronRight className="h-4 w-4" aria-hidden />
      </button>

      <button
        type="button"
        onClick={onActual}
        disabled={isAtLatest}
        aria-label="Volver al periodo actual"
        className="rounded-md border border-white/10 px-2.5 py-1.5 text-xs font-medium text-white/70 transition hover:bg-white/5 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/40 disabled:cursor-not-allowed disabled:opacity-30"
      >
        Actual
      </button>
    </div>
  );
}
