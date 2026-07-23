import { WatchStatus } from '@prisma/client';
import { Prisma } from '@prisma/client';

import { AnalyticsService } from './analytics.service';

type FakeWatch = {
  id: string;
  tenantId: string;
  brand: string | null;
  model: string | null;
  cost: Prisma.Decimal | null;
  priceMin: Prisma.Decimal | null;
  status: WatchStatus;
  deletedAt: Date | null;
  ownershipType?: string;
};

function d(n: number | null): Prisma.Decimal | null {
  return n === null ? null : new Prisma.Decimal(n);
}

/**
 * Minimal prisma stub covering getSummary + getInventoryByBrand inventory paths.
 * Other aggregates return empty/zero so summary can complete.
 */
function makePrisma(watches: FakeWatch[]) {
  const activeOf = (tenantId: string) =>
    watches.filter((w) => w.tenantId === tenantId && w.deletedAt === null && w.status !== WatchStatus.SOLD);

  const allOf = (tenantId: string) =>
    watches.filter((w) => w.tenantId === tenantId && w.deletedAt === null);

  return {
    watch: {
      count: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const tenantId = where.tenantId as string;
        let rows = allOf(tenantId);
        if (where.status === WatchStatus.AVAILABLE) {
          rows = rows.filter((w) => w.status === WatchStatus.AVAILABLE);
        } else if (where.status === WatchStatus.RESERVED) {
          rows = rows.filter((w) => w.status === WatchStatus.RESERVED);
        } else if (where.status === WatchStatus.SOLD) {
          rows = rows.filter((w) => w.status === WatchStatus.SOLD);
        } else if (where.status && typeof where.status === 'object' && 'not' in (where.status as object)) {
          rows = activeOf(tenantId);
        }
        if (where.ownershipType) {
          rows = rows.filter((w) => w.ownershipType === where.ownershipType);
        }
        return rows.length;
      }),
      aggregate: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const tenantId = where.tenantId as string;
        const rows = activeOf(tenantId);
        const sum = rows.reduce((acc, w) => acc + Number(w.cost ?? 0), 0);
        return { _sum: { cost: new Prisma.Decimal(sum) } };
      }),
      findMany: jest.fn(async ({ where, select }: { where: Record<string, unknown>; select?: Record<string, boolean> }) => {
        const tenantId = where.tenantId as string;
        const rows = activeOf(tenantId);
        if (select?.cost || select?.brand) {
          return rows.map((w) => ({
            brand: w.brand,
            cost: w.cost,
            ...(select?.priceMin ? { priceMin: w.priceMin } : {}),
          }));
        }
        return rows;
      }),
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
      findMany: jest.fn(async () => []),
    },
    operatingExpense: {
      aggregate: jest.fn(async () => ({ _sum: { amount: null } })),
      findMany: jest.fn(async () => []),
    },
  };
}

function makeService(watches: FakeWatch[]) {
  const prisma = makePrisma(watches);
  const treasury = {
    getAccountBalances: jest.fn(async () => ({ CASH: '0', BANK: '0', CESAR: '0' })),
  };
  const service = new AnalyticsService(prisma as never, treasury as never);
  return { service, prisma };
}

describe('AnalyticsService — inventory valuation = SUM(cost)', () => {
  const TENANT = 'tenant-a';
  const OTHER = 'tenant-b';

  it('sums acquisition cost across multiple active watches (exact SUM(cost))', async () => {
    const { service, prisma } = makeService([
      {
        id: '1',
        tenantId: TENANT,
        brand: 'Rolex',
        model: 'Sub',
        cost: d(100_000),
        priceMin: d(999_999), // must be ignored
        status: WatchStatus.AVAILABLE,
        deletedAt: null,
      },
      {
        id: '2',
        tenantId: TENANT,
        brand: 'Omega',
        model: 'Speed',
        cost: d(50_000.5),
        priceMin: d(888_888),
        status: WatchStatus.RESERVED,
        deletedAt: null,
      },
      {
        id: '3',
        tenantId: TENANT,
        brand: 'AP',
        model: 'RO',
        cost: d(25_000),
        priceMin: d(777_777),
        status: WatchStatus.IN_TRANSIT,
        deletedAt: null,
      },
    ]);

    const summary = await service.getSummary(TENANT);
    expect(summary.totalInventoryValue).toBe('175000.5');
    expect(summary.totalInventoryCost).toBe('175000.5');
    expect(summary.totalWatches).toBe(3);

    // Aggregate must request cost, not priceMin.
    expect(prisma.watch.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: TENANT,
          deletedAt: null,
          status: { not: WatchStatus.SOLD },
        }),
        _sum: { cost: true },
      }),
    );
  });

  it('groups inventory value by brand as SUM(cost) per brand', async () => {
    const { service } = makeService([
      {
        id: '1',
        tenantId: TENANT,
        brand: 'Rolex',
        model: 'A',
        cost: d(100_000),
        priceMin: d(1),
        status: WatchStatus.AVAILABLE,
        deletedAt: null,
      },
      {
        id: '2',
        tenantId: TENANT,
        brand: 'Rolex',
        model: 'B',
        cost: d(40_000),
        priceMin: d(1),
        status: WatchStatus.RESERVED,
        deletedAt: null,
      },
      {
        id: '3',
        tenantId: TENANT,
        brand: 'Omega',
        model: 'C',
        cost: d(20_000),
        priceMin: d(1),
        status: WatchStatus.AVAILABLE,
        deletedAt: null,
      },
    ]);

    const rows = await service.getInventoryByBrand(TENANT);
    expect(rows).toEqual([
      { brand: 'Rolex', count: 2, inventoryValue: '140000' },
      { brand: 'Omega', count: 1, inventoryValue: '20000' },
    ]);
  });

  it('treats null cost as 0', async () => {
    const { service } = makeService([
      {
        id: '1',
        tenantId: TENANT,
        brand: 'Rolex',
        model: 'Sub',
        cost: null,
        priceMin: d(500_000),
        status: WatchStatus.AVAILABLE,
        deletedAt: null,
      },
      {
        id: '2',
        tenantId: TENANT,
        brand: 'Omega',
        model: 'Speed',
        cost: d(10_000),
        priceMin: d(50_000),
        status: WatchStatus.AVAILABLE,
        deletedAt: null,
      },
    ]);

    const summary = await service.getSummary(TENANT);
    expect(summary.totalInventoryValue).toBe('10000');

    const byBrand = await service.getInventoryByBrand(TENANT);
    const rolex = byBrand.find((r) => r.brand === 'Rolex');
    expect(rolex?.inventoryValue).toBe('0');
    expect(rolex?.count).toBe(1);
  });

  it('excludes SOLD watches from inventory value and brand totals', async () => {
    const { service } = makeService([
      {
        id: '1',
        tenantId: TENANT,
        brand: 'Rolex',
        model: 'Active',
        cost: d(80_000),
        priceMin: d(1),
        status: WatchStatus.AVAILABLE,
        deletedAt: null,
      },
      {
        id: '2',
        tenantId: TENANT,
        brand: 'Rolex',
        model: 'Sold',
        cost: d(200_000),
        priceMin: d(1),
        status: WatchStatus.SOLD,
        deletedAt: null,
      },
    ]);

    const summary = await service.getSummary(TENANT);
    expect(summary.totalInventoryValue).toBe('80000');
    expect(summary.soldWatches).toBe(1);
    expect(summary.totalWatches).toBe(2); // count includes sold; value does not

    const byBrand = await service.getInventoryByBrand(TENANT);
    expect(byBrand).toEqual([{ brand: 'Rolex', count: 1, inventoryValue: '80000' }]);
  });

  it('sums mixed imported and manually-created watches correctly', async () => {
    const { service } = makeService([
      // Imported (partial commercial fields, real cost)
      {
        id: 'imp-1',
        tenantId: TENANT,
        brand: 'Patek',
        model: null,
        cost: d(1_625_641.75),
        priceMin: null,
        status: WatchStatus.AVAILABLE,
        deletedAt: null,
      },
      // Manual create
      {
        id: 'man-1',
        tenantId: TENANT,
        brand: 'Cartier',
        model: 'Santos',
        cost: d(120_000),
        priceMin: d(180_000),
        status: WatchStatus.AVAILABLE,
        deletedAt: null,
      },
    ]);

    const summary = await service.getSummary(TENANT);
    expect(summary.totalInventoryValue).toBe('1745641.75');
    expect(summary.availableWatches).toBe(2);

    const byBrand = await service.getInventoryByBrand(TENANT);
    expect(byBrand.find((r) => r.brand === 'Patek')?.inventoryValue).toBe('1625641.75');
    expect(byBrand.find((r) => r.brand === 'Cartier')?.inventoryValue).toBe('120000');
  });

  it('preserves inventory count logic (total/available unchanged by valuation formula)', async () => {
    const { service } = makeService([
      {
        id: '1',
        tenantId: TENANT,
        brand: 'A',
        model: '1',
        cost: d(1),
        priceMin: d(999),
        status: WatchStatus.AVAILABLE,
        deletedAt: null,
      },
      {
        id: '2',
        tenantId: TENANT,
        brand: 'B',
        model: '2',
        cost: null,
        priceMin: d(999),
        status: WatchStatus.RESERVED,
        deletedAt: null,
      },
      {
        id: '3',
        tenantId: TENANT,
        brand: 'C',
        model: '3',
        cost: d(50),
        priceMin: d(999),
        status: WatchStatus.SOLD,
        deletedAt: null,
      },
    ]);

    const summary = await service.getSummary(TENANT);
    expect(summary.totalWatches).toBe(3);
    expect(summary.availableWatches).toBe(1);
    expect(summary.reservedWatches).toBe(1);
    expect(summary.soldWatches).toBe(1);
    expect(summary.totalInventoryValue).toBe('1'); // only active costs: 1 + 0
  });

  it('is tenant-isolated', async () => {
    const { service } = makeService([
      {
        id: '1',
        tenantId: TENANT,
        brand: 'Rolex',
        model: 'A',
        cost: d(10_000),
        priceMin: d(1),
        status: WatchStatus.AVAILABLE,
        deletedAt: null,
      },
      {
        id: '2',
        tenantId: OTHER,
        brand: 'Rolex',
        model: 'B',
        cost: d(999_999),
        priceMin: d(1),
        status: WatchStatus.AVAILABLE,
        deletedAt: null,
      },
    ]);

    const summary = await service.getSummary(TENANT);
    expect(summary.totalInventoryValue).toBe('10000');

    const byBrand = await service.getInventoryByBrand(TENANT);
    expect(byBrand).toEqual([{ brand: 'Rolex', count: 1, inventoryValue: '10000' }]);
  });
});
