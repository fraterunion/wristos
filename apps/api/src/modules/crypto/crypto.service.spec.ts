import { Prisma } from '@prisma/client';
import {
  holdingCostBasis,
  holdingCurrentValue,
  unrealizedPnl,
  unrealizedPnlPercent,
} from './crypto-math';
import {
  resolveCryptoPriceStatus,
  worstCryptoPriceStatus,
} from './crypto-staleness';
import { CryptoService } from './crypto.service';

describe('crypto-staleness', () => {
  const now = new Date('2026-08-06T12:00:00.000Z');

  it('returns MISSING when no capturedAt', () => {
    expect(resolveCryptoPriceStatus(null, now)).toBe('MISSING');
    expect(resolveCryptoPriceStatus(undefined, now)).toBe('MISSING');
  });

  it('returns FRESH within 24h', () => {
    expect(resolveCryptoPriceStatus(new Date('2026-08-06T00:00:00.000Z'), now)).toBe(
      'FRESH',
    );
  });

  it('returns STALE between 24h and 72h', () => {
    expect(resolveCryptoPriceStatus(new Date('2026-08-04T12:00:00.000Z'), now)).toBe(
      'STALE',
    );
  });

  it('returns VERY_STALE beyond 72h', () => {
    expect(resolveCryptoPriceStatus(new Date('2026-08-01T12:00:00.000Z'), now)).toBe(
      'VERY_STALE',
    );
  });

  it('worst status prefers MISSING', () => {
    expect(worstCryptoPriceStatus(['FRESH', 'STALE', 'MISSING'])).toBe('MISSING');
    expect(worstCryptoPriceStatus(['FRESH', 'VERY_STALE'])).toBe('VERY_STALE');
  });
});

describe('crypto-math', () => {
  it('computes cost basis with Decimal precision', () => {
    const cost = holdingCostBasis(
      new Prisma.Decimal('0.12345678'),
      new Prisma.Decimal('1800000.50'),
    )!;
    expect(cost.toFixed(8)).toBe('222222.26572839');
  });

  it('computes current value and unrealized P&L', () => {
    const qty = new Prisma.Decimal('2');
    const avg = new Prisma.Decimal('100');
    const price = new Prisma.Decimal('150');
    const cost = holdingCostBasis(qty, avg)!;
    const value = holdingCurrentValue(qty, price)!;
    const pnl = unrealizedPnl(value, cost)!;
    expect(cost.toFixed(2)).toBe('200.00');
    expect(value.toFixed(2)).toBe('300.00');
    expect(pnl.toFixed(2)).toBe('100.00');
    expect(unrealizedPnlPercent(pnl, cost)).toBe('50.00');
  });

  it('excludes missing price from current value', () => {
    expect(holdingCurrentValue(new Prisma.Decimal('1'), null)).toBeNull();
    expect(unrealizedPnl(null, new Prisma.Decimal('10'))).toBeNull();
  });

  it('returns null cost basis when averageCostMxn is null', () => {
    expect(holdingCostBasis(new Prisma.Decimal('10'), null)).toBeNull();
    expect(unrealizedPnl(new Prisma.Decimal('100'), null)).toBeNull();
  });
});

type HoldingRow = {
  id: string;
  tenantId: string;
  assetType: 'CRYPTO';
  ticker: string;
  name: string;
  quantity: Prisma.Decimal;
  averageCostMxn: Prisma.Decimal | null;
  location: string;
  custodian: string | null;
  notes: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type SnapshotRow = {
  id: string;
  tenantId: string;
  assetType: 'CRYPTO';
  ticker: string;
  priceMxn: Prisma.Decimal;
  capturedAt: Date;
  source: string;
  notes: string | null;
  createdByUserId: string | null;
  createdAt: Date;
};

function makeService(state: {
  holdings?: HoldingRow[];
  snapshots?: SnapshotRow[];
  treasuryCreates?: unknown[];
}) {
  const holdings = [...(state.holdings ?? [])];
  const snapshots = [...(state.snapshots ?? [])];
  const treasuryCreates = state.treasuryCreates ?? [];

  const prisma = {
    assetHolding: {
      findMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        return holdings.filter((h) => {
          if (where.tenantId && h.tenantId !== where.tenantId) return false;
          if (where.deletedAt === null && h.deletedAt != null) return false;
          return true;
        });
      }),
      findFirst: jest.fn(
        async ({ where }: { where: { id: string; tenantId: string; deletedAt: null } }) => {
          return (
            holdings.find(
              (h) =>
                h.id === where.id &&
                h.tenantId === where.tenantId &&
                h.deletedAt == null,
            ) ?? null
          );
        },
      ),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row: HoldingRow = {
          id: `h-${holdings.length + 1}`,
          tenantId: data.tenantId as string,
          assetType: 'CRYPTO',
          ticker: data.ticker as string,
          name: data.name as string,
          quantity: data.quantity as Prisma.Decimal,
          averageCostMxn: (data.averageCostMxn as Prisma.Decimal | null) ?? null,
          location: data.location as string,
          custodian: (data.custodian as string | null) ?? null,
          notes: (data.notes as string | null) ?? null,
          deletedAt: null,
          createdAt: new Date('2026-08-01T00:00:00.000Z'),
          updatedAt: new Date('2026-08-01T00:00:00.000Z'),
        };
        holdings.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const idx = holdings.findIndex((h) => h.id === where.id);
        const next = { ...holdings[idx], ...data, updatedAt: new Date() } as HoldingRow;
        holdings[idx] = next;
        return next;
      }),
    },
    assetPriceSnapshot: {
      findMany: jest.fn(
        async ({
          where,
          orderBy,
          take,
        }: {
          where: { tenantId: string; ticker?: string | { in: string[] } };
          orderBy?: unknown;
          take?: number;
        }) => {
          void orderBy;
          let rows = snapshots.filter((s) => s.tenantId === where.tenantId);
          if (typeof where.ticker === 'string') {
            rows = rows.filter((s) => s.ticker === where.ticker);
          } else if (where.ticker && 'in' in where.ticker) {
            const set = new Set(where.ticker.in);
            rows = rows.filter((s) => set.has(s.ticker));
          }
          rows = [...rows].sort(
            (a, b) =>
              a.ticker.localeCompare(b.ticker) ||
              b.capturedAt.getTime() - a.capturedAt.getTime(),
          );
          if (take != null) rows = rows.slice(0, take);
          return rows;
        },
      ),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row: SnapshotRow = {
          id: `p-${snapshots.length + 1}`,
          tenantId: data.tenantId as string,
          assetType: 'CRYPTO',
          ticker: data.ticker as string,
          priceMxn: data.priceMxn as Prisma.Decimal,
          capturedAt: data.capturedAt as Date,
          source: data.source as string,
          notes: (data.notes as string | null) ?? null,
          createdByUserId: (data.createdByUserId as string | null) ?? null,
          createdAt: new Date('2026-08-06T00:00:00.000Z'),
        };
        snapshots.push(row);
        return row;
      }),
    },
    treasuryEntry: {
      create: jest.fn(async (args: unknown) => {
        treasuryCreates.push(args);
        return args;
      }),
    },
  };

  const service = new CryptoService(prisma as never);
  return { service, prisma, holdings, snapshots, treasuryCreates };
}

function holding(
  partial: Partial<HoldingRow> & Pick<HoldingRow, 'id' | 'tenantId' | 'ticker'>,
): HoldingRow {
  return {
    assetType: 'CRYPTO',
    name: partial.name ?? partial.ticker,
    quantity: partial.quantity ?? new Prisma.Decimal('1'),
    averageCostMxn: partial.averageCostMxn ?? new Prisma.Decimal('100'),
    location: partial.location ?? 'Binance',
    custodian: partial.custodian ?? 'César',
    notes: partial.notes ?? null,
    deletedAt: partial.deletedAt ?? null,
    createdAt: partial.createdAt ?? new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: partial.updatedAt ?? new Date('2026-08-01T00:00:00.000Z'),
    ...partial,
  };
}

function snap(
  partial: Partial<SnapshotRow> &
    Pick<SnapshotRow, 'id' | 'tenantId' | 'ticker' | 'priceMxn' | 'capturedAt'>,
): SnapshotRow {
  return {
    assetType: 'CRYPTO',
    source: partial.source ?? 'Manual review',
    notes: null,
    createdByUserId: null,
    createdAt: new Date('2026-08-06T00:00:00.000Z'),
    ...partial,
  };
}

describe('CryptoService', () => {
  const now = new Date('2026-08-06T12:00:00.000Z');

  it('isolates tenants', async () => {
    const { service } = makeService({
      holdings: [
        holding({ id: '1', tenantId: 'a', ticker: 'BTC', quantity: new Prisma.Decimal('1') }),
        holding({ id: '2', tenantId: 'b', ticker: 'ETH', quantity: new Prisma.Decimal('2') }),
      ],
      snapshots: [
        snap({
          id: 'p1',
          tenantId: 'a',
          ticker: 'BTC',
          priceMxn: new Prisma.Decimal('1000'),
          capturedAt: now,
        }),
        snap({
          id: 'p2',
          tenantId: 'b',
          ticker: 'ETH',
          priceMxn: new Prisma.Decimal('2000'),
          capturedAt: now,
        }),
      ],
    });

    const a = await service.getSummary('a');
    const b = await service.getSummary('b');
    expect(a.activeHoldingCount).toBe(1);
    expect(a.totalCurrentValueMxn).toBe('1000.00');
    expect(b.activeHoldingCount).toBe(1);
    expect(b.totalCurrentValueMxn).toBe('4000.00');
  });

  it('allows multiple holdings for same ticker different locations', async () => {
    const { service } = makeService({
      holdings: [
        holding({
          id: '1',
          tenantId: 't',
          ticker: 'BTC',
          location: 'Binance',
          quantity: new Prisma.Decimal('0.5'),
          averageCostMxn: new Prisma.Decimal('100'),
        }),
        holding({
          id: '2',
          tenantId: 't',
          ticker: 'BTC',
          location: 'Ledger',
          quantity: new Prisma.Decimal('0.5'),
          averageCostMxn: new Prisma.Decimal('200'),
        }),
      ],
      snapshots: [
        snap({
          id: 'p1',
          tenantId: 't',
          ticker: 'BTC',
          priceMxn: new Prisma.Decimal('300'),
          capturedAt: now,
        }),
      ],
    });

    const list = await service.listHoldings('t', now);
    expect(list).toHaveLength(2);
    const summary = await service.getSummary('t');
    expect(summary.totalCurrentValueMxn).toBe('300.00');
    expect(summary.totalCostBasisMxn).toBe('150.00');
    expect(summary.unrealizedPnlMxn).toBe('150.00');
  });

  it('preserves fractional quantity precision', async () => {
    const { service } = makeService({});
    const created = await service.createHolding('t', {
      ticker: 'btc',
      name: 'Bitcoin',
      quantity: 0.12345678,
      averageCostMxn: 1000000,
      location: 'Cold wallet',
      custodian: 'César',
    });
    expect(created.ticker).toBe('BTC');
    expect(created.quantity).toContain('0.12345678');
  });

  it('uses latest price by capturedAt', async () => {
    const { service } = makeService({
      holdings: [
        holding({
          id: '1',
          tenantId: 't',
          ticker: 'ETH',
          quantity: new Prisma.Decimal('1'),
          averageCostMxn: new Prisma.Decimal('10'),
        }),
      ],
      snapshots: [
        snap({
          id: 'old',
          tenantId: 't',
          ticker: 'ETH',
          priceMxn: new Prisma.Decimal('100'),
          capturedAt: new Date('2026-08-01T00:00:00.000Z'),
        }),
        snap({
          id: 'new',
          tenantId: 't',
          ticker: 'ETH',
          priceMxn: new Prisma.Decimal('250'),
          capturedAt: new Date('2026-08-05T00:00:00.000Z'),
        }),
      ],
    });

    const list = await service.listHoldings('t', now);
    expect(list[0].latestPriceMxn).toBe('250.00000000');
    expect(list[0].currentValueMxn).toBe('250.00');
  });

  it('excludes missing prices from liquidity value and warns', async () => {
    const { service } = makeService({
      holdings: [
        holding({
          id: '1',
          tenantId: 't',
          ticker: 'BTC',
          quantity: new Prisma.Decimal('1'),
          averageCostMxn: new Prisma.Decimal('50'),
        }),
        holding({
          id: '2',
          tenantId: 't',
          ticker: 'SOL',
          quantity: new Prisma.Decimal('10'),
          averageCostMxn: new Prisma.Decimal('5'),
        }),
      ],
      snapshots: [
        snap({
          id: 'p1',
          tenantId: 't',
          ticker: 'BTC',
          priceMxn: new Prisma.Decimal('100'),
          capturedAt: now,
        }),
      ],
    });

    const summary = await service.getSummary('t');
    expect(summary.totalCurrentValueMxn).toBe('100.00');
    expect(summary.missingPriceTickers).toEqual(['SOL']);
    expect(summary.unpricedHoldingCount).toBe(1);
    expect(summary.cryptoPriceStatus).toBe('MISSING');
  });

  it('marks stale prices and still includes them in value', async () => {
    const { service } = makeService({
      holdings: [
        holding({
          id: '1',
          tenantId: 't',
          ticker: 'BTC',
          quantity: new Prisma.Decimal('1'),
          averageCostMxn: new Prisma.Decimal('1'),
        }),
      ],
      snapshots: [
        snap({
          id: 'p1',
          tenantId: 't',
          ticker: 'BTC',
          priceMxn: new Prisma.Decimal('999'),
          capturedAt: new Date('2026-08-04T00:00:00.000Z'),
        }),
      ],
    });

    const summary = await service.getPortfolioValuation('t', now);
    expect(summary.totalCurrentValueMxn).toBe('999.00');
    expect(summary.cryptoPriceStatus).toBe('STALE');
  });

  it('excludes soft-deleted holdings but keeps price history', async () => {
    const { service, snapshots } = makeService({
      holdings: [
        holding({
          id: '1',
          tenantId: 't',
          ticker: 'BTC',
          quantity: new Prisma.Decimal('1'),
          averageCostMxn: new Prisma.Decimal('10'),
        }),
      ],
      snapshots: [
        snap({
          id: 'p1',
          tenantId: 't',
          ticker: 'BTC',
          priceMxn: new Prisma.Decimal('100'),
          capturedAt: now,
        }),
      ],
    });

    await service.softDeleteHolding('1', 't');
    const summary = await service.getSummary('t');
    expect(summary.activeHoldingCount).toBe(0);
    expect(summary.totalCurrentValueMxn).toBe('0.00');
    expect(snapshots).toHaveLength(1);

    const history = await service.getPriceHistory('t', 'BTC');
    expect(history.items).toHaveLength(1);
  });

  it('rejects zero or negative prices', async () => {
    const { service } = makeService({});
    await expect(
      service.createPriceSnapshot('t', {
        ticker: 'BTC',
        priceMxn: 0,
        capturedAt: now.toISOString(),
        source: 'Manual',
      }),
    ).rejects.toThrow(/greater than zero/);
    await expect(
      service.createPriceSnapshot('t', {
        ticker: 'BTC',
        priceMxn: -1,
        capturedAt: now.toISOString(),
        source: 'Manual',
      }),
    ).rejects.toThrow();
  });

  it('returns clean empty portfolio summary', async () => {
    const { service } = makeService({});
    const summary = await service.getSummary('t');
    expect(summary).toMatchObject({
      totalCurrentValueMxn: '0.00',
      totalCostBasisMxn: '0.00',
      unrealizedPnlMxn: '0.00',
      activeHoldingCount: 0,
      pricedHoldingCount: 0,
      unpricedHoldingCount: 0,
      missingPriceTickers: [],
    });
  });

  it('allows opening holding with null averageCostMxn without fabricating P&L', async () => {
    const { service } = makeService({
      snapshots: [
        snap({
          id: 'p1',
          tenantId: 't',
          ticker: 'USDT',
          priceMxn: new Prisma.Decimal('18'),
          capturedAt: now,
        }),
      ],
    });
    const created = await service.createHolding('t', {
      ticker: 'USDT',
      name: 'Tether',
      quantity: 170949.66,
      location: 'Cuenta Crypto César',
      custodian: 'César',
    });
    expect(created.averageCostMxn).toBeNull();
    expect(created.costBasisMxn).toBeNull();
    expect(created.unrealizedPnlMxn).toBeNull();
    expect(created.currentValueMxn).toBe('3077093.88');

    const summary = await service.getSummary('t');
    expect(summary.totalCurrentValueMxn).toBe('3077093.88');
    expect(summary.totalCostBasisMxn).toBeNull();
    expect(summary.unrealizedPnlMxn).toBeNull();
  });

  it('does not create Treasury entries when creating holdings or prices', async () => {
    const { service, treasuryCreates } = makeService({});
    await service.createHolding('t', {
      ticker: 'USDT',
      name: 'Tether',
      quantity: 100,
      averageCostMxn: 17.5,
      location: 'Binance',
    });
    await service.createPriceSnapshot('t', {
      ticker: 'USDT',
      priceMxn: 18,
      capturedAt: now.toISOString(),
      source: 'Binance',
    });
    expect(treasuryCreates).toHaveLength(0);
  });
});
