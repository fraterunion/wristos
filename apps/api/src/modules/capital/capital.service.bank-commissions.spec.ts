import { Prisma } from '@prisma/client';
import { CapitalService } from './capital.service';

describe('CapitalService — Treasury bank commissions in business profit', () => {
  it('uses SUM(TreasuryEntry.commission) not OperatingExpense.BANK_FEES', async () => {
    const prisma = {
      deal: {
        findMany: jest.fn(async () => [
          {
            agreedPrice: new Prisma.Decimal(1000),
            historicalCost: new Prisma.Decimal(400),
            watch: null,
          },
        ]),
      },
      treasuryEntry: {
        aggregate: jest.fn(async () => ({
          _sum: { commission: new Prisma.Decimal(50) },
        })),
      },
      operatingExpense: {
        aggregate: jest.fn(async () => {
          throw new Error('must not use OperatingExpense.BANK_FEES');
        }),
      },
      investor: {
        findMany: jest.fn(async () => [
          {
            id: 'i1',
            name: 'CESAR',
            ownershipPercent: new Prisma.Decimal(100),
            isActive: true,
            contributions: [],
            distributions: [{ amount: new Prisma.Decimal(100) }],
          },
        ]),
      },
    };

    const service = new CapitalService(prisma as never);
    const summary = await service.getSummary('tenant-wc');

    // profit = 1000 - 400 - 50 = 550
    expect(summary.totalBusinessProfit).toBe('550.00');
    expect(summary.totalBankCommissions).toBe('50.00');
    expect(summary.totalPendingToPartners).toBe('450.00'); // 550 - 100
    expect(summary.capitalNeto).toBe('450.00'); // 0 + 550 - 100
    expect(summary.contributionsIncomplete).toBe(true);
    expect(summary.roiAvailable).toBe(false);
    expect(prisma.operatingExpense.aggregate).not.toHaveBeenCalled();
    expect(prisma.treasuryEntry.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          account: 'BANK',
          commission: { gt: 0 },
        }),
        _sum: { commission: true },
      }),
    );
  });
});
