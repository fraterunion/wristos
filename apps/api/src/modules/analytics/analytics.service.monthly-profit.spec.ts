import { DealStage, Prisma } from '@prisma/client';
import { AnalyticsService } from './analytics.service';

function d(n: number) {
  return new Prisma.Decimal(n);
}

describe('AnalyticsService — monthly profit deducts OpEx', () => {
  const TENANT = 'tenant-wc';
  const OTHER = 'tenant-other';
  const july29 = new Date('2026-07-29T12:00:00.000Z');

  afterEach(() => {
    jest.useRealTimers();
  });

  function makeService(opts: {
    revenue: number;
    cogsDeals: Array<{ historicalCost: number | null }>;
    bankCommission: number;
    opex: number;
    opexTenant?: string;
  }) {
    jest.useFakeTimers().setSystemTime(july29);

    const treasuryEntry = {
      aggregate: jest
        .fn()
        .mockResolvedValueOnce({ _sum: { commission: d(opts.bankCommission) } })
        .mockResolvedValueOnce({ _sum: { commission: d(opts.bankCommission) } }),
      count: jest.fn().mockResolvedValue(0),
    };

    const operatingExpense = {
      aggregate: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        if (where.tenantId !== TENANT) return { _sum: { amount: null } };
        const expenseDate = where.expenseDate as { gte: Date; lt: Date };
        // Only July 2026 window yields opex in these tests
        if (
          expenseDate.gte.getTime() === Date.UTC(2026, 6, 1) &&
          expenseDate.lt.getTime() === Date.UTC(2026, 7, 1)
        ) {
          return { _sum: { amount: d(opts.opex) } };
        }
        return { _sum: { amount: null } };
      }),
    };

    const prisma = {
      watch: {
        count: jest.fn(async () => 0),
        aggregate: jest.fn(async () => ({ _sum: { cost: null } })),
        findMany: jest.fn(async () => []),
      },
      client: { count: jest.fn(async () => 0) },
      deal: {
        count: jest.fn(async () => opts.cogsDeals.length),
        groupBy: jest.fn(async () => []),
        aggregate: jest.fn(async () => ({ _sum: { agreedPrice: d(opts.revenue) } })),
        findMany: jest
          .fn()
          // 1) receivableDeals
          .mockResolvedValueOnce([])
          // 2) dealsThisMonth for COGS
          .mockResolvedValueOnce(
            opts.cogsDeals.map((row) => ({
              historicalCost: row.historicalCost == null ? null : d(row.historicalCost),
              watch: null,
            })),
          ),
      },
      payment: {
        aggregate: jest.fn(async () => ({ _sum: { amount: null } })),
        groupBy: jest.fn(async () => []),
      },
      operatingExpense,
      treasuryEntry,
    };

    const treasury = {
      getAccountBalances: jest.fn(async () => ({ CASH: '0', BANK: '0', CESAR: '0' })),
    };

    return {
      service: new AnalyticsService(prisma as never, treasury as never),
      prisma,
      operatingExpense,
    };
  }

  it('July 2026: revenue − COGS − bank commissions − OpEx = 1,907,062.20', async () => {
    const { service, operatingExpense } = makeService({
      revenue: 14100500,
      cogsDeals: [{ historicalCost: 12040907 }],
      bankCommission: 54453.8,
      opex: 98077,
    });

    const summary = await service.getSummary(TENANT);
    expect(summary.profitThisMonth).toBe('1907062.2');
    expect(summary.operatingExpensesThisMonth).toBe('98077.00');
    expect(summary.bankCommissionsThisMonth).toBe('54453.80');

    const opexWhere = operatingExpense.aggregate.mock.calls[0][0].where as {
      tenantId: string;
      expenseDate: { gte: Date; lt: Date };
      category?: unknown;
    };
    expect(opexWhere.tenantId).toBe(TENANT);
    expect(opexWhere.expenseDate.gte.toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(opexWhere.expenseDate.lt.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    // All categories — no category filter (includes OpEx COMMISSIONS, not bank fees)
    expect(opexWhere.category).toBeUndefined();
  });

  it('does not double-count: bank commissions stay on Treasury; OpEx queried separately', async () => {
    const { service, prisma } = makeService({
      revenue: 1000000,
      cogsDeals: [{ historicalCost: 400000 }],
      bankCommission: 10000,
      opex: 50000,
    });
    const summary = await service.getSummary(TENANT);
    // 1_000_000 - 400_000 - 10_000 - 50_000 = 540_000
    expect(summary.profitThisMonth).toBe('540000');
    expect(prisma.treasuryEntry.aggregate).toHaveBeenCalled();
    expect(prisma.operatingExpense.aggregate).toHaveBeenCalled();
  });

  it('zero-expense month leaves profit = revenue − COGS − bank commissions', async () => {
    const { service } = makeService({
      revenue: 1000000,
      cogsDeals: [{ historicalCost: 400000 }],
      bankCommission: 10000,
      opex: 0,
    });
    const summary = await service.getSummary(TENANT);
    expect(summary.operatingExpensesThisMonth).toBe('0.00');
    expect(summary.profitThisMonth).toBe('590000');
  });

  it('tenant isolation — other tenant OpEx not applied', async () => {
    const { service } = makeService({
      revenue: 1000000,
      cogsDeals: [{ historicalCost: 0 }],
      bankCommission: 0,
      opex: 98077,
    });
    const other = await service.getSummary(OTHER);
    // makeService returns opex only for TENANT; OTHER gets 0 OpEx and 0 revenue stubs
    expect(other.operatingExpensesThisMonth).toBe('0.00');
  });

  it('calendar-month boundary: expenseDate window is UTC [monthStart, nextMonth)', async () => {
    const { operatingExpense } = makeService({
      revenue: 0,
      cogsDeals: [],
      bankCommission: 0,
      opex: 1,
    });
    await new AnalyticsService(
      {
        watch: {
          count: jest.fn(async () => 0),
          aggregate: jest.fn(async () => ({ _sum: { cost: null } })),
          findMany: jest.fn(async () => []),
        },
        client: { count: jest.fn(async () => 0) },
        deal: {
          count: jest.fn(async () => 0),
          groupBy: jest.fn(async () => []),
          aggregate: jest.fn(async () => ({ _sum: { agreedPrice: null } })),
          findMany: jest.fn(async () => []),
        },
        payment: {
          aggregate: jest.fn(async () => ({ _sum: { amount: null } })),
          groupBy: jest.fn(async () => []),
        },
        operatingExpense,
        treasuryEntry: {
          aggregate: jest.fn(async () => ({ _sum: { commission: null } })),
          count: jest.fn(async () => 0),
        },
      } as never,
      { getAccountBalances: jest.fn(async () => ({ CASH: '0', BANK: '0', CESAR: '0' })) } as never,
    ).getSummary(TENANT);

    const where = operatingExpense.aggregate.mock.calls[0][0].where as {
      expenseDate: { gte: Date; lt: Date };
    };
    expect(where.expenseDate.gte).toEqual(new Date(Date.UTC(2026, 6, 1)));
    expect(where.expenseDate.lt).toEqual(new Date(Date.UTC(2026, 7, 1)));
  });
});
