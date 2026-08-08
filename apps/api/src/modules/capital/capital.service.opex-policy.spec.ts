import { Prisma } from '@prisma/client';
import { CapitalService } from './capital.service';

/**
 * Commit 15A financial gate — Capital vs Analytics OpEx divergence.
 *
 * Capital totalBusinessProfit = revenue − COGS − Treasury bank commissions
 * Analytics monthly net profit = revenue − COGS − bank commissions − OperatingExpense
 *
 * Correcting Capital to include OpEx is OPTION C: would retroactively change
 * Wrist Caviar partner entitlement by ~MXN 3,083,674.74 against already-paid
 * distributions (~MXN 2,732,961). Formula must stay until an explicit Capital
 * reconciliation decision.
 */
describe('CapitalService — OperatingExpense policy (15A financial gate)', () => {
  it('excludes OperatingExpense from totalBusinessProfit / pending / capitalNeto', async () => {
    const prisma = {
      deal: {
        findMany: jest.fn(async () => [
          {
            agreedPrice: new Prisma.Decimal(500_000),
            historicalCost: new Prisma.Decimal(300_000),
            watch: null,
          },
        ]),
      },
      treasuryEntry: {
        aggregate: jest.fn(async () => ({
          _sum: { commission: new Prisma.Decimal(10_000) },
        })),
      },
      operatingExpense: {
        aggregate: jest.fn(async () => ({
          _sum: { amount: new Prisma.Decimal(38_000) },
        })),
        findMany: jest.fn(async () => {
          throw new Error('Capital must not load OperatingExpense rows');
        }),
      },
      investor: {
        findMany: jest.fn(async () => [
          {
            id: 'cesar',
            name: 'CESAR',
            ownershipPercent: new Prisma.Decimal(75),
            isActive: true,
            contributions: [],
            distributions: [],
            openingBalances: [],
          },
          {
            id: 'edgar',
            name: 'EDGAR',
            ownershipPercent: new Prisma.Decimal(25),
            isActive: true,
            contributions: [],
            distributions: [],
            openingBalances: [],
          },
        ]),
      },
    };

    const service = new CapitalService(prisma as never);
    const summary = await service.getSummary('tenant-wc');

    // Capital formula ignores OpEx: 500k − 300k − 10k = 190k
    // (Analytics with OpEx 20k+18k would be 152k for the same month — different module.)
    expect(summary.totalBusinessProfit).toBe('190000.00');
    expect(summary.totalBankCommissions).toBe('10000.00');
    expect(summary.investors[0].profitEntitlement).toBe('142500.00'); // 75%
    expect(summary.investors[1].profitEntitlement).toBe('47500.00'); // 25%
    expect(summary.totalPendingToPartners).toBe('190000.00');
    expect(summary.capitalNeto).toBe('190000.00');
    expect(prisma.operatingExpense.aggregate).not.toHaveBeenCalled();
    expect(prisma.operatingExpense.findMany).not.toHaveBeenCalled();
  });

  it('documents that an 18k OpEx would NOT change Capital until reconciliation decision', async () => {
    const before = {
      revenue: 500_000,
      cogs: 300_000,
      bank: 10_000,
      opex: 20_000,
    };
    const capitalBefore =
      before.revenue - before.cogs - before.bank; // 190_000 (no opex)
    const analyticsBefore =
      before.revenue - before.cogs - before.bank - before.opex; // 170_000
    const capitalAfter = capitalBefore; // still 190_000 after +18k OpEx
    const analyticsAfter = analyticsBefore - 18_000; // 152_000

    expect(capitalBefore).toBe(190_000);
    expect(analyticsBefore).toBe(170_000);
    expect(capitalAfter).toBe(190_000);
    expect(analyticsAfter).toBe(152_000);
    // Divergence after new expense: Analytics − Capital = −(opex total)
    expect(analyticsAfter - capitalAfter).toBe(-(20_000 + 18_000));
  });
});
