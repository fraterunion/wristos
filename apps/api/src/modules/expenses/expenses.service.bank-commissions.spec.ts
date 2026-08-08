import { OperatingExpenseCategory, Prisma } from '@prisma/client';
import { ExpensesService } from './expenses.service';

function d(n: number) {
  return new Prisma.Decimal(n);
}

describe('ExpensesService.summary — Treasury bank commissions', () => {
  it('uses structured Treasury commissions for bank KPI and totalSpend', async () => {
    const prisma = {
      operatingExpense: {
        findMany: jest.fn(async () => [
          { category: OperatingExpenseCategory.OTHER, amount: d(2227167.74) },
          { category: OperatingExpenseCategory.COMMISSIONS, amount: d(856507) },
        ]),
      },
      treasuryEntry: {
        aggregate: jest.fn(async () => ({ _sum: { commission: d(435289.15) } })),
        count: jest.fn(async () => 323),
      },
    };
    const service = new ExpensesService(prisma as never, {} as never);
    const summary = await service.summary('tenant-wc', {});

    expect(summary.totalOperatingExpenses).toBe('2227167.74');
    expect(summary.totalCommissions).toBe('856507.00');
    expect(summary.totalBankFees).toBe('435289.15');
    expect(summary.bankCommissionMovementCountAllTime).toBe(323);
    expect(summary.totalSpend).toBe('3518963.89');
    expect(summary.byCategory.some((r) => r.category === 'TREASURY_BANK_COMMISSIONS')).toBe(
      true,
    );
    expect(
      summary.byCategory.find((r) => r.category === 'TREASURY_BANK_COMMISSIONS')?.sourceLabel,
    ).toBe('Fuente: Control Bancos');
    expect(prisma.treasuryEntry.aggregate).toHaveBeenCalled();
    const where = (prisma.treasuryEntry.aggregate.mock.calls[0] as unknown as [
      { where: Record<string, unknown> },
    ])[0].where;
    expect(where.commission).toEqual({ gt: 0 });
    expect(where.account).toBe('BANK');
    expect(where.tenantId).toBe('tenant-wc');
  });

  it('does not count OperatingExpense.BANK_FEES as bank commission KPI', async () => {
    const prisma = {
      operatingExpense: {
        findMany: jest.fn(async () => [
          { category: OperatingExpenseCategory.OTHER, amount: d(100) },
          { category: OperatingExpenseCategory.BANK_FEES, amount: d(2000) },
          { category: OperatingExpenseCategory.COMMISSIONS, amount: d(50) },
        ]),
      },
      treasuryEntry: {
        aggregate: jest.fn(async () => ({ _sum: { commission: d(435289.15) } })),
        count: jest.fn(async () => 323),
      },
    };
    const service = new ExpensesService(prisma as never, {} as never);
    const summary = await service.summary('tenant-wc', {});

    // BANK_FEES OpEx rolls into operativos
    expect(summary.totalOperatingExpenses).toBe('2100.00');
    expect(summary.totalBankFees).toBe('435289.15');
    expect(summary.totalSpend).toBe((2100 + 50 + 435289.15).toFixed(2));
  });

  it('filters treasury commissions by transactionDate window', async () => {
    const prisma = {
      operatingExpense: {
        findMany: jest.fn(async () => []),
      },
      treasuryEntry: {
        aggregate: jest.fn(async () => ({ _sum: { commission: d(54453.8) } })),
        count: jest.fn(async () => 24),
      },
    };
    const service = new ExpensesService(prisma as never, {} as never);
    await service.summary('tenant-wc', { year: '2026', month: '7' });
    const where = (prisma.treasuryEntry.aggregate.mock.calls[0] as unknown as [
      { where: { transactionDate: { gte: Date; lte: Date } } },
    ])[0].where;
    expect(where.transactionDate.gte.toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(where.transactionDate.lte).toBeDefined();
  });
});
