import { Prisma } from '@prisma/client';
import { AnalyticsService } from '../analytics/analytics.service';
import { CryptoService } from './crypto.service';

/**
 * Proves dashboard liquidity adds crypto exactly once and crypto does not
 * mutate cash/bank/cesar or monthly profit.
 */
describe('Analytics crypto liquidity integration', () => {
  it('adds cryptoValueMxn into summary without changing treasury balances or profit', async () => {
    const cash = '731200.00';
    const bank = '4769759.44';
    const cesar = '80869.26';
    const profitBefore = '12345.67';

    const prisma = {
      watch: {
        count: jest.fn(async () => 0),
        aggregate: jest.fn(async () => ({ _sum: { cost: new Prisma.Decimal(0) } })),
      },
      client: { count: jest.fn(async () => 0) },
      deal: {
        count: jest.fn(async () => 0),
        groupBy: jest.fn(async () => []),
        aggregate: jest.fn(async () => ({
          _sum: { agreedPrice: new Prisma.Decimal(profitBefore) },
        })),
        findMany: jest.fn(async () => []),
      },
      payment: {
        aggregate: jest.fn(async () => ({ _sum: { amount: new Prisma.Decimal(0) } })),
        groupBy: jest.fn(async () => []),
      },
      treasuryEntry: {
        aggregate: jest.fn(async () => ({ _sum: { commission: new Prisma.Decimal(0) } })),
        count: jest.fn(async () => 0),
      },
      operatingExpense: {
        aggregate: jest.fn(async () => ({ _sum: { amount: new Prisma.Decimal(0) } })),
      },
    };

    const treasury = {
      getAccountBalances: jest.fn(async () => ({
        CASH: cash,
        BANK: bank,
        CESAR: cesar,
      })),
    };

    const crypto = {
      getPortfolioValuation: jest.fn(async () => ({
        totalCurrentValueMxn: '50000.00',
        totalCostBasisMxn: '40000.00',
        unrealizedPnlMxn: '10000.00',
        unrealizedPnlPercent: '25.00',
        activeHoldingCount: 1,
        pricedHoldingCount: 1,
        unpricedHoldingCount: 0,
        missingPriceTickers: [],
        oldestPriceCapturedAt: '2026-08-06T00:00:00.000Z',
        newestPriceCapturedAt: '2026-08-06T00:00:00.000Z',
        cryptoPriceStatus: 'FRESH' as const,
        _totalCurrentValue: new Prisma.Decimal(50000),
        _totalCostBasis: new Prisma.Decimal(40000),
        _unrealizedPnl: new Prisma.Decimal(10000),
      })),
    };

    const service = new AnalyticsService(
      prisma as never,
      treasury as never,
      crypto as never,
    );

    const summary = await service.getSummary('tenant-wc');

    expect(summary.cashBalance).toBe(cash);
    expect(summary.bankBalance).toBe(bank);
    expect(summary.cesarBalance).toBe(cesar);
    expect(summary.cryptoValueMxn).toBe('50000.00');
    expect(summary.cryptoCostBasisMxn).toBe('40000.00');
    expect(summary.cryptoUnrealizedPnlMxn).toBe('10000.00');
    expect(summary.cryptoMissingPriceTickers).toEqual([]);
    expect(crypto.getPortfolioValuation).toHaveBeenCalledTimes(1);

    // Liquidity composition (dashboard): cash + banks + crypto + cesar
    const liquidity =
      Number(summary.cashBalance) +
      Number(summary.bankBalance) +
      Number(summary.cryptoValueMxn) +
      Number(summary.cesarBalance);
    expect(liquidity.toFixed(2)).toBe('5631828.70');

    // Baseline without crypto remains 5,581,828.70
    const baseline =
      Number(summary.cashBalance) +
      Number(summary.bankBalance) +
      Number(summary.cesarBalance);
    expect(baseline.toFixed(2)).toBe('5581828.70');

    // Monthly profit is revenue − COGS − commissions − OpEx — crypto not included
    expect(Number(summary.profitThisMonth)).toBe(Number(profitBefore));
  });

  it('CryptoService itself never writes treasury', async () => {
    const creates: unknown[] = [];
    const prisma = {
      assetHolding: {
        findMany: jest.fn(async () => []),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          id: '1',
          deletedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          custodian: null,
          notes: null,
          assetType: 'CRYPTO',
          ...data,
        })),
      },
      assetPriceSnapshot: {
        findMany: jest.fn(async () => []),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          id: 'p1',
          createdAt: new Date(),
          notes: null,
          createdByUserId: null,
          assetType: 'CRYPTO',
          ...data,
        })),
      },
      treasuryEntry: {
        create: jest.fn(async (a: unknown) => {
          creates.push(a);
        }),
      },
    };
    const service = new CryptoService(prisma as never);
    await service.createHolding('t', {
      ticker: 'BTC',
      name: 'Bitcoin',
      quantity: 1,
      averageCostMxn: 1,
      location: 'Binance',
    });
    expect(creates).toHaveLength(0);
    expect(prisma.treasuryEntry.create).not.toHaveBeenCalled();
  });
});
