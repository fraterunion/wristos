import { DealStage, Prisma } from '@prisma/client';
import { CuentasService } from './cuentas.service';
import { isHistoricalDealSourceTag } from './historical-ar-exclusion';

describe('historical AR exclusion', () => {
  it('recognizes Wrist Caviar and reusable historical source tags', () => {
    expect(isHistoricalDealSourceTag('wrist-caviar-master-workbook-v1')).toBe(true);
    expect(isHistoricalDealSourceTag('HISTORICAL_SALES_IMPORT')).toBe(true);
    expect(isHistoricalDealSourceTag(null)).toBe(false);
    expect(isHistoricalDealSourceTag(undefined)).toBe(false);
    expect(isHistoricalDealSourceTag('storefront')).toBe(false);
  });
});

describe('CuentasService.syncDealReceivable — historical exclusion', () => {
  function makeService(deal: Record<string, unknown> | null) {
    const accountEntry = {
      findFirst: jest.fn(async () => null),
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(async () => []),
    };
    const prisma = {
      deal: {
        findFirst: jest.fn(async () => deal),
      },
      accountEntry,
      payment: {
        groupBy: jest.fn(async () => []),
        aggregate: jest.fn(async () => ({ _sum: { amount: null } })),
      },
    };
    const service = new CuentasService(
      prisma as never,
      { getUsdMxn: jest.fn() } as never,
      {
        createFromAccountPayment: jest.fn(),
        updateFromAccountPayment: jest.fn(),
        deleteByAccountPaymentId: jest.fn(),
      } as never,
      { register: jest.fn() } as never,
    );
    return { service, prisma, accountEntry };
  }

  it('does not create AccountEntry for wrist-caviar-master-workbook-v1', async () => {
    const { service, accountEntry } = makeService({
      id: 'deal-wc',
      tenantId: 't1',
      deletedAt: null,
      stage: DealStage.CLOSED_WON,
      sourceTag: 'wrist-caviar-master-workbook-v1',
      agreedPrice: new Prisma.Decimal(100000),
      clientId: 'c1',
      watchId: null,
      client: { name: 'Hist Client' },
      watch: null,
      updatedAt: new Date(),
      exchangeRate: null,
    });

    await service.syncDealReceivable('deal-wc', 't1');
    expect(accountEntry.create).not.toHaveBeenCalled();
    expect(accountEntry.findFirst).not.toHaveBeenCalled();
  });

  it('does not create AccountEntry for HISTORICAL_SALES_IMPORT', async () => {
    const { service, accountEntry } = makeService({
      id: 'deal-hist',
      tenantId: 't1',
      deletedAt: null,
      stage: DealStage.CLOSED_WON,
      sourceTag: 'HISTORICAL_SALES_IMPORT',
      agreedPrice: new Prisma.Decimal(50000),
      clientId: 'c1',
      watchId: null,
      client: { name: 'Import Client' },
      watch: null,
      updatedAt: new Date(),
      exchangeRate: null,
    });

    await service.syncDealReceivable('deal-hist', 't1');
    expect(accountEntry.create).not.toHaveBeenCalled();
  });

  it('creates DEAL_AUTO AccountEntry for operational deals', async () => {
    const { service, accountEntry } = makeService({
      id: 'deal-op',
      tenantId: 't1',
      deletedAt: null,
      stage: DealStage.CLOSED_WON,
      sourceTag: null,
      agreedPrice: new Prisma.Decimal(250000),
      clientId: 'c1',
      watchId: 'w1',
      client: { name: 'Ops Client' },
      watch: { brand: 'Rolex', model: 'Sub' },
      updatedAt: new Date('2026-08-01T00:00:00.000Z'),
      exchangeRate: null,
    });

    await service.syncDealReceivable('deal-op', 't1');
    expect(accountEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          source: 'DEAL_AUTO',
          type: 'RECEIVABLE',
          category: 'SALE_BALANCE',
        }),
      }),
    );
  });
});
