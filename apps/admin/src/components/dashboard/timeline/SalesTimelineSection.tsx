'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { apiGet } from '@/lib/api-client';
import type {
  AnalyticsPeriod,
  CashFlowSummaryPoint,
  SalesTimelineBucket,
  SalesTimelineResponse,
  TimelineGranularity,
} from '@/types/domain';
import { AnalyticsGranularitySelector } from './AnalyticsGranularitySelector';
import { AnalyticsTimelineControls } from './AnalyticsTimelineControls';
import {
  ScrollableTimeSeries,
  type ScrollableTimeSeriesHandle,
} from './ScrollableTimeSeries';
import { RevenueAreaPlot, SoldWatchesBarPlot } from './TimelineCharts';
import {
  BUCKET_MIN_WIDTH,
  useAnalyticsTimeline,
} from './useAnalyticsTimeline';

function fmtMxnCompact(value: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '$0';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) {
    const v = n / 1_000_000;
    return `$${v.toFixed(v >= 10 ? 1 : 1)}M`;
  }
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    currencyDisplay: 'narrowSymbol',
    maximumFractionDigits: 0,
  }).format(n);
}

function mapGranularityToCashFlowPeriod(g: TimelineGranularity): AnalyticsPeriod {
  if (g === 'day') return 'month';
  return g;
}

function visibleTotals(buckets: SalesTimelineBucket[], start: number, count: number) {
  const slice = buckets.slice(start, start + count);
  let revenue = 0;
  let salesCount = 0;
  for (const b of slice) {
    revenue += b.revenue;
    salesCount += b.salesCount;
  }
  return { revenue, salesCount };
}

export function SalesTimelineSection({
  cashFlowSlot,
}: {
  cashFlowSlot: (args: {
    period: AnalyticsPeriod;
    cashFlow: CashFlowSummaryPoint | null;
    loading: boolean;
  }) => ReactNode;
}) {
  const [granularity, setGranularity] = useState<TimelineGranularity>('month');
  const [timeline, setTimeline] = useState<SalesTimelineResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [cashFlow, setCashFlow] = useState<CashFlowSummaryPoint | null>(null);
  const [cashFlowLoading, setCashFlowLoading] = useState(true);
  const [hasAnimated, setHasAnimated] = useState(false);
  const prefersReducedMotion = usePrefersReducedMotion();

  const buckets = timeline?.buckets ?? [];
  const labels = useMemo(() => buckets.map((b) => b.label), [buckets]);

  const timelineState = useAnalyticsTimeline({
    granularity,
    setGranularity,
    bucketCount: buckets.length,
    bucketLabels: labels,
  });

  const bucketWidth = BUCKET_MIN_WIDTH[granularity];
  const contentWidth = Math.max(buckets.length * bucketWidth, bucketWidth * timelineState.visibleCount);
  const barSize = Math.max(10, Math.min(28, Math.floor(bucketWidth * 0.55)));

  const revenueRef = useRef<ScrollableTimeSeriesHandle>(null);
  const soldRef = useRef<ScrollableTimeSeriesHandle>(null);
  const syncLock = useRef(false);

  const {
    windowStart,
    visibleCount,
    canGoPrev,
    canGoNext,
    goPrev,
    goNext,
    goActual,
    syncFromScrollLeft,
    targetScrollLeft,
    rangeLabel,
  } = timelineState;

  const syncScroll = useCallback(
    (source: 'revenue' | 'sold', left: number) => {
      if (syncLock.current) return;
      syncLock.current = true;
      const other = source === 'revenue' ? soldRef : revenueRef;
      other.current?.scrollToLeft(left, 'auto');
      syncFromScrollLeft(left, bucketWidth);
      requestAnimationFrame(() => {
        syncLock.current = false;
      });
    },
    [bucketWidth, syncFromScrollLeft],
  );

  // Apply window navigation to both scrollers
  useEffect(() => {
    const left = targetScrollLeft(bucketWidth);
    syncLock.current = true;
    const behavior =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth';
    revenueRef.current?.scrollToLeft(left, behavior);
    soldRef.current?.scrollToLeft(left, behavior);
    requestAnimationFrame(() => {
      syncLock.current = false;
    });
  }, [windowStart, bucketWidth, targetScrollLeft]);

  // Initial scroll to latest after data load
  useEffect(() => {
    if (!timeline || buckets.length === 0) return;
    const left = targetScrollLeft(bucketWidth);
    revenueRef.current?.scrollToLeft(left, 'auto');
    soldRef.current?.scrollToLeft(left, 'auto');
    if (!hasAnimated) {
      const t = window.setTimeout(() => setHasAnimated(true), 700);
      return () => window.clearTimeout(t);
    }
  }, [timeline, buckets.length, bucketWidth, targetScrollLeft, hasAnimated]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const data = await apiGet<SalesTimelineResponse>('/analytics/sales-timeline', {
          authenticated: true,
          query: { granularity },
        });
        if (!cancelled) setTimeline(data);
      } catch {
        if (!cancelled) setTimeline(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [granularity]);

  const cashPeriod = mapGranularityToCashFlowPeriod(granularity);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setCashFlowLoading(true);
      try {
        const data = await apiGet<CashFlowSummaryPoint>('/analytics/cash-flow', {
          authenticated: true,
          query: { period: cashPeriod },
        });
        if (!cancelled) setCashFlow(data);
      } catch {
        if (!cancelled) setCashFlow(null);
      } finally {
        if (!cancelled) setCashFlowLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [cashPeriod]);

  const visible = visibleTotals(buckets, windowStart, visibleCount);
  const allZero =
    buckets.length > 0 && buckets.every((b) => b.revenue === 0 && b.salesCount === 0);
  const animate = !prefersReducedMotion && !hasAnimated;

  const srSummary = `Timeline ${granularity}: ${rangeLabel}. Ventas ${fmtMxnCompact(visible.revenue)}, ${visible.salesCount} relojes.`;

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/50">
            Analytics
          </p>
          <p className="mt-1 text-sm text-white/35">
            Tendencias de ingresos, ventas y flujo de caja.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:items-end">
          <AnalyticsGranularitySelector
            value={granularity}
            onChange={(g) => {
              setHasAnimated(false);
              setGranularity(g);
            }}
          />
          <AnalyticsTimelineControls
            rangeLabel={rangeLabel}
            canGoPrev={canGoPrev}
            canGoNext={canGoNext}
            onPrev={goPrev}
            onNext={goNext}
            onActual={goActual}
            isAtLatest={!canGoNext}
          />
        </div>
      </div>

      <p className="sr-only" aria-live="polite">
        {srSummary}
      </p>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <article className="ui-card flex min-h-[320px] flex-col xl:col-span-1">
          <header className="border-b border-white/[0.06] pb-3">
            <h4 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">
              Ventas en el tiempo
            </h4>
            <p className="mt-1.5 text-sm font-medium tabular-nums text-white/85">
              {loading ? '—' : fmtMxnCompact(visible.revenue)}
              <span className="ml-2 text-xs font-normal text-white/35">
                · {loading ? '—' : visible.salesCount} ventas
              </span>
            </p>
            <p className="mt-0.5 text-[11px] text-white/35">{rangeLabel}</p>
          </header>
          <div className="mt-3 min-h-[280px] flex-1 sm:min-h-[300px]">
            {loading && !timeline ? (
              <div className="h-full animate-pulse rounded-lg bg-white/10" />
            ) : allZero || buckets.length === 0 ? (
              <EmptyTimeline />
            ) : (
              <ScrollableTimeSeries
                ref={revenueRef}
                contentWidth={contentWidth}
                className="h-full"
                ariaLabel="Gráfico de ventas en el tiempo"
                onScrollLeft={(left) => syncScroll('revenue', left)}
              >
                <div style={{ width: contentWidth, height: '100%' }} className="min-h-[260px]">
                  <RevenueAreaPlot data={buckets} animate={animate} />
                </div>
              </ScrollableTimeSeries>
            )}
          </div>
        </article>

        <article className="ui-card flex min-h-[320px] flex-col">
          <header className="border-b border-white/[0.06] pb-3">
            <h4 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">
              Relojes vendidos en el tiempo
            </h4>
            <p className="mt-1.5 text-sm font-medium tabular-nums text-white/85">
              {loading ? '—' : visible.salesCount}
              <span className="ml-2 text-xs font-normal text-white/35">relojes</span>
            </p>
            <p className="mt-0.5 text-[11px] text-white/35">{rangeLabel}</p>
          </header>
          <div className="mt-3 min-h-[280px] flex-1 sm:min-h-[300px]">
            {loading && !timeline ? (
              <div className="h-full animate-pulse rounded-lg bg-white/10" />
            ) : allZero || buckets.length === 0 ? (
              <EmptyTimeline />
            ) : (
              <ScrollableTimeSeries
                ref={soldRef}
                contentWidth={contentWidth}
                className="h-full"
                ariaLabel="Gráfico de relojes vendidos en el tiempo"
                onScrollLeft={(left) => syncScroll('sold', left)}
              >
                <div style={{ width: contentWidth, height: '100%' }} className="min-h-[260px]">
                  <SoldWatchesBarPlot data={buckets} animate={animate} barSize={barSize} />
                </div>
              </ScrollableTimeSeries>
            )}
          </div>
        </article>

        <article className="ui-card min-h-[320px]">
          {cashFlowSlot({
            period: cashPeriod,
            cashFlow,
            loading: cashFlowLoading,
          })}
        </article>
      </div>
    </section>
  );
}

function EmptyTimeline() {
  return (
    <div className="flex h-full min-h-[260px] flex-col items-center justify-center rounded-lg border border-dashed border-white/10 px-4 text-center">
      <p className="text-sm text-white/45">No hubo ventas en este periodo</p>
      <p className="mt-1 text-[11px] text-white/25">
        No hay deals CLOSED_WON con fecha de venta en este rango.
      </p>
    </div>
  );
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const handler = () => setReduced(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return reduced;
}
