import { DealStage, Prisma } from '@prisma/client';

import { AnalyticsService } from './analytics.service';

describe('AnalyticsService — historical sales excluded from totalPendingBalance', () => {
  const TENANT = 'tenant-ar';

  function makeService(opts: {
    deals: Array<{
      id: string;
      agreedPrice: Prisma.Decimal;
      sourceTag: string | null;
      importSessionId: string | null;
      paymentCount: number;
      stage?: DealStage;
    }>;
    paidByDeal?: Array<{ dealId: string; amount: number }>;
  }) {
    const prisma = {
      watch: {
        count: jest.fn(async () => 0),
        aggregate: jest.fn(async () => ({ _sum: { cost: null } })),
        findMany: jest.fn(async () => []),
        create: jest.fn(),
        update: jest.fn(),
      },
      client: { count: jest.fn(async () => 0) },
      deal: {
        count: jest.fn(async () => opts.deals.length),
        groupBy: jest.fn(async () => []),
        aggregate: jest.fn(async () => ({ _sum: { agreedPrice: null } })),
        findMany: jest.fn(async ({ select }: { select?: Record<string, unknown> }) => {
          if (select && 'id' in select && 'agreedPrice' in select) {
            return opts.deals.map((d) => ({
              id: d.id,
              agreedPrice: d.agreedPrice,
              sourceTag: d.sourceTag,
              importSessionId: d.importSessionId,
              _count: { payments: d.paymentCount },
            }));
          }
          return [];
        }),
        create: jest.fn(),
        update: jest.fn(),
      },
      payment: {
        aggregate: jest.fn(async () => ({ _sum: { amount: null } })),
        groupBy: jest.fn(async () =>
          (opts.paidByDeal ?? []).map((p) => ({
            dealId: p.dealId,
            _sum: { amount: new Prisma.Decimal(p.amount) },
          })),
        ),
        create: jest.fn(),
        update: jest.fn(),
      },
      accountEntry: { create: jest.fn(), update: jest.fn(), findMany: jest.fn() },
      treasuryEntry: { create: jest.fn() },
      operatingExpense: {
        aggregate: jest.fn(async () => ({ _sum: { amount: null } })),
      },
    };

    const treasury = {
      getAccountBalances: jest.fn(async () => ({ CASH: '0', BANK: '0', CESAR: '0' })),
    };

    return {
      service: new AnalyticsService(prisma as never, treasury as never),
      prisma,
    };
  }

  it('4. historical sale does not contribute to totalPendingBalance', async () => {
    const { service, prisma } = makeService({
      deals: [
        {
          id: 'hist',
          agreedPrice: new Prisma.Decimal(100_000),
          sourceTag: 'wrist-caviar-master-workbook-v1',
          importSessionId: null,
          paymentCount: 0,
        },
        {
          id: 'live',
          agreedPrice: new Prisma.Decimal(40_000),
          sourceTag: null,
          importSessionId: null,
          paymentCount: 0,
        },
      ],
      paidByDeal: [],
    });

    const summary = await service.getSummary(TENANT);
    expect(summary.totalPendingBalance).toBe('40000');
    expect(prisma.payment.create).not.toHaveBeenCalled();
    expect(prisma.deal.update).not.toHaveBeenCalled();
    expect(prisma.accountEntry.create).not.toHaveBeenCalled();
    expect(prisma.watch.create).not.toHaveBeenCalled();
    expect(prisma.treasuryEntry.create).not.toHaveBeenCalled();
  });

  it('5. operational unpaid sales still contribute; CXC path untouched', async () => {
    const { service, prisma } = makeService({
      deals: [
        {
          id: 'partial',
          agreedPrice: new Prisma.Decimal(50_000),
          sourceTag: null,
          importSessionId: null,
          paymentCount: 1,
        },
      ],
      paidByDeal: [{ dealId: 'partial', amount: 10_000 }],
    });

    const summary = await service.getSummary(TENANT);
    expect(summary.totalPendingBalance).toBe('40000');
    // Analytics does not read/write AccountEntry — CXC AR remains the cuentas module.
    expect(prisma.accountEntry.findMany).not.toHaveBeenCalled();
    expect(prisma.accountEntry.create).not.toHaveBeenCalled();
  });
});
