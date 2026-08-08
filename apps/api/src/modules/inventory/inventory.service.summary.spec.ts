import { Prisma, WatchStatus } from '@prisma/client';
import { InventoryService } from './inventory.service';

describe('InventoryService.getSummary', () => {
  function makeService(opts: {
    count: number;
    costSum: Prisma.Decimal | null;
    assertWhere?: (where: Prisma.WatchWhereInput) => void;
  }) {
    const prisma = {
      watch: {
        count: jest.fn(async ({ where }: { where: Prisma.WatchWhereInput }) => {
          opts.assertWhere?.(where);
          return opts.count;
        }),
        aggregate: jest.fn(async ({ where }: { where: Prisma.WatchWhereInput }) => {
          opts.assertWhere?.(where);
          return { _sum: { cost: opts.costSum } };
        }),
      },
    };
    const service = new InventoryService(
      prisma as never,
      { get: jest.fn() } as never,
      { getUsdMxn: jest.fn() } as never,
      {
        getCanonicalPurchaseMarkers: jest.fn(),
        reverse: jest.fn(),
      } as never,
    );
    return { service, prisma };
  }

  it('returns Wrist Caviar expected active inventory totals', async () => {
    const { service, prisma } = makeService({
      count: 40,
      costSum: new Prisma.Decimal(18261520),
    });

    const summary = await service.getSummary('tenant-wc');

    expect(summary).toEqual({
      totalInventoryValue: '18261520.00',
      activeItemCount: 40,
      averageCost: '456538.00',
    });
    expect(prisma.watch.count).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-wc',
        deletedAt: null,
        status: { not: WatchStatus.SOLD },
      },
    });
  });

  it('excludes SOLD and soft-deleted watches via where clause', async () => {
    const wheres: Prisma.WatchWhereInput[] = [];
    const { service } = makeService({
      count: 40,
      costSum: new Prisma.Decimal(18261520),
      assertWhere: (where) => wheres.push(where),
    });

    await service.getSummary('tenant-wc');

    expect(wheres).toHaveLength(2);
    for (const where of wheres) {
      expect(where.deletedAt).toBeNull();
      expect(where.status).toEqual({ not: WatchStatus.SOLD });
      expect(where.tenantId).toBe('tenant-wc');
    }
  });

  it('is tenant scoped', async () => {
    const { service, prisma } = makeService({
      count: 1,
      costSum: new Prisma.Decimal(1000),
    });

    await service.getSummary('tenant-b');

    expect(prisma.watch.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: 'tenant-b' }),
      }),
    );
    expect(prisma.watch.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: 'tenant-b' }),
      }),
    );
  });

  it('returns zero average when there are no active items', async () => {
    const { service } = makeService({
      count: 0,
      costSum: null,
    });

    const summary = await service.getSummary('tenant-empty');
    expect(summary).toEqual({
      totalInventoryValue: '0.00',
      activeItemCount: 0,
      averageCost: '0.00',
    });
  });
});
