import { DealStage, Prisma } from '@prisma/client';
import {
  buildCalendarPeriodWindow,
  getCalendarBucketLabel,
} from './calendar-period';
import { AnalyticsPeriod } from './dto/analytics-period.dto';
import { AnalyticsService } from './analytics.service';

function d(n: number) {
  return new Prisma.Decimal(n);
}

describe('calendar period windows (UTC)', () => {
  const july29 = new Date('2026-07-29T18:00:00.000Z');

  it('month = current calendar month, not rolling 30 days', () => {
    const w = buildCalendarPeriodWindow(AnalyticsPeriod.MONTH, july29);
    expect(w.start.toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(w.endExclusive.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(w.periodLabel).toBe('mes actual');
  });

  it('week = current ISO week Mon–Sun', () => {
    // 2026-07-29 is Wednesday → week starts Mon 2026-07-27
    const w = buildCalendarPeriodWindow(AnalyticsPeriod.WEEK, july29);
    expect(w.start.toISOString()).toBe('2026-07-27T00:00:00.000Z');
    expect(w.endExclusive.toISOString()).toBe('2026-08-03T00:00:00.000Z');
    expect(w.labels).toHaveLength(7);
  });

  it('year = current calendar year Jan–Dec', () => {
    const w = buildCalendarPeriodWindow(AnalyticsPeriod.YEAR, july29);
    expect(w.start.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(w.endExclusive.toISOString()).toBe('2027-01-01T00:00:00.000Z');
    expect(w.labels).toHaveLength(12);
    expect(w.labels[0]).toBe('2026-01');
    expect(w.labels[11]).toBe('2026-12');
  });

  it('empty periods still return valid zero-capable labels', () => {
    const w = buildCalendarPeriodWindow(AnalyticsPeriod.MONTH, july29);
    expect(w.labels.length).toBeGreaterThan(0);
    for (const label of w.labels) {
      expect(typeof label).toBe('string');
      expect(label.length).toBeGreaterThan(0);
    }
  });
});

describe('AnalyticsService — Deal-based revenue / sales charts', () => {
  const TENANT = 'tenant-wc';
  const OTHER = 'tenant-other';
  const july29 = new Date('2026-07-29T12:00:00.000Z');

  type FakeDeal = {
    tenantId: string;
    stage: DealStage;
    deletedAt: Date | null;
    agreedPrice: Prisma.Decimal;
    soldAt: Date | null;
    updatedAt: Date;
    createdAt: Date;
  };

  const julyDeals: FakeDeal[] = [
    // 32 deals totaling 14100500 — simplified as a few rows that sum correctly for unit test
    ...Array.from({ length: 31 }, (_, i) => ({
      tenantId: TENANT,
      stage: DealStage.CLOSED_WON,
      deletedAt: null,
      agreedPrice: d(400000),
      soldAt: new Date(Date.UTC(2026, 6, 1 + (i % 28))),
      updatedAt: new Date(Date.UTC(2026, 6, 1)),
      createdAt: new Date(Date.UTC(2026, 6, 1)),
    })),
    {
      tenantId: TENANT,
      stage: DealStage.CLOSED_WON,
      deletedAt: null,
      agreedPrice: d(1700500), // 31*400000 + 1700500 = 14100500
      soldAt: new Date(Date.UTC(2026, 6, 15)),
      updatedAt: new Date(Date.UTC(2026, 6, 15)),
      createdAt: new Date(Date.UTC(2026, 6, 15)),
    },
    // other tenant — must not appear
    {
      tenantId: OTHER,
      stage: DealStage.CLOSED_WON,
      deletedAt: null,
      agreedPrice: d(9999999),
      soldAt: new Date(Date.UTC(2026, 6, 10)),
      updatedAt: new Date(Date.UTC(2026, 6, 10)),
      createdAt: new Date(Date.UTC(2026, 6, 10)),
    },
    // June deal — outside July calendar month
    {
      tenantId: TENANT,
      stage: DealStage.CLOSED_WON,
      deletedAt: null,
      agreedPrice: d(500000),
      soldAt: new Date(Date.UTC(2026, 5, 30)),
      updatedAt: new Date(Date.UTC(2026, 5, 30)),
      createdAt: new Date(Date.UTC(2026, 5, 30)),
    },
  ];

  function makeService(deals: FakeDeal[], now: Date) {
    jest.useFakeTimers().setSystemTime(now);
    const prisma = {
      deal: {
        findMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
          let rows = deals.filter(
            (d) => d.tenantId === where.tenantId && d.deletedAt === null && d.stage === DealStage.CLOSED_WON,
          );
          const and = where.AND as Array<{ OR: Array<Record<string, unknown>> }> | undefined;
          if (and?.[0]?.OR) {
            const or = and[0].OR;
            rows = rows.filter((d) => {
              for (const clause of or) {
                if (clause.soldAt && typeof clause.soldAt === 'object' && 'gte' in (clause.soldAt as object)) {
                  const { gte, lt } = clause.soldAt as { gte: Date; lt: Date };
                  if (d.soldAt && d.soldAt >= gte && d.soldAt < lt) return true;
                }
                if (clause.soldAt === null) {
                  const u = clause.updatedAt as { gte: Date; lt: Date };
                  if (d.soldAt === null && d.updatedAt >= u.gte && d.updatedAt < u.lt) return true;
                }
              }
              return false;
            });
          }
          return rows;
        }),
      },
      payment: {
        findMany: jest.fn(async () => {
          throw new Error('revenue chart must not query Payment rows');
        }),
      },
      treasuryEntry: {
        groupBy: jest.fn(async () => []),
        aggregate: jest.fn(async () => ({ _sum: { commission: null } })),
        count: jest.fn(async () => 0),
      },
    };
    const treasury = {
      getAccountBalances: jest.fn(async () => ({ CASH: '0', BANK: '0', CESAR: '0' })),
    };
    return { service: new AnalyticsService(prisma as never, treasury as never), prisma };
  }

  afterEach(() => {
    jest.useRealTimers();
  });

  it('July monthly revenue chart sums to 14100500 without Payment rows', async () => {
    const { service, prisma } = makeService(julyDeals, july29);
    const series = await service.getRevenueOverTime(TENANT, AnalyticsPeriod.MONTH);
    const total = series.reduce((s, p) => s + p.revenue, 0);
    expect(total).toBe(14100500);
    expect(prisma.payment.findMany).not.toHaveBeenCalled();
    expect(series.every((p) => typeof p.label === 'string' && typeof p.revenue === 'number')).toBe(
      true,
    );
  });

  it('July monthly sold-count chart includes exactly 32 deals', async () => {
    const { service } = makeService(julyDeals, july29);
    const series = await service.getSalesOverTime(TENANT, AnalyticsPeriod.MONTH);
    const total = series.reduce((s, p) => s + p.count, 0);
    expect(total).toBe(32);
  });

  it('calendar-month boundaries match the sales KPI window', async () => {
    const w = buildCalendarPeriodWindow(AnalyticsPeriod.MONTH, july29);
    expect(w.start.toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(w.endExclusive.toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });

  it('tenant isolation', async () => {
    const { service } = makeService(julyDeals, july29);
    const series = await service.getRevenueOverTime(OTHER, AnalyticsPeriod.MONTH);
    const total = series.reduce((s, p) => s + p.revenue, 0);
    expect(total).toBe(9999999);
  });

  it('empty period returns zero buckets', async () => {
    const { service } = makeService([], july29);
    const series = await service.getRevenueOverTime(TENANT, AnalyticsPeriod.MONTH);
    expect(series.length).toBeGreaterThan(0);
    expect(series.every((p) => p.revenue === 0)).toBe(true);
  });
});

describe('AnalyticsService — Treasury cash flow', () => {
  afterEach(() => jest.useRealTimers());

  it('sums amountMxn inflows/outflows for calendar month; ignores balances and COGS', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-29T12:00:00.000Z'));
    const groupBy = jest.fn(async () => [
      { direction: 'INFLOW', _sum: { amountMxn: d(8255940.17) } },
      { direction: 'OUTFLOW', _sum: { amountMxn: d(6139237) } },
    ]);
    const prisma = {
      treasuryEntry: { groupBy },
      deal: { findMany: jest.fn() },
      operatingExpense: { aggregate: jest.fn() },
      watch: { aggregate: jest.fn() },
    };
    const service = new AnalyticsService(prisma as never, {
      getAccountBalances: jest.fn(),
    } as never);

    const cf = await service.getCashFlow('tenant-wc', AnalyticsPeriod.MONTH);
    expect(cf.inflows).toBe('8255940.17');
    expect(cf.outflows).toBe('6139237.00');
    expect(cf.net).toBe('2116703.17');
    expect(cf.periodLabel).toBe('mes actual');

    const where = (groupBy.mock.calls[0] as unknown as [
      { where: Record<string, unknown> },
    ])[0].where as {
      tenantId: string;
      deletedAt: null;
      account: unknown;
      transactionDate: { gte: Date; lt: Date };
    };
    expect(where.tenantId).toBe('tenant-wc');
    expect(where.deletedAt).toBeNull();
    expect(where.account).toEqual({ in: ['CASH', 'BANK', 'CESAR'] });
    expect(where.transactionDate.gte.toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(where.transactionDate.lt.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    // Does not query balances or operating expenses
    expect(prisma.operatingExpense.aggregate).not.toHaveBeenCalled();
  });

  it('does not add commission separately (already in amountMxn semantics)', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-29T12:00:00.000Z'));
    const groupBy = jest.fn(async ({ _sum }: { _sum: { amountMxn: true } }) => {
      expect(_sum).toEqual({ amountMxn: true });
      return [
        { direction: 'INFLOW', _sum: { amountMxn: d(100) } },
        { direction: 'OUTFLOW', _sum: { amountMxn: d(40) } },
      ];
    });
    const prisma = { treasuryEntry: { groupBy } };
    const service = new AnalyticsService(prisma as never, {} as never);
    const cf = await service.getCashFlow('t', AnalyticsPeriod.MONTH);
    expect(cf.net).toBe('60.00');
  });
});

describe('getCalendarBucketLabel timezone consistency', () => {
  it('buckets by UTC day/month', () => {
    const date = new Date('2026-07-15T23:30:00.000Z');
    expect(getCalendarBucketLabel(date, 'day')).toBe('2026-07-15');
    expect(getCalendarBucketLabel(date, 'month')).toBe('2026-07');
  });
});
