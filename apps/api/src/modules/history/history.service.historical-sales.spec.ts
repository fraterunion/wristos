import { DealStage, PaymentStatus, Prisma, WatchStatus } from '@prisma/client';

import { HistoryService } from './history.service';

/**
 * CRITICAL BUSINESS RULE — historical sales are not inventory.
 * Even when Notes contain the exact serial of an existing inventory watch,
 * the sale must remain watchId = null and must not mutate that inventory watch.
 */

const SHARED_SERIAL = 'SHARED-SERIAL-EXACT-MATCH-001';

describe('HistoryService — historical sales never link to inventory', () => {
  it('keeps watchId null and leaves inventory untouched when Notes serial matches inventory', async () => {
    const inventoryWatch = {
      id: 'inv-watch-1',
      brand: 'Rolex',
      model: 'Daytona',
      reference: '116500LN',
      serialNumber: SHARED_SERIAL,
      status: WatchStatus.AVAILABLE,
      cost: new Prisma.Decimal(50000),
      priceMin: null,
      priceMax: null,
      condition: 'Bueno',
      ownershipType: 'OWNED',
      consignmentOwnerName: null,
      consignmentSplitPercentage: null,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
      deletedAt: null,
      expenses: [],
    };

    const historicalDeal = {
      id: 'deal-hist-1',
      watchId: null as string | null,
      watch: null,
      historicalCost: new Prisma.Decimal(12000),
      agreedPrice: new Prisma.Decimal(25000),
      originalCurrency: 'MXN' as const,
      originalAmount: null,
      exchangeRate: null,
      notes: `brand=Rolex; model=Submariner; ref=16610; serial=${SHARED_SERIAL}; migration=sale_000099`,
      sourceTag: 'wrist-caviar-master-workbook-v1',
      importSessionId: null,
      paymentCount: null,
      soldAt: new Date('2024-06-15'),
      createdAt: new Date('2024-06-15'),
      updatedAt: new Date('2024-06-15'),
      stage: DealStage.CLOSED_WON,
      client: {
        id: 'client-1',
        name: 'Buyer Histórico',
        email: null,
        phone: null,
      },
      payments: [] as Array<{
        id: string;
        amount: Prisma.Decimal;
        method: string;
        status: PaymentStatus;
        paidAt: Date | null;
        notes: string | null;
      }>,
      operatingExpenses: [] as Array<{ amount: Prisma.Decimal }>,
    };

    const watchUpdate = jest.fn();
    const watchFindFirst = jest.fn();
    const watchFindMany = jest.fn(async () => [inventoryWatch]);

    const prisma = {
      deal: {
        findMany: jest.fn(async () => [historicalDeal]),
      },
      watch: {
        update: watchUpdate,
        findFirst: watchFindFirst,
        findMany: watchFindMany,
        count: jest.fn(),
      },
    };

    const service = new HistoryService(prisma as never);
    const sold = await service.getSold('tenant-1');

    expect(sold).toHaveLength(1);
    const row = sold[0]!;

    // Deal remains unlinked — display fields come from Notes snapshot only
    expect(historicalDeal.watchId).toBeNull();
    expect(row.watch.id).toBeNull();
    expect(row.historicalWatchSnapshot).toEqual({
      brand: 'Rolex',
      model: 'Submariner',
      reference: '16610',
      serial: SHARED_SERIAL,
    });
    expect(row.watch.brand).toBe('Rolex');
    expect(row.watch.model).toBe('Submariner');
    expect(row.watch.reference).toBe('16610');
    expect(row.watch.serialNumber).toBe(SHARED_SERIAL);
    expect(row.notes).toContain(`serial=${SHARED_SERIAL}`);
    expect(row.isHistoricalImport).toBe(true);
    expect(row.computedStatus).toBe('HISTORICO');

    // Must never look up or mutate inventory by serial / notes identity
    expect(watchFindFirst).not.toHaveBeenCalled();
    expect(watchUpdate).not.toHaveBeenCalled();
    expect(inventoryWatch.status).toBe(WatchStatus.AVAILABLE);
    expect(inventoryWatch.serialNumber).toBe(SHARED_SERIAL);
  });

  it('does not invent a Watch id in movements when Notes serial matches inventory', async () => {
    const deal = {
      id: 'deal-hist-2',
      watchId: null,
      watch: null,
      agreedPrice: new Prisma.Decimal(1000),
      notes: `brand=Omega; model=Speedmaster; ref=; serial=${SHARED_SERIAL}; migration=sale_000100`,
      sourceTag: 'wrist-caviar-master-workbook-v1',
      importSessionId: null,
      expectedCloseAt: null,
      soldAt: new Date('2023-01-01'),
      createdAt: new Date('2023-01-01'),
      updatedAt: new Date('2023-01-01'),
      stage: DealStage.CLOSED_WON,
      client: { id: 'c1', name: 'C', email: null, phone: null },
    };

    const watchUpdate = jest.fn();
    const prisma = {
      deal: { findMany: jest.fn(async () => [deal]) },
      watch: { update: watchUpdate, findFirst: jest.fn() },
    };

    const service = new HistoryService(prisma as never);
    const movements = await service.getMovements('tenant-1');
    expect(movements[0]!.watch.id).toBeNull();
    expect(movements[0]!.watch.serialNumber).toBe(SHARED_SERIAL);
    expect(movements[0]!.historicalWatchSnapshot?.serial).toBe(SHARED_SERIAL);
    expect(watchUpdate).not.toHaveBeenCalled();
  });
});
