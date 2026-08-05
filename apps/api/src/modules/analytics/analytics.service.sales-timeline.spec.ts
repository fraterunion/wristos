import { DealStage, Prisma } from '@prisma/client';
import { AnalyticsService } from './analytics.service';
import { TimelineGranularityParam } from './dto/sales-timeline.dto';

const emptyCryptoService = {
  getPortfolioValuation: jest.fn(async () => ({
    totalCurrentValueMxn: '0.00',
    totalCostBasisMxn: '0.00',
    unrealizedPnlMxn: '0.00',
    unrealizedPnlPercent: null,
    activeHoldingCount: 0,
    pricedHoldingCount: 0,
    unpricedHoldingCount: 0,
    missingPriceTickers: [],
    oldestPriceCapturedAt: null,
    newestPriceCapturedAt: null,
    cryptoPriceStatus: 'MISSING' as const,
  })),
};


function d(n: number) {
  return new Prisma.Decimal(n);
}

describe('AnalyticsService.getSalesTimeline', () => {
  const TENANT = 'tenant-wc';
  const OTHER = 'tenant-other';

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
    ...Array.from({ length: 31 }, (_, i) => ({
      tenantId: TENANT,
      stage: DealStage.CLOSED_WON,
      deletedAt: null,
      agreedPrice: d(400000),
      soldAt: new Date(Date.UTC(2026, 6, 1 + (i % 28), 15)),
      updatedAt: new Date(Date.UTC(2026, 6, 1)),
      createdAt: new Date(Date.UTC(2026, 6, 1)),
    })),
    {
      tenantId: TENANT,
      stage: DealStage.CLOSED_WON,
      deletedAt: null,
      agreedPrice: d(1700500),
      soldAt: new Date(Date.UTC(2026, 6, 15, 15)),
      updatedAt: new Date(Date.UTC(2026, 6, 15)),
      createdAt: new Date(Date.UTC(2026, 6, 15)),
    },
    {
      tenantId: OTHER,
      stage: DealStage.CLOSED_WON,
      deletedAt: null,
      agreedPrice: d(9999999),
      soldAt: new Date(Date.UTC(2026, 6, 10, 15)),
      updatedAt: new Date(Date.UTC(2026, 6, 10)),
      createdAt: new Date(Date.UTC(2026, 6, 10)),
    },
  ];

  function makeService(deals: FakeDeal[], now: Date) {
    jest.useFakeTimers().setSystemTime(now);
    const prisma = {
      deal: {
        findMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
          let rows = deals.filter(
            (row) =>
              row.tenantId === where.tenantId &&
              row.deletedAt === null &&
              row.stage === DealStage.CLOSED_WON,
          );
          const and = where.AND as Array<{ OR: Array<Record<string, unknown>> }> | undefined;
          if (and?.[0]?.OR) {
            const or = and[0].OR;
            rows = rows.filter((row) => {
              for (const clause of or) {
                if (
                  clause.soldAt &&
                  typeof clause.soldAt === 'object' &&
                  'gte' in (clause.soldAt as object)
                ) {
                  const range = clause.soldAt as { gte: Date; lt: Date };
                  if (row.soldAt && row.soldAt >= range.gte && row.soldAt < range.lt) {
                    return true;
                  }
                }
                if (
                  clause.soldAt === null &&
                  clause.updatedAt &&
                  typeof clause.updatedAt === 'object'
                ) {
                  const range = clause.updatedAt as { gte: Date; lt: Date };
                  if (
                    row.soldAt === null &&
                    row.updatedAt >= range.gte &&
                    row.updatedAt < range.lt
                  ) {
                    return true;
                  }
                }
              }
              return false;
            });
          }
          return rows;
        }),
      },
    };
    return new AnalyticsService(prisma as never, {} as never, emptyCryptoService as never);
  }

  afterEach(() => {
    jest.useRealTimers();
  });

  it('day range reconciles July revenue and count without Payment rows', async () => {
    const service = makeService(julyDeals, new Date('2026-07-29T12:00:00.000Z'));
    const result = await service.getSalesTimeline(
      TENANT,
      TimelineGranularityParam.DAY,
      '2026-07-01',
      '2026-07-31',
    );
    expect(result.granularity).toBe('day');
    expect(result.totals.revenue).toBe(14100500);
    expect(result.totals.salesCount).toBe(32);
    expect(result.buckets.every((b) => b.key.match(/^\d{4}-\d{2}-\d{2}$/))).toBe(true);
    const sumRev = result.buckets.reduce((s, b) => s + b.revenue, 0);
    const sumCnt = result.buckets.reduce((s, b) => s + b.salesCount, 0);
    expect(sumRev).toBe(14100500);
    expect(sumCnt).toBe(32);
  });

  it('week/month/year share identical deal population for July window', async () => {
    const service = makeService(julyDeals, new Date('2026-07-29T12:00:00.000Z'));
    const month = await service.getSalesTimeline(
      TENANT,
      TimelineGranularityParam.MONTH,
      '2026-07-01',
      '2026-07-31',
    );
    const year = await service.getSalesTimeline(
      TENANT,
      TimelineGranularityParam.YEAR,
      '2026-01-01',
      '2026-12-31',
    );
    expect(month.totals.salesCount).toBe(32);
    expect(month.totals.revenue).toBe(14100500);
    expect(year.buckets.find((b) => b.key === '2026')?.salesCount).toBe(32);
  });

  it('tenant isolation — other tenant never included', async () => {
    const service = makeService(julyDeals, new Date('2026-07-29T12:00:00.000Z'));
    const result = await service.getSalesTimeline(
      TENANT,
      TimelineGranularityParam.MONTH,
      '2026-07-01',
      '2026-07-31',
    );
    expect(result.totals.revenue).toBe(14100500);
    const other = await service.getSalesTimeline(
      OTHER,
      TimelineGranularityParam.MONTH,
      '2026-07-01',
      '2026-07-31',
    );
    expect(other.totals.revenue).toBe(9999999);
  });

  it('averageTicket is exact for non-empty buckets', async () => {
    const service = makeService(
      [
        {
          tenantId: TENANT,
          stage: DealStage.CLOSED_WON,
          deletedAt: null,
          agreedPrice: d(300000),
          soldAt: new Date(Date.UTC(2026, 6, 10, 12)),
          updatedAt: new Date(Date.UTC(2026, 6, 10)),
          createdAt: new Date(Date.UTC(2026, 6, 10)),
        },
        {
          tenantId: TENANT,
          stage: DealStage.CLOSED_WON,
          deletedAt: null,
          agreedPrice: d(100000),
          soldAt: new Date(Date.UTC(2026, 6, 10, 14)),
          updatedAt: new Date(Date.UTC(2026, 6, 10)),
          createdAt: new Date(Date.UTC(2026, 6, 10)),
        },
      ],
      new Date('2026-07-29T12:00:00.000Z'),
    );
    const result = await service.getSalesTimeline(
      TENANT,
      TimelineGranularityParam.DAY,
      '2026-07-10',
      '2026-07-10',
    );
    const bucket = result.buckets.find((b) => b.key === '2026-07-10')!;
    expect(bucket.salesCount).toBe(2);
    expect(bucket.revenue).toBe(400000);
    expect(bucket.averageTicket).toBe(200000);
  });

  it('queries deals once (no N+1)', async () => {
    const service = makeService(julyDeals, new Date('2026-07-29T12:00:00.000Z'));
    const prisma = (service as unknown as { prisma: { deal: { findMany: jest.Mock } } })
      .prisma;
    await service.getSalesTimeline(TENANT, TimelineGranularityParam.DAY, '2026-07-01', '2026-07-31');
    expect(prisma.deal.findMany).toHaveBeenCalledTimes(1);
  });
});
