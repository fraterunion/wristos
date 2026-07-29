export type AnalyticsPeriodKind = 'week' | 'month' | 'year';

export type SeriesBucket = 'day' | 'week' | 'month';

export type WeekBucket = { label: string; from: Date; to: Date };

export type CalendarPeriodWindow = {
  /** Inclusive start (UTC). */
  start: Date;
  /** Exclusive end (UTC). */
  endExclusive: Date;
  labels: string[];
  bucket: SeriesBucket;
  weekBuckets?: WeekBucket[];
  /** Human label for UI, e.g. "mes actual". */
  periodLabel: string;
};

const MONTHS_SHORT = [
  'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
  'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic',
];

export function startOfDayUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Monday 00:00 UTC of the ISO week containing `date`. */
export function startOfUtcIsoWeek(date: Date): Date {
  const d = startOfDayUtc(date);
  const day = d.getUTCDay(); // 0=Sun … 6=Sat
  const diffFromMonday = day === 0 ? -6 : 1 - day;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diffFromMonday));
}

export function formatDayUtc(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(
    date.getUTCDate(),
  ).padStart(2, '0')}`;
}

export function formatMonthUtc(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function formatWeekLabel(from: Date, to: Date): string {
  const fromMonth = MONTHS_SHORT[from.getUTCMonth()];
  const toMonth = MONTHS_SHORT[to.getUTCMonth()];
  const fromDay = from.getUTCDate();
  const toDay = to.getUTCDate();
  if (fromMonth === toMonth) return `${fromMonth} ${fromDay}–${toDay}`;
  return `${fromMonth} ${fromDay}–${toMonth} ${toDay}`;
}

/**
 * Calendar-period series windows (UTC).
 * - week  = current ISO week (Mon–Sun)
 * - month = current calendar month
 * - year  = current calendar year
 *
 * Not rolling 7/30/365-day windows.
 */
export function buildCalendarPeriodWindow(
  period: AnalyticsPeriodKind,
  now: Date = new Date(),
): CalendarPeriodWindow {
  const today = startOfDayUtc(now);

  if (period === 'year') {
    const year = today.getUTCFullYear();
    const start = new Date(Date.UTC(year, 0, 1));
    const endExclusive = new Date(Date.UTC(year + 1, 0, 1));
    const labels: string[] = [];
    for (let m = 0; m < 12; m += 1) {
      labels.push(formatMonthUtc(new Date(Date.UTC(year, m, 1))));
    }
    return {
      start,
      endExclusive,
      labels,
      bucket: 'month',
      periodLabel: 'año actual',
    };
  }

  if (period === 'month') {
    const year = today.getUTCFullYear();
    const month = today.getUTCMonth();
    const start = new Date(Date.UTC(year, month, 1));
    const endExclusive = new Date(Date.UTC(year, month + 1, 1));
    const lastDay = new Date(Date.UTC(year, month + 1, 0));

    const weekBuckets: WeekBucket[] = [];
    let cursor = startOfUtcIsoWeek(start);
    while (cursor < endExclusive) {
      const weekEndDay = new Date(
        Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate() + 6),
      );
      const from = cursor < start ? start : cursor;
      const toDay = weekEndDay >= endExclusive ? lastDay : weekEndDay;
      if (from <= lastDay && from < endExclusive) {
        const to = new Date(
          Date.UTC(toDay.getUTCFullYear(), toDay.getUTCMonth(), toDay.getUTCDate(), 23, 59, 59, 999),
        );
        weekBuckets.push({
          label: formatWeekLabel(from, toDay),
          from,
          to,
        });
      }
      cursor = new Date(
        Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate() + 7),
      );
    }

    return {
      start,
      endExclusive,
      labels: weekBuckets.map((w) => w.label),
      bucket: 'week',
      weekBuckets,
      periodLabel: 'mes actual',
    };
  }

  // WEEK — current ISO week, one bucket per day Mon–Sun
  const start = startOfUtcIsoWeek(today);
  const endExclusive = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + 7),
  );
  const labels: string[] = [];
  for (let i = 0; i < 7; i += 1) {
    labels.push(
      formatDayUtc(
        new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + i)),
      ),
    );
  }
  return {
    start,
    endExclusive,
    labels,
    bucket: 'day',
    periodLabel: 'semana actual',
  };
}

export function getCalendarBucketLabel(
  date: Date,
  bucket: SeriesBucket,
  weekBuckets?: WeekBucket[],
): string {
  if (bucket === 'day') return formatDayUtc(date);
  if (bucket === 'month') return formatMonthUtc(date);
  const wb = weekBuckets?.find((w) => date >= w.from && date <= w.to);
  return wb?.label ?? weekBuckets?.[weekBuckets.length - 1]?.label ?? formatDayUtc(date);
}
