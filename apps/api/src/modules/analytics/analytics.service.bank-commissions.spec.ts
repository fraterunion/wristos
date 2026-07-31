import { Prisma } from '@prisma/client';
import { AnalyticsService } from './analytics.service';

describe('AnalyticsService — structured bank commissions', () => {
  it('bankCommissionsThisMonth comes from TreasuryEntry.commission, not OpEx BANK_FEES', async () => {
    const treasuryEntry = {
      aggregate: jest
        .fn()
        // this-month sum, then all-time sum
        .mockResolvedValueOnce({ _sum: { commission: new Prisma.Decimal(54453.8) } })
        .mockResolvedValueOnce({ _sum: { commission: new Prisma.Decimal(435289.15) } }),
      count: jest.fn().mockResolvedValueOnce(24).mockResolvedValueOnce(323),
    };

    const prisma = {
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
      operatingExpense: {
        aggregate: jest.fn(async () => ({ _sum: { amount: new Prisma.Decimal(0) } })),
      },
      treasuryEntry,
    };

    const treasury = {
      getAccountBalances: jest.fn(async () => ({ CASH: '0', BANK: '0', CESAR: '0' })),
    };

    const service = new AnalyticsService(prisma as never, treasury as never);
    const summary = await service.getSummary('tenant-wc');

    expect(summary.bankCommissionsThisMonth).toBe('54453.80');
    expect(summary.bankFeesThisMonth).toBe('54453.80');
    expect(summary.bankCommissionMovementCountThisMonth).toBe(24);
    expect(summary.bankCommissionsAllTime).toBe('435289.15');
    expect(summary.bankCommissionMovementCountAllTime).toBe(323);

    const monthWhere = treasuryEntry.aggregate.mock.calls[0][0].where;
    expect(monthWhere.tenantId).toBe('tenant-wc');
    expect(monthWhere.account).toBe('BANK');
    expect(monthWhere.commission).toEqual({ gt: 0 });
    expect(monthWhere.transactionDate).toBeDefined();
    expect(monthWhere.transactionDate.gte).toBeInstanceOf(Date);
    expect(monthWhere.transactionDate.lt).toBeInstanceOf(Date);
  });
});
