/**
 * Shared sales timeline bucket builder (UTC calendar boundaries).
 *
 * Date rule (WristOS analytics convention):
 * - All bucket boundaries use UTC calendar days/weeks/months/years.
 * - Sale attribution uses effectiveSaleDate (soldAt ?? updatedAt ?? createdAt).
 * - Do not mix browser-local timezone with these boundaries.
 *
 * Granularity = bucket size (not “only show current period”):
 * - day   → one bucket per UTC calendar day
 * - week  → one bucket per ISO week (Mon–Sun UTC)
 * - month → one bucket per calendar month
 * - year  → one bucket per calendar year
 */

import { startOfDayUtc, startOfUtcIsoWeek, formatDayUtc, formatWeekLabel } from './calendar-period';

export type TimelineGranularity = 'day' | 'week' | 'month' | 'year';

export type TimelineBucketDef = {
  key: string;
  label: string;
  /** Inclusive start (UTC midnight). */
  startDate: Date;
  /** Exclusive end (UTC). */
  endExclusive: Date;
};

const MONTHS_SHORT = [
  'Ene',
  'Feb',
  'Mar',
  'Abr',
  'May',
  'Jun',
  'Jul',
  'Ago',
  'Sep',
  'Oct',
  'Nov',
  'Dic',
];

export function parseUtcDateOnly(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== mo - 1 ||
    date.getUTCDate() !== d
  ) {
    return null;
  }
  return date;
}

export function formatUtcDateOnly(date: Date): string {
  return formatDayUtc(startOfDayUtc(date));
}

function alignBucketStart(date: Date, granularity: TimelineGranularity): Date {
  const day = startOfDayUtc(date);
  if (granularity === 'day') return day;
  if (granularity === 'week') return startOfUtcIsoWeek(day);
  if (granularity === 'month') {
    return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1));
  }
  return new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
}

function nextBucketStart(start: Date, granularity: TimelineGranularity): Date {
  if (granularity === 'day') {
    return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + 1));
  }
  if (granularity === 'week') {
    return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + 7));
  }
  if (granularity === 'month') {
    return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  }
  return new Date(Date.UTC(start.getUTCFullYear() + 1, 0, 1));
}

function bucketKey(start: Date, granularity: TimelineGranularity): string {
  if (granularity === 'day') return formatDayUtc(start);
  if (granularity === 'week') return formatDayUtc(start); // Monday of ISO week
  if (granularity === 'month') {
    return `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  return String(start.getUTCFullYear());
}

function bucketLabel(start: Date, endExclusive: Date, granularity: TimelineGranularity): string {
  if (granularity === 'day') {
    const day = start.getUTCDate();
    const month = MONTHS_SHORT[start.getUTCMonth()];
    return `${day} ${month}`;
  }
  if (granularity === 'week') {
    const lastDay = new Date(
      Date.UTC(endExclusive.getUTCFullYear(), endExclusive.getUTCMonth(), endExclusive.getUTCDate() - 1),
    );
    return formatWeekLabel(start, lastDay);
  }
  if (granularity === 'month') {
    return `${MONTHS_SHORT[start.getUTCMonth()]} ${start.getUTCFullYear()}`;
  }
  return String(start.getUTCFullYear());
}

/** Inclusive–exclusive bucket covering `date` for the given granularity. */
export function bucketContaining(date: Date, granularity: TimelineGranularity): TimelineBucketDef {
  const startDate = alignBucketStart(date, granularity);
  const endExclusive = nextBucketStart(startDate, granularity);
  return {
    key: bucketKey(startDate, granularity),
    label: bucketLabel(startDate, endExclusive, granularity),
    startDate,
    endExclusive,
  };
}

/** Align an arbitrary [from, toExclusive) range to full bucket boundaries. */
export function alignRangeForGranularity(
  granularity: TimelineGranularity,
  fromInclusive: Date,
  toExclusive: Date,
): { fromInclusive: Date; toExclusive: Date } {
  const from = alignBucketStart(fromInclusive, granularity);
  let end = alignBucketStart(toExclusive, granularity);
  if (toExclusive.getTime() > end.getTime()) {
    end = nextBucketStart(end, granularity);
  }
  if (end.getTime() <= from.getTime()) {
    end = nextBucketStart(from, granularity);
  }
  return { fromInclusive: from, toExclusive: end };
}

/** Step N buckets backward from a bucket start. */
export function shiftBucketStart(
  start: Date,
  granularity: TimelineGranularity,
  steps: number,
): Date {
  let cursor = alignBucketStart(start, granularity);
  if (steps >= 0) {
    for (let i = 0; i < steps; i += 1) {
      cursor = nextBucketStart(cursor, granularity);
    }
    return cursor;
  }
  for (let i = 0; i < -steps; i += 1) {
    if (granularity === 'day') {
      cursor = new Date(
        Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate() - 1),
      );
    } else if (granularity === 'week') {
      cursor = new Date(
        Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate() - 7),
      );
    } else if (granularity === 'month') {
      cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() - 1, 1));
    } else {
      cursor = new Date(Date.UTC(cursor.getUTCFullYear() - 1, 0, 1));
    }
  }
  return cursor;
}

/**
 * Build contiguous buckets covering [fromInclusive, toExclusive).
 * from/to are aligned to granularity starts/ends.
 */
export function buildTimelineBuckets(
  granularity: TimelineGranularity,
  fromInclusive: Date,
  toExclusive: Date,
): TimelineBucketDef[] {
  const start = alignBucketStart(fromInclusive, granularity);
  let end = alignBucketStart(toExclusive, granularity);
  // Ensure the bucket containing toExclusive-ε is included when toExclusive is mid-bucket
  if (toExclusive.getTime() > end.getTime()) {
    end = nextBucketStart(end, granularity);
  }
  // Always include at least through the aligned end cursor
  if (end.getTime() <= start.getTime()) {
    end = nextBucketStart(start, granularity);
  }

  const buckets: TimelineBucketDef[] = [];
  let cursor = start;
  // Safety cap — prevents runaway loops on bad input
  const maxBuckets = 5000;
  while (cursor.getTime() < end.getTime() && buckets.length < maxBuckets) {
    const next = nextBucketStart(cursor, granularity);
    buckets.push({
      key: bucketKey(cursor, granularity),
      label: bucketLabel(cursor, next, granularity),
      startDate: cursor,
      endExclusive: next,
    });
    cursor = next;
  }
  return buckets;
}

export function findBucketKeyForDate(
  date: Date,
  buckets: TimelineBucketDef[],
): string | null {
  for (const b of buckets) {
    if (date >= b.startDate && date < b.endExclusive) return b.key;
  }
  return null;
}

export type SalesTimelineBucketResult = {
  key: string;
  label: string;
  startDate: string;
  endDate: string;
  revenue: number;
  salesCount: number;
  averageTicket: number;
};

export type SalesTimelineResult = {
  granularity: TimelineGranularity;
  from: string;
  to: string;
  buckets: SalesTimelineBucketResult[];
  totals: {
    revenue: number;
    salesCount: number;
    averageTicket: number;
  };
};

export function aggregateSalesTimeline(params: {
  granularity: TimelineGranularity;
  fromInclusive: Date;
  toExclusive: Date;
  deals: Array<{ agreedPrice: { toString(): string } | number; saleDate: Date }>;
}): SalesTimelineResult {
  const { granularity, fromInclusive, toExclusive, deals } = params;
  const defs = buildTimelineBuckets(granularity, fromInclusive, toExclusive);

  const revenueByKey = new Map<string, number>();
  const countByKey = new Map<string, number>();
  for (const def of defs) {
    revenueByKey.set(def.key, 0);
    countByKey.set(def.key, 0);
  }

  let totalRevenue = 0;
  let totalCount = 0;

  for (const deal of deals) {
    const saleDate = deal.saleDate;
    if (saleDate < fromInclusive || saleDate >= toExclusive) continue;
    const key = findBucketKeyForDate(saleDate, defs);
    if (!key) continue;
    const revenue = Number(deal.agreedPrice);
    revenueByKey.set(key, (revenueByKey.get(key) ?? 0) + revenue);
    countByKey.set(key, (countByKey.get(key) ?? 0) + 1);
    totalRevenue += revenue;
    totalCount += 1;
  }

  const buckets: SalesTimelineBucketResult[] = defs.map((def) => {
    const revenue = Number((revenueByKey.get(def.key) ?? 0).toFixed(2));
    const salesCount = countByKey.get(def.key) ?? 0;
    const averageTicket =
      salesCount > 0 ? Number((revenue / salesCount).toFixed(2)) : 0;
    // endDate is inclusive last calendar day for API consumers
    const lastDay = new Date(def.endExclusive.getTime() - 1);
    return {
      key: def.key,
      label: def.label,
      startDate: formatUtcDateOnly(def.startDate),
      endDate: formatUtcDateOnly(lastDay),
      revenue,
      salesCount,
      averageTicket,
    };
  });

  return {
    granularity,
    from: formatUtcDateOnly(fromInclusive),
    to: formatUtcDateOnly(new Date(toExclusive.getTime() - 1)),
    buckets,
    totals: {
      revenue: Number(totalRevenue.toFixed(2)),
      salesCount: totalCount,
      averageTicket:
        totalCount > 0 ? Number((totalRevenue / totalCount).toFixed(2)) : 0,
    },
  };
}
