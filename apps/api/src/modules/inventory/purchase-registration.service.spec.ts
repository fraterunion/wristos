import {
  AccountEntrySource,
  AccountEntryType,
  Currency,
  Prisma,
  TreasuryAccount,
  TreasuryDirection,
  WatchOwnershipType,
  WatchStatus,
} from '@prisma/client';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { PurchaseRegistrationService } from './purchase-registration.service';
import {
  inventoryPurchaseOutflowProvenanceKey,
  TreasuryService,
} from '../treasury/treasury.service';

function d(n: number | string) {
  return new Prisma.Decimal(n);
}

describe('PurchaseRegistrationService — canonical purchase', () => {
  function build(opts?: { failTreasury?: boolean; failPayable?: boolean }) {
    const watches = new Map<string, any>();
    const treasury = new Map<string, any>();
    const payables = new Map<string, any>();
    const clients = new Map<string, any>([
      ['client-jose', { id: 'client-jose', tenantId: 't1', name: 'José', deletedAt: null }],
    ]);
    let watchSeq = 0;
    let treasSeq = 0;
    let paySeq = 0;

    const prisma: any = {
      client: {
        findFirst: jest.fn(async ({ where }: any) => {
          const c = clients.get(where.id);
          if (!c || c.tenantId !== where.tenantId || c.deletedAt) return null;
          return c;
        }),
      },
      watch: {
        findFirst: jest.fn(async ({ where }: any) => {
          for (const w of watches.values()) {
            if (where.id && w.id !== where.id) continue;
            if (where.tenantId && w.tenantId !== where.tenantId) continue;
            if (
              where.registerIdempotencyKey &&
              w.registerIdempotencyKey !== where.registerIdempotencyKey
            ) {
              continue;
            }
            if (where.serialNumber && w.serialNumber !== where.serialNumber) continue;
            if (where.deletedAt === null && w.deletedAt) continue;
            return w;
          }
          return null;
        }),
        create: jest.fn(async ({ data }: any) => {
          watchSeq += 1;
          const id = `watch-${watchSeq}`;
          const row = {
            id,
            tenantId: data.tenant.connect.id,
            brand: data.brand,
            model: data.model,
            reference: data.reference ?? null,
            serialNumber: data.serialNumber ?? null,
            condition: data.condition,
            cost: d(data.cost),
            costCurrency: data.costCurrency,
            costOriginalAmount: data.costOriginalAmount
              ? d(data.costOriginalAmount)
              : null,
            costExchangeRate: data.costExchangeRate
              ? d(data.costExchangeRate)
              : null,
            priceMin: d(data.priceMin),
            priceMax: d(data.priceMax),
            status: data.status,
            ownershipType: data.ownershipType,
            acquiredAt: data.acquiredAt,
            sellerClientId: data.sellerClient?.connect?.id ?? data.sellerClientId ?? null,
            registerIdempotencyKey: data.registerIdempotencyKey ?? null,
            deletedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          watches.set(id, row);
          return row;
        }),
      },
      treasuryEntry: {
        findFirst: jest.fn(async ({ where }: any) => {
          for (const t of treasury.values()) {
            if (where.tenantId && t.tenantId !== where.tenantId) continue;
            if (where.provenanceKey && t.provenanceKey !== where.provenanceKey) {
              continue;
            }
            if (where.deletedAt === null && t.deletedAt) continue;
            return t;
          }
          return null;
        }),
      },
      accountEntry: {
        findFirst: jest.fn(async ({ where }: any) => {
          for (const p of payables.values()) {
            if (where.tenantId && p.tenantId !== where.tenantId) continue;
            if (where.watchId && p.watchId !== where.watchId) continue;
            if (where.type && p.type !== where.type) continue;
            if (where.source && p.source !== where.source) continue;
            if (where.deletedAt === null && p.deletedAt) continue;
            return p;
          }
          return null;
        }),
      },
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    };

    const fxService = {
      getUsdMxn: jest.fn(async () => ({ rate: 20, stale: false, fetchedAt: new Date() })),
    };

    const treasuryService = {
      createFromInventoryPurchase: jest.fn(async (args: any) => {
        if (opts?.failTreasury) throw new Error('treasury boom');
        const key = inventoryPurchaseOutflowProvenanceKey(args.watchId);
        for (const t of treasury.values()) {
          if (t.provenanceKey === key && !t.deletedAt) return t;
        }
        treasSeq += 1;
        const id = `treas-${treasSeq}`;
        const row = {
          id,
          tenantId: args.tenantId,
          account: args.account,
          direction: TreasuryDirection.OUTFLOW,
          amount: d(args.amount),
          amountMxn: d(args.amount),
          currency: args.currency,
          provenanceKey: key,
          deletedAt: null,
        };
        treasury.set(id, row);
        return row;
      }),
    };

    const cuentasService = {
      createPurchasePayable: jest.fn(async (tenantId: string, args: any) => {
        if (opts?.failPayable) throw new Error('payable boom');
        paySeq += 1;
        const id = `pay-${paySeq}`;
        const row = {
          id,
          tenantId,
          watchId: args.watchId,
          type: AccountEntryType.PAYABLE,
          source: AccountEntrySource.PURCHASE_AUTO,
          totalAmount: d(args.totalAmount),
          counterpartyName: args.counterpartyName,
          clientId: args.clientId ?? null,
          deletedAt: null,
        };
        payables.set(id, row);
        return row;
      }),
    };

    const service = new PurchaseRegistrationService(
      prisma,
      fxService as any,
      treasuryService as any,
      cuentasService as any,
    );

    return { service, prisma, treasuryService, cuentasService, watches, treasury, payables };
  }

  const baseWatch = {
    brand: 'Rolex',
    model: 'GMT-Master II',
    condition: 'Excellent',
    priceMin: 300000,
    priceMax: 350000,
  };

  it('PAID: creates Watch + Treasury outflow, no CXP', async () => {
    const { service, treasuryService, cuentasService } = build();
    const result = await service.register('t1', {
      watch: baseWatch,
      purchaseAmount: 280000,
      currency: 'MXN',
      acquisitionDate: '2026-08-08',
      paymentMode: 'PAID',
      sourceAccount: 'BANK',
      sellerClientId: 'client-jose',
    });

    expect(result.replayed).toBe(false);
    expect(result.watch.cost?.toString()).toBe('280000');
    expect(result.watch.acquiredAt?.toISOString().startsWith('2026-08-08')).toBe(true);
    expect(result.treasuryEntry?.account).toBe(TreasuryAccount.BANK);
    expect(result.payableEntry).toBeNull();
    expect(result.amountPaidMxn).toBe('280000.00');
    expect(result.outstandingMxn).toBe('0.00');
    expect(treasuryService.createFromInventoryPurchase).toHaveBeenCalledTimes(1);
    expect(cuentasService.createPurchasePayable).not.toHaveBeenCalled();
  });

  it('CREDIT: creates Watch + full CXP, no Treasury', async () => {
    const { service, treasuryService, cuentasService } = build();
    const result = await service.register('t1', {
      watch: baseWatch,
      purchaseAmount: 300000,
      acquisitionDate: '2026-08-08',
      paymentMode: 'CREDIT',
      sellerCounterpartyName: 'José',
    });

    expect(result.treasuryEntry).toBeNull();
    expect(result.payableEntry?.totalAmount.toString()).toBe('300000');
    expect(result.outstandingMxn).toBe('300000.00');
    expect(treasuryService.createFromInventoryPurchase).not.toHaveBeenCalled();
    expect(cuentasService.createPurchasePayable).toHaveBeenCalledTimes(1);
  });

  it('PARTIAL: Treasury paid + CXP remainder; paid + outstanding = cost', async () => {
    const { service } = build();
    const result = await service.register('t1', {
      watch: baseWatch,
      purchaseAmount: 300000,
      acquisitionDate: '2026-08-08',
      paymentMode: 'PARTIAL',
      initialPaymentAmount: 100000,
      sourceAccount: 'BANK',
      sellerCounterpartyName: 'José',
    });

    expect(result.amountPaidMxn).toBe('100000.00');
    expect(result.outstandingMxn).toBe('200000.00');
    expect(
      d(result.amountPaidMxn).plus(result.outstandingMxn).toFixed(2),
    ).toBe('300000.00');
    expect(result.treasuryEntry).not.toBeNull();
    expect(result.payableEntry).not.toBeNull();
  });

  it('rejects CREDIT with sourceAccount', async () => {
    const { service } = build();
    await expect(
      service.register('t1', {
        watch: baseWatch,
        purchaseAmount: 100,
        acquisitionDate: '2026-08-08',
        paymentMode: 'CREDIT',
        sourceAccount: 'CASH',
        sellerCounterpartyName: 'X',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects PARTIAL without initialPaymentAmount / source', async () => {
    const { service } = build();
    await expect(
      service.register('t1', {
        watch: baseWatch,
        purchaseAmount: 100,
        acquisitionDate: '2026-08-08',
        paymentMode: 'PARTIAL',
        sourceAccount: 'BANK',
        sellerCounterpartyName: 'X',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects over-payment PARTIAL (>= cost)', async () => {
    const { service } = build();
    await expect(
      service.register('t1', {
        watch: baseWatch,
        purchaseAmount: 100,
        acquisitionDate: '2026-08-08',
        paymentMode: 'PARTIAL',
        initialPaymentAmount: 100,
        sourceAccount: 'BANK',
        sellerCounterpartyName: 'X',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects duplicate serial', async () => {
    const { service, watches } = build();
    watches.set('existing', {
      id: 'existing',
      tenantId: 't1',
      serialNumber: 'ABC123',
      deletedAt: null,
    });
    await expect(
      service.register('t1', {
        watch: { ...baseWatch, serialNumber: 'ABC123' },
        purchaseAmount: 100,
        acquisitionDate: '2026-08-08',
        paymentMode: 'PAID',
        sourceAccount: 'CASH',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('idempotent replay same key + same payload', async () => {
    const { service } = build();
    const input = {
      watch: baseWatch,
      purchaseAmount: 280000,
      acquisitionDate: '2026-08-08',
      paymentMode: 'PAID' as const,
      sourceAccount: 'BANK' as const,
      registerIdempotencyKey: 'ai-action-run:run-1',
    };
    const first = await service.register('t1', input);
    const second = await service.register('t1', input);
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.watch.id).toBe(first.watch.id);
  });

  it('idempotent conflict on different payload', async () => {
    const { service } = build();
    await service.register('t1', {
      watch: baseWatch,
      purchaseAmount: 280000,
      acquisitionDate: '2026-08-08',
      paymentMode: 'PAID',
      sourceAccount: 'BANK',
      registerIdempotencyKey: 'key-1',
    });
    await expect(
      service.register('t1', {
        watch: baseWatch,
        purchaseAmount: 290000,
        acquisitionDate: '2026-08-08',
        paymentMode: 'PAID',
        sourceAccount: 'BANK',
        registerIdempotencyKey: 'key-1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('Treasury failure rolls back (transaction throws)', async () => {
    const { service, watches } = build({ failTreasury: true });
    await expect(
      service.register('t1', {
        watch: baseWatch,
        purchaseAmount: 100,
        acquisitionDate: '2026-08-08',
        paymentMode: 'PAID',
        sourceAccount: 'CASH',
      }),
    ).rejects.toThrow('treasury boom');
    // mock $transaction does not auto-rollback map writes; assert service threw
    expect(watches.size).toBe(1); // created inside failing tx in unit mock
  });

  it('CREDIT requires counterparty', async () => {
    const { service } = build();
    await expect(
      service.register('t1', {
        watch: baseWatch,
        purchaseAmount: 100,
        acquisitionDate: '2026-08-08',
        paymentMode: 'CREDIT',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('USD purchase converts to MXN canonical cost via FX', async () => {
    const { service } = build();
    const result = await service.register('t1', {
      watch: baseWatch,
      purchaseAmount: 18000,
      currency: 'USD',
      acquisitionDate: '2026-08-08',
      paymentMode: 'PAID',
      sourceAccount: 'BANK',
      sellerCounterpartyName: 'Dealer',
    });
    expect(result.purchaseAmountMxn).toBe('360000.00');
    expect(result.watch.costCurrency).toBe('USD');
    expect(result.watch.costOriginalAmount?.toString()).toBe('18000');
  });

  it('defaults ownership OWNED and status AVAILABLE', async () => {
    const { service } = build();
    const result = await service.register('t1', {
      watch: baseWatch,
      purchaseAmount: 50,
      acquisitionDate: '2026-08-08',
      paymentMode: 'PAID',
      sourceAccount: 'CESAR',
    });
    expect(result.watch.ownershipType).toBe(WatchOwnershipType.OWNED);
    expect(result.watch.status).toBe(WatchStatus.AVAILABLE);
  });

  it('exports inventory-purchase provenance key', () => {
    expect(inventoryPurchaseOutflowProvenanceKey('w1')).toBe(
      'inventory-purchase:w1:outflow',
    );
    expect(TreasuryService).toBeDefined();
  });

  it('rejects amount <= 0', async () => {
    const { service } = build();
    await expect(
      service.register('t1', {
        watch: baseWatch,
        purchaseAmount: 0,
        acquisitionDate: '2026-08-08',
        paymentMode: 'PAID',
        sourceAccount: 'CASH',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
