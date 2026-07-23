import { DealStage } from '@prisma/client';
import { Prisma } from '@prisma/client';

import {
  dealEffectiveSaleDateRangeWhere,
  effectiveSaleDate,
} from '../../common/utils/effective-sale-date';
import { AnalyticsService } from './analytics.service';

describe('AnalyticsService — historical sale dating', () => {
  const tenantId = 'tenant-dating';
  const now = new Date('2026-07-23T15:00:00.000Z');
  const monthStart = new Date(Date.UTC(2026, 6, 1));
  const nextMonth = new Date(Date.UTC(2026, 7, 1));

  type FakeDeal = {
    id: string;
    tenantId: string;
    stage: DealStage;
    deletedAt: Date | null;
    agreedPrice: Prisma.Decimal;
    soldAt: Date | null;
    updatedAt: Date;
    createdAt: Date;
    historicalCost: Prisma.Decimal | null;
    watch: null;
  };

  function matchesSaleRange(deal: FakeDeal, where: Record<string, unknown>): boolean {
    const and = where.AND as Array<Record<string, unknown>> | undefined;
    const range = and?.[0] ?? dealEffectiveSaleDateRangeWhere(monthStart, nextMonth);
    const or = (range as { OR: Array<Record<string, unknown>> }).OR;
    for (const clause of or) {
      if ('soldAt' in clause && clause.soldAt && typeof clause.soldAt === 'object' && 'gte' in (clause.soldAt as object)) {
        const { gte, lt } = clause.soldAt as { gte: Date; lt: Date };
        if (deal.soldAt && deal.soldAt >= gte && deal.soldAt < lt) return true;
      }
      if (clause.soldAt === null) {
        const updated = clause.updatedAt as { gte: Date; lt: Date };
        if (deal.soldAt === null && deal.updatedAt >= updated.gte && deal.updatedAt < updated.lt) return true;
      }
    }
    return false;
  }

  function makeService(deals: FakeDeal[]) {
    const prisma = {
      watch: {
        count: jest.fn(async () => 0),
        aggregate: jest.fn(async () => ({ _sum: { cost: null } })),
        findMany: jest.fn(async () => []),
      },
      client: { count: jest.fn(async () => 0) },
      deal: {
        count: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
          const rows = deals.filter((d) => d.tenantId === where.tenantId && d.deletedAt === null);
          if (!where.AND) return rows.length;
          return rows.filter((d) => matchesSaleRange(d, where)).length;
        }),
        groupBy: jest.fn(async () => []),
        aggregate: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
          let rows = deals.filter((d) => d.tenantId === where.tenantId && d.deletedAt === null);
          if (where.AND) rows = rows.filter((d) => matchesSaleRange(d, where));
          const sum = rows.reduce((a, d) => a + Number(d.agreedPrice), 0);
          return { _sum: { agreedPrice: new Prisma.Decimal(sum) } };
        }),
        findMany: jest.fn(async ({
          where,
          select,
        }: {
          where: Record<string, unknown>;
          select?: Record<string, unknown>;
        }) => {
          const tenantRows = deals.filter((d) => d.tenantId === where.tenantId && d.deletedAt === null);
          if (select?.agreedPrice && select?.id) {
            return tenantRows.map((d) => ({ id: d.id, agreedPrice: d.agreedPrice }));
          }
          if (where.AND) {
            return tenantRows
              .filter((d) => matchesSaleRange(d, where))
              .map((d) => ({ historicalCost: d.historicalCost, watch: d.watch }));
          }
          return tenantRows.map((d) => ({
            soldAt: d.soldAt,
            updatedAt: d.updatedAt,
            createdAt: d.createdAt,
          }));
        }),
      },
      payment: {
        aggregate: jest.fn(async () => ({ _sum: { amount: null } })),
        groupBy: jest.fn(async () => []),
        findMany: jest.fn(async () => []),
      },
      operatingExpense: {
        aggregate: jest.fn(async () => ({ _sum: { amount: null } })),
      },
    };

    const treasury = {
      getAccountBalances: jest.fn(async () => ({
        CASH: '0',
        BANCOS: '0',
        CESAR: '0',
      })),
    };

    return new AnalyticsService(prisma as never, treasury as never);
  }

  beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(now);
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  it('imported 2024 sale does not appear in current month KPIs', async () => {
    const historical: FakeDeal = {
      id: 'h1',
      tenantId,
      stage: DealStage.CLOSED_WON,
      deletedAt: null,
      agreedPrice: new Prisma.Decimal(345000),
      soldAt: new Date('2024-03-15T12:00:00.000Z'),
      updatedAt: now,
      createdAt: now,
      historicalCost: new Prisma.Decimal(298000),
      watch: null,
    };
    const service = makeService([historical]);
    const summary = await service.getSummary(tenantId);
    expect(summary.salesThisMonthCount).toBe(0);
    expect(Number(summary.salesThisMonthRevenue)).toBe(0);
  });

  it('legacy deal with null soldAt still counts via updatedAt fallback', async () => {
    const legacy: FakeDeal = {
      id: 'l1',
      tenantId,
      stage: DealStage.CLOSED_WON,
      deletedAt: null,
      agreedPrice: new Prisma.Decimal(100000),
      soldAt: null,
      updatedAt: new Date('2026-07-10T12:00:00.000Z'),
      createdAt: new Date('2026-07-10T12:00:00.000Z'),
      historicalCost: null,
      watch: null,
    };
    const service = makeService([legacy]);
    const summary = await service.getSummary(tenantId);
    expect(summary.salesThisMonthCount).toBe(1);
    expect(Number(summary.salesThisMonthRevenue)).toBe(100000);
  });

  it('mixed historical + current aggregates only current into this month', async () => {
    const deals: FakeDeal[] = [
      {
        id: 'h1',
        tenantId,
        stage: DealStage.CLOSED_WON,
        deletedAt: null,
        agreedPrice: new Prisma.Decimal(50000),
        soldAt: new Date('2024-06-01T12:00:00.000Z'),
        updatedAt: now,
        createdAt: now,
        historicalCost: new Prisma.Decimal(40000),
        watch: null,
      },
      {
        id: 'c1',
        tenantId,
        stage: DealStage.CLOSED_WON,
        deletedAt: null,
        agreedPrice: new Prisma.Decimal(20000),
        soldAt: new Date('2026-07-20T12:00:00.000Z'),
        updatedAt: now,
        createdAt: now,
        historicalCost: null,
        watch: null,
      },
    ];
    const service = makeService(deals);
    const summary = await service.getSummary(tenantId);
    expect(summary.salesThisMonthCount).toBe(1);
    expect(Number(summary.salesThisMonthRevenue)).toBe(20000);
  });

  it('effectiveSaleDate prefers soldAt for 2024 historical sale', () => {
    const saleDate = effectiveSaleDate({
      soldAt: new Date('2024-11-05T12:00:00.000Z'),
      updatedAt: now,
      createdAt: now,
    });
    expect(saleDate.getUTCFullYear()).toBe(2024);
  });
});
