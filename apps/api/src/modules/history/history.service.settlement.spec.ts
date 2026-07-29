import { DealStage, PaymentStatus, Prisma } from '@prisma/client';

import { HistoryService } from './history.service';

function baseDeal(overrides: Record<string, unknown> = {}) {
  return {
    id: 'deal-1',
    watchId: 'watch-1',
    watch: {
      id: 'watch-1',
      brand: 'Rolex',
      model: 'Sub',
      reference: null,
      serialNumber: 'S1',
      condition: 'Bueno',
      cost: new Prisma.Decimal(10000),
      priceMin: null,
      priceMax: null,
      status: 'SOLD',
      ownershipType: 'OWNED',
      consignmentOwnerName: null,
      consignmentSplitPercentage: null,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
      deletedAt: null,
      expenses: [],
    },
    historicalCost: null,
    agreedPrice: new Prisma.Decimal(20000),
    originalCurrency: 'MXN' as const,
    originalAmount: null,
    exchangeRate: null,
    notes: null,
    sourceTag: null as string | null,
    importSessionId: null as string | null,
    paymentCount: null,
    soldAt: new Date('2026-06-01'),
    createdAt: new Date('2026-06-01'),
    updatedAt: new Date('2026-06-01'),
    stage: DealStage.CLOSED_WON,
    client: { id: 'c1', name: 'Buyer', email: null, phone: null },
    payments: [] as Array<{
      id: string;
      amount: Prisma.Decimal;
      method: string;
      status: PaymentStatus;
      paidAt: Date | null;
      notes: string | null;
    }>,
    operatingExpenses: [] as Array<{ amount: Prisma.Decimal }>,
    ...overrides,
  };
}

function serviceFor(deals: ReturnType<typeof baseDeal>[]) {
  const prisma = {
    deal: {
      findMany: jest.fn(async () => deals),
      create: jest.fn(),
      update: jest.fn(),
    },
    payment: { create: jest.fn(), update: jest.fn() },
    accountEntry: { create: jest.fn(), update: jest.fn() },
    watch: { create: jest.fn(), update: jest.fn() },
    treasuryEntry: { create: jest.fn() },
  };
  return { service: new HistoryService(prisma as never), prisma };
}

describe('HistoryService — historical settlement display', () => {
  it('1. historical sale with no payments: paid=total, pending=0, HISTORICO', async () => {
    const deal = baseDeal({
      id: 'hist-1',
      watchId: null,
      watch: null,
      historicalCost: new Prisma.Decimal(8000),
      agreedPrice: new Prisma.Decimal(25000),
      sourceTag: 'wrist-caviar-master-workbook-v1',
      notes: 'brand=Rolex; model=Batgirl; ref=; serial=; migration=sale_000001',
      payments: [],
    });
    const { service, prisma } = serviceFor([deal]);
    const [row] = await service.getSold('t1');
    expect(row!.agreedPrice).toBe('25000');
    expect(row!.paidTotal).toBe('25000');
    expect(row!.pendingAmount).toBe('0');
    expect(row!.computedStatus).toBe('HISTORICO');
    expect(row!.isHistoricalImport).toBe(true);
    expect(prisma.payment.create).not.toHaveBeenCalled();
    expect(prisma.deal.update).not.toHaveBeenCalled();
    expect(prisma.accountEntry.create).not.toHaveBeenCalled();
    expect(prisma.watch.create).not.toHaveBeenCalled();
    expect(prisma.watch.update).not.toHaveBeenCalled();
    expect(prisma.treasuryEntry.create).not.toHaveBeenCalled();
  });

  it('2. normal sale with no payments: paid=0, pending=total, PENDIENTE', async () => {
    const { service } = serviceFor([baseDeal({ payments: [] })]);
    const [row] = await service.getSold('t1');
    expect(row!.paidTotal).toBe('0');
    expect(row!.pendingAmount).toBe('20000');
    expect(row!.computedStatus).toBe('PENDIENTE');
    expect(row!.isHistoricalImport).toBe(false);
  });

  it('3. normal sale with partial payment: paid and pending stay operational', async () => {
    const { service } = serviceFor([
      baseDeal({
        payments: [
          {
            id: 'p1',
            amount: new Prisma.Decimal(5000),
            method: 'CASH',
            status: PaymentStatus.PAID,
            paidAt: new Date('2026-06-02'),
            notes: null,
          },
        ],
      }),
    ]);
    const [row] = await service.getSold('t1');
    expect(row!.paidTotal).toBe('5000');
    expect(row!.pendingAmount).toBe('15000');
    expect(row!.computedStatus).toBe('PARCIAL');
  });
});
