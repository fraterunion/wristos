import { Currency, Prisma, TreasuryDirection } from '@prisma/client';
import { TreasuryService } from './treasury.service';

function d(n: number) {
  return new Prisma.Decimal(n);
}

describe('TreasuryService — physical CASH MXN KPI', () => {
  const TENANT = 'tenant-wc';

  it('uses latest physical adjustment + subsequent MXN movements; ignores USD', async () => {
    const physicalCashBalanceAdjustment = {
      findFirst: jest.fn(async () => ({
        resultingBalance: d(731200),
        effectiveDate: new Date('2026-08-04T00:00:00.000Z'),
      })),
    };

    const treasuryEntry = {
      groupBy: jest.fn(async (args: { by: string[]; where: Record<string, unknown> }) => {
        // BANK/CESAR path in getAccountBalances
        if (args.by.includes('account')) {
          return [
            {
              account: 'BANK',
              direction: TreasuryDirection.INFLOW,
              _sum: { amountMxn: d(100) },
            },
            {
              account: 'BANK',
              direction: TreasuryDirection.OUTFLOW,
              _sum: { amountMxn: d(40) },
            },
            {
              account: 'CESAR',
              direction: TreasuryDirection.INFLOW,
              _sum: { amountMxn: d(80) },
            },
            {
              account: 'CESAR',
              direction: TreasuryDirection.OUTFLOW,
              _sum: { amountMxn: d(30) },
            },
            // CASH rows present but must be skipped in first groupBy
            {
              account: 'CASH',
              direction: TreasuryDirection.INFLOW,
              _sum: { amountMxn: d(999999) },
            },
          ];
        }
        // sumMxnCashMovements after snapshot
        expect(args.where.currency).toBe(Currency.MXN);
        expect(args.where.account).toBe('CASH');
        return [
          { direction: TreasuryDirection.INFLOW, _sum: { amountMxn: d(5000) } },
          { direction: TreasuryDirection.OUTFLOW, _sum: { amountMxn: d(2000) } },
        ];
      }),
    };

    const prisma = { physicalCashBalanceAdjustment, treasuryEntry };
    const service = new TreasuryService(prisma as never);
    const balances = await service.getAccountBalances(TENANT);

    expect(balances.CASH).toBe('734200.00'); // 731200 + 5000 - 2000
    expect(balances.BANK).toBe('60.00');
    expect(balances.CESAR).toBe('50.00');
  });

  it('falls back to MXN-only movement net when no physical adjustment exists', async () => {
    const physicalCashBalanceAdjustment = {
      findFirst: jest.fn(async () => null),
    };
    const treasuryEntry = {
      groupBy: jest.fn(async (args: { by: string[]; where: Record<string, unknown> }) => {
        if (args.by.includes('account')) {
          return [
            {
              account: 'BANK',
              direction: TreasuryDirection.INFLOW,
              _sum: { amountMxn: d(10) },
            },
          ];
        }
        expect(args.where.currency).toBe(Currency.MXN);
        return [
          { direction: TreasuryDirection.INFLOW, _sum: { amountMxn: d(997960) } },
          { direction: TreasuryDirection.OUTFLOW, _sum: { amountMxn: d(0) } },
        ];
      }),
    };

    const service = new TreasuryService({
      physicalCashBalanceAdjustment,
      treasuryEntry,
    } as never);

    const balances = await service.getAccountBalances(TENANT);
    expect(balances.CASH).toBe('997960.00');
  });

  it('recordPhysicalCashBalanceAdjustment stores audit fields', async () => {
    const create = jest.fn(async (args: { data: Record<string, unknown> }) => args.data);
    const physicalCashBalanceAdjustment = {
      findFirst: jest.fn(async () => null),
      create,
    };
    const treasuryEntry = {
      groupBy: jest.fn(async () => [
        { direction: TreasuryDirection.INFLOW, _sum: { amountMxn: d(3920252) } },
        { direction: TreasuryDirection.OUTFLOW, _sum: { amountMxn: d(0) } },
      ]),
    };

    const service = new TreasuryService({
      physicalCashBalanceAdjustment,
      treasuryEntry,
    } as never);

    // When previousBalance is supplied, do not recompute from movements.
    await service.recordPhysicalCashBalanceAdjustment({
      tenantId: TENANT,
      resultingBalance: 731200,
      previousBalance: 3920252,
      reason: 'Saldo físico confirmado por Regina/César; ajuste manual de caja',
      source: 'business-owner-confirmation',
      actor: 'operator@test',
      effectiveDate: new Date('2026-08-04T00:00:00.000Z'),
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: TENANT,
        currency: Currency.MXN,
        previousBalance: expect.anything(),
        resultingBalance: expect.anything(),
        reason: 'Saldo físico confirmado por Regina/César; ajuste manual de caja',
        source: 'business-owner-confirmation',
        actor: 'operator@test',
      }),
    });
    const data = create.mock.calls[0][0].data as {
      previousBalance: Prisma.Decimal;
      adjustmentAmount: Prisma.Decimal;
      resultingBalance: Prisma.Decimal;
    };
    expect(data.previousBalance.toFixed(2)).toBe('3920252.00');
    expect(data.resultingBalance.toFixed(2)).toBe('731200.00');
    expect(data.adjustmentAmount.toFixed(2)).toBe('-3189052.00');
  });
});
