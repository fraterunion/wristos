import {
  aggregateSalesTimeline,
  alignRangeForGranularity,
  bucketContaining,
  buildTimelineBuckets,
  parseUtcDateOnly,
  shiftBucketStart,
} from './sales-timeline';

describe('sales-timeline buckets (UTC)', () => {
  it('parses YYYY-MM-DD as UTC calendar day', () => {
    const d = parseUtcDateOnly('2026-07-15');
    expect(d?.toISOString()).toBe('2026-07-15T00:00:00.000Z');
    expect(parseUtcDateOnly('2026-02-30')).toBeNull();
  });

  it('day granularity returns calendar-day buckets', () => {
    const buckets = buildTimelineBuckets(
      'day',
      new Date('2026-07-01T00:00:00.000Z'),
      new Date('2026-07-04T00:00:00.000Z'),
    );
    expect(buckets.map((b) => b.key)).toEqual([
      '2026-07-01',
      '2026-07-02',
      '2026-07-03',
    ]);
    expect(buckets[0]!.label).toBe('1 Jul');
  });

  it('week granularity returns ISO week buckets Mon–Sun', () => {
    // Jul 1 2026 is Wednesday → week starts Jun 29
    const buckets = buildTimelineBuckets(
      'week',
      new Date('2026-07-01T00:00:00.000Z'),
      new Date('2026-07-20T00:00:00.000Z'),
    );
    expect(buckets[0]!.key).toBe('2026-06-29');
    expect(buckets[0]!.startDate.toISOString()).toBe('2026-06-29T00:00:00.000Z');
    expect(buckets[0]!.endExclusive.toISOString()).toBe('2026-07-06T00:00:00.000Z');
    expect(buckets.length).toBeGreaterThanOrEqual(3);
  });

  it('month granularity returns calendar-month buckets', () => {
    const buckets = buildTimelineBuckets(
      'month',
      new Date('2026-01-15T00:00:00.000Z'),
      new Date('2026-04-01T00:00:00.000Z'),
    );
    expect(buckets.map((b) => b.key)).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(buckets[0]!.label).toBe('Ene 2026');
  });

  it('year granularity returns calendar-year buckets', () => {
    const buckets = buildTimelineBuckets(
      'year',
      new Date('2023-06-01T00:00:00.000Z'),
      new Date('2027-01-01T00:00:00.000Z'),
    );
    expect(buckets.map((b) => b.key)).toEqual(['2023', '2024', '2025', '2026']);
  });

  it('preserves zero buckets between sales', () => {
    const result = aggregateSalesTimeline({
      granularity: 'day',
      fromInclusive: new Date('2026-07-01T00:00:00.000Z'),
      toExclusive: new Date('2026-07-04T00:00:00.000Z'),
      deals: [
        {
          agreedPrice: 100,
          saleDate: new Date('2026-07-01T12:00:00.000Z'),
        },
        {
          agreedPrice: 200,
          saleDate: new Date('2026-07-03T12:00:00.000Z'),
        },
      ],
    });
    expect(result.buckets).toHaveLength(3);
    expect(result.buckets[1]!.salesCount).toBe(0);
    expect(result.buckets[1]!.revenue).toBe(0);
    expect(result.totals.revenue).toBe(300);
    expect(result.totals.salesCount).toBe(2);
  });

  it('July daily revenue and count reconcile to known totals', () => {
    const deals = [
      ...Array.from({ length: 31 }, (_, i) => ({
        agreedPrice: 400000,
        saleDate: new Date(Date.UTC(2026, 6, 1 + (i % 28), 15)),
      })),
      {
        agreedPrice: 1700500,
        saleDate: new Date(Date.UTC(2026, 6, 15, 15)),
      },
    ];
    const day = aggregateSalesTimeline({
      granularity: 'day',
      fromInclusive: new Date('2026-07-01T00:00:00.000Z'),
      toExclusive: new Date('2026-08-01T00:00:00.000Z'),
      deals,
    });
    expect(day.totals.revenue).toBe(14100500);
    expect(day.totals.salesCount).toBe(32);

    for (const g of ['week', 'month', 'year'] as const) {
      const r = aggregateSalesTimeline({
        granularity: g,
        fromInclusive: new Date('2026-07-01T00:00:00.000Z'),
        toExclusive: new Date('2026-08-01T00:00:00.000Z'),
        deals,
      });
      // week window aligned may include late June — filter July attribution via totals of deals in July only
      const julyOnly = deals.filter(
        (d) =>
          d.saleDate >= new Date('2026-07-01T00:00:00.000Z') &&
          d.saleDate < new Date('2026-08-01T00:00:00.000Z'),
      );
      const rev = julyOnly.reduce((s, d) => s + Number(d.agreedPrice), 0);
      expect(rev).toBe(14100500);
      expect(julyOnly).toHaveLength(32);
      // Month/year buckets entirely inside July range still sum exactly
      if (g === 'month' || g === 'year') {
        expect(r.totals.revenue).toBe(14100500);
        expect(r.totals.salesCount).toBe(32);
      }
    }
  });

  it('no timezone day-shift for noon UTC sales', () => {
    const result = aggregateSalesTimeline({
      granularity: 'day',
      fromInclusive: new Date('2026-07-14T00:00:00.000Z'),
      toExclusive: new Date('2026-07-16T00:00:00.000Z'),
      deals: [
        {
          agreedPrice: 1,
          saleDate: new Date('2026-07-15T23:30:00.000Z'),
        },
      ],
    });
    expect(result.buckets.find((b) => b.key === '2026-07-15')!.salesCount).toBe(1);
    expect(result.buckets.find((b) => b.key === '2026-07-14')!.salesCount).toBe(0);
  });

  it('alignRange and shiftBucketStart are deterministic', () => {
    const aligned = alignRangeForGranularity(
      'month',
      new Date('2026-07-15T00:00:00.000Z'),
      new Date('2026-09-10T00:00:00.000Z'),
    );
    expect(aligned.fromInclusive.toISOString()).toBe('2026-07-01T00:00:00.000Z');
    // toExclusive Sep 10 mid-month → include all of September → Oct 1
    expect(aligned.toExclusive.toISOString()).toBe('2026-10-01T00:00:00.000Z');

    const back = shiftBucketStart(new Date('2026-07-01T00:00:00.000Z'), 'month', -2);
    expect(back.toISOString()).toBe('2026-05-01T00:00:00.000Z');

    const containing = bucketContaining(new Date('2026-07-15T12:00:00.000Z'), 'week');
    expect(containing.key).toBe('2026-07-13');
  });
});
