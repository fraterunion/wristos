import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TimelineGranularity } from '@/types/domain';

export const VISIBLE_BUCKET_DEFAULTS: Record<TimelineGranularity, number> = {
  day: 30,
  week: 16,
  month: 12,
  year: 6,
};

export const BUCKET_MIN_WIDTH: Record<TimelineGranularity, number> = {
  day: 44,
  week: 64,
  month: 80,
  year: 100,
};

export type AnalyticsTimelineState = {
  granularity: TimelineGranularity;
  setGranularity: (g: TimelineGranularity) => void;
  /** Index of first visible bucket (inclusive). */
  windowStart: number;
  visibleCount: number;
  canGoPrev: boolean;
  canGoNext: boolean;
  goPrev: () => void;
  goNext: () => void;
  goActual: () => void;
  /** Sync window from scrollLeft (bucket-aligned). */
  syncFromScrollLeft: (scrollLeft: number, bucketWidth: number) => void;
  /** Target scrollLeft for current windowStart. */
  targetScrollLeft: (bucketWidth: number) => number;
  rangeLabel: string;
  /** Buckets currently intended to be in the viewport window (for header metrics). */
  visibleBucketKeys: string[];
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

/**
 * Shared granularity + visible-window navigation for synchronized timeline charts.
 * Scroll position is owned by the scroll containers; this state drives prev/next/actual.
 */
export function useAnalyticsTimeline(params: {
  granularity: TimelineGranularity;
  setGranularity: (g: TimelineGranularity) => void;
  bucketCount: number;
  bucketLabels: string[];
}): AnalyticsTimelineState {
  const { granularity, setGranularity, bucketCount, bucketLabels } = params;
  const visibleCount = Math.min(VISIBLE_BUCKET_DEFAULTS[granularity], Math.max(bucketCount, 1));
  const maxStart = Math.max(0, bucketCount - visibleCount);

  const [windowStart, setWindowStart] = useState(maxStart);

  // Reset to latest window when granularity or data length changes
  useEffect(() => {
    setWindowStart(Math.max(0, bucketCount - visibleCount));
  }, [granularity, bucketCount, visibleCount]);

  const canGoPrev = windowStart > 0;
  const canGoNext = windowStart < maxStart;

  const goPrev = useCallback(() => {
    setWindowStart((s) => clamp(s - visibleCount, 0, maxStart));
  }, [visibleCount, maxStart]);

  const goNext = useCallback(() => {
    setWindowStart((s) => clamp(s + visibleCount, 0, maxStart));
  }, [visibleCount, maxStart]);

  const goActual = useCallback(() => {
    setWindowStart(maxStart);
  }, [maxStart]);

  const syncFromScrollLeft = useCallback(
    (scrollLeft: number, bucketWidth: number) => {
      if (bucketWidth <= 0) return;
      const idx = clamp(Math.round(scrollLeft / bucketWidth), 0, maxStart);
      setWindowStart((prev) => (prev === idx ? prev : idx));
    },
    [maxStart],
  );

  const targetScrollLeft = useCallback(
    (bucketWidth: number) => windowStart * bucketWidth,
    [windowStart],
  );

  const rangeLabel = useMemo(() => {
    if (bucketCount === 0) return 'Sin datos';
    const start = clamp(windowStart, 0, bucketCount - 1);
    const end = clamp(windowStart + visibleCount - 1, 0, bucketCount - 1);
    const a = bucketLabels[start] ?? '';
    const b = bucketLabels[end] ?? '';
    if (a === b) return a;
    return `${a} — ${b}`;
  }, [bucketCount, bucketLabels, windowStart, visibleCount]);

  const visibleBucketKeys = useMemo(() => {
    const keys: string[] = [];
    for (let i = windowStart; i < windowStart + visibleCount && i < bucketCount; i += 1) {
      keys.push(String(i));
    }
    return keys;
  }, [windowStart, visibleCount, bucketCount]);

  return {
    granularity,
    setGranularity,
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
    visibleBucketKeys,
  };
}
