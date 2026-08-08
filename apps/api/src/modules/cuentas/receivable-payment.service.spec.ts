import {
  AccountEntrySource,
  AccountEntryStatus,
  AccountEntryType,
  Currency,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  TreasuryAccount,
  TreasuryDirection,
} from '@prisma/client';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { ReceivablePaymentService } from './receivable-payment.service';

function d(n: number | string) {
  return new Prisma.Decimal(n);
}

describe('ReceivablePaymentService — canonical received-money registration', () => {
  function build(state: {
    entries: Map<string, any>;
    payments: Map<string, any>;
    dealPayments: Map<string, any>;
    treasury: Map<string, any>;
    deals?: Map<string, any>;
  }) {
    let paySeq = 0;
    let treasSeq = 0;

    const prisma: any = {
      accountEntry: {
        findFirst: jest.fn(async ({ where }: any) => {
          const entry = state.entries.get(where.id);
          if (!entry) return null;
          if (where.tenantId && entry.tenantId !== where.tenantId) return null;
          if (where.deletedAt === null && entry.deletedAt) return null;
          return {
            ...entry,
            payments: [...state.payments.values()].filter(
              (p) => p.entryId === entry.id && !p.deletedAt,
            ),
          };
        }),
        findFirstOrThrow: jest.fn(async ({ where }: any) => {
          const entry = state.entries.get(where.id);
          if (!entry) throw new Error('missing');
          return entry;
        }),
        update: jest.fn(async ({ where, data }: any) => {
          Object.assign(state.entries.get(where.id)!, data);
          return state.entries.get(where.id);
        }),
      },
      accountPayment: {
        findFirst: jest.fn(async ({ where }: any) => {
          for (const p of state.payments.values()) {
            if (
              where.registerIdempotencyKey &&
              p.registerIdempotencyKey !== where.registerIdempotencyKey
            ) {
              continue;
            }
            if (where.id && p.id !== where.id) continue;
            if (where.tenantId && p.tenantId !== where.tenantId) continue;
            if (where.deletedAt === null && p.deletedAt) continue;
            return p;
          }
          return null;
        }),
        findFirstOrThrow: jest.fn(async ({ where }: any) => {
          const p = state.payments.get(where.id);
          if (!p) throw new Error('missing payment');
          return p;
        }),
        create: jest.fn(async ({ data }: any) => {
          paySeq += 1;
          const id = `pay-${paySeq}`;
          const row = {
            id,
            ...data,
            amount: d(data.amount),
            deletedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          state.payments.set(id, row);
          return row;
        }),
      },
      accountSettlement: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async ({ data }: any) => {
          const id = 'settlement-1';
          return { id, ...data, deletedAt: null };
        }),
      },
      payment: {
        aggregate: jest.fn(async ({ where }: any) => {
          let sum = d(0);
          for (const p of state.dealPayments.values()) {
            if (where.tenantId && p.tenantId !== where.tenantId) continue;
            if (where.dealId && p.dealId !== where.dealId) continue;
            if (where.status && p.status !== where.status) continue;
            if (where.deletedAt === null && p.deletedAt) continue;
            sum = sum.plus(p.amount);
          }
          return { _sum: { amount: sum } };
        }),
      },
      treasuryEntry: {
        findFirst: jest.fn(async ({ where }: any) => {
          for (const t of state.treasury.values()) {
            if (where.accountPaymentId && t.accountPaymentId !== where.accountPaymentId)
              continue;
            if (where.deletedAt === null && t.deletedAt) continue;
            return t;
          }
          return null;
        }),
      },
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    };

    const treasuryService = {
      createFromAccountPayment: jest.fn(async (args: any) => {
        treasSeq += 1;
        const id = `tre-${treasSeq}`;
        const row = {
          id,
          tenantId: args.tenantId,
          accountPaymentId: args.accountPaymentId,
          account: args.account,
          direction: args.direction,
          amount: d(args.amount),
          deletedAt: null,
        };
        state.treasury.set(id, row);
        return row;
      }),
    };

    return {
      service: new ReceivablePaymentService(prisma, treasuryService as never),
      prisma,
      treasuryService,
    };
  }

  function openReceivable(amount = 100000, overrides: Record<string, unknown> = {}) {
    return {
      id: 'ar-1',
      tenantId: 't1',
      type: AccountEntryType.RECEIVABLE,
      status: AccountEntryStatus.OPEN,
      currency: Currency.MXN,
      totalAmount: d(amount),
      source: AccountEntrySource.MANUAL,
      dealId: null,
      deletedAt: null,
      counterpartyName: 'José',
      concept: 'Saldo José',
      dueDate: null,
      closedAt: null,
      ...overrides,
    };
  }

  function dealReceivable(amount = 350000) {
    return openReceivable(amount, {
      source: AccountEntrySource.DEAL_AUTO,
      dealId: 'deal-1',
      concept: 'Saldo pendiente — Rolex Batman',
    });
  }

  it('CASH: decreases CXC outstanding and creates Treasury INFLOW once (atomic path)', async () => {
    const state = {
      entries: new Map([['ar-1', openReceivable()]]),
      payments: new Map(),
      dealPayments: new Map(),
      treasury: new Map(),
    };
    const { service, treasuryService } = build(state);
    const result = await service.register('t1', {
      receivableEntryId: 'ar-1',
      amount: 35000,
      destination: 'CASH',
      paymentDate: new Date('2026-08-08T12:00:00Z'),
    });
    expect(result.replayed).toBe(false);
    expect(result.receivablePayment.amount.toFixed(2)).toBe('35000.00');
    expect(result.receivablePayment.cashAccount).toBe(TreasuryAccount.CASH);
    expect(result.receivablePayment.method).toBe(PaymentMethod.CASH);
    expect(result.treasuryEntry?.direction).toBe(TreasuryDirection.INFLOW);
    expect(treasuryService.createFromAccountPayment).toHaveBeenCalledTimes(1);
    expect(state.entries.get('ar-1')!.status).toBe(AccountEntryStatus.PARTIAL);
  });

  it('BANK/CESAR destinations map to treasury accounts without bank commission', async () => {
    for (const destination of ['BANK', 'CESAR'] as const) {
      const state = {
        entries: new Map([['ar-1', openReceivable()]]),
        payments: new Map(),
        dealPayments: new Map(),
        treasury: new Map(),
      };
      const { service, treasuryService } = build(state);
      await service.register('t1', {
        receivableEntryId: 'ar-1',
        amount: 1000,
        destination,
      });
      const args = treasuryService.createFromAccountPayment.mock.calls[0][0];
      expect(args.account).toBe(
        destination === 'BANK' ? TreasuryAccount.BANK : TreasuryAccount.CESAR,
      );
      expect(args.direction).toBe(TreasuryDirection.INFLOW);
      expect(args.commission).toBeUndefined();
    }
  });

  it('rejects overpayment and non-positive amounts', async () => {
    const state = {
      entries: new Map([['ar-1', openReceivable(1000)]]),
      payments: new Map(),
      dealPayments: new Map(),
      treasury: new Map(),
    };
    const { service } = build(state);
    await expect(
      service.register('t1', { receivableEntryId: 'ar-1', amount: 0, destination: 'CASH' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.register('t1', {
        receivableEntryId: 'ar-1',
        amount: 1000.01,
        destination: 'CASH',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('OPEN → PARTIAL → PAID via successive payments', async () => {
    const state = {
      entries: new Map([['ar-1', openReceivable(100)]]),
      payments: new Map(),
      dealPayments: new Map(),
      treasury: new Map(),
    };
    const { service } = build(state);
    await service.register('t1', {
      receivableEntryId: 'ar-1',
      amount: 40,
      destination: 'CASH',
    });
    expect(state.entries.get('ar-1')!.status).toBe(AccountEntryStatus.PARTIAL);
    await service.register('t1', {
      receivableEntryId: 'ar-1',
      amount: 60,
      destination: 'BANK',
    });
    expect(state.entries.get('ar-1')!.status).toBe(AccountEntryStatus.PAID);
  });

  it('same registerIdempotencyKey replays without duplicate Treasury', async () => {
    const state = {
      entries: new Map([['ar-1', openReceivable()]]),
      payments: new Map(),
      dealPayments: new Map(),
      treasury: new Map(),
    };
    const { service, treasuryService } = build(state);
    const first = await service.register('t1', {
      receivableEntryId: 'ar-1',
      amount: 35000,
      destination: 'BANK',
      registerIdempotencyKey: 'ai-action-run:run-1',
    });
    const second = await service.register('t1', {
      receivableEntryId: 'ar-1',
      amount: 35000,
      destination: 'BANK',
      registerIdempotencyKey: 'ai-action-run:run-1',
    });
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.receivablePayment.id).toBe(first.receivablePayment.id);
    expect(treasuryService.createFromAccountPayment).toHaveBeenCalledTimes(1);
    expect(state.payments.size).toBe(1);
  });

  it('same key with conflicting payload throws', async () => {
    const state = {
      entries: new Map([['ar-1', openReceivable()]]),
      payments: new Map(),
      dealPayments: new Map(),
      treasury: new Map(),
    };
    const { service } = build(state);
    await service.register('t1', {
      receivableEntryId: 'ar-1',
      amount: 35000,
      destination: 'CASH',
      registerIdempotencyKey: 'key-1',
    });
    await expect(
      service.register('t1', {
        receivableEntryId: 'ar-1',
        amount: 1000,
        destination: 'CASH',
        registerIdempotencyKey: 'key-1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('DEAL_AUTO: CASH/BANK/CESAR payment reduces CXC using Deal.Payment + AccountPayment', async () => {
    for (const destination of ['CASH', 'BANK', 'CESAR'] as const) {
      const state = {
        entries: new Map([['ar-1', dealReceivable(350000)]]),
        payments: new Map(),
        dealPayments: new Map([
          [
            'dp-1',
            {
              id: 'dp-1',
              tenantId: 't1',
              dealId: 'deal-1',
              amount: d(50000),
              status: PaymentStatus.PAID,
              deletedAt: null,
            },
          ],
        ]),
        treasury: new Map(),
      };
      const { service, treasuryService } = build(state);
      const result = await service.register('t1', {
        receivableEntryId: 'ar-1',
        amount: 100000,
        destination,
        registerIdempotencyKey: `deal-${destination}`,
      });
      expect(result.replayed).toBe(false);
      expect(result.receivablePayment.amount.toFixed(2)).toBe('100000.00');
      expect(treasuryService.createFromAccountPayment).toHaveBeenCalledTimes(1);
      expect(state.entries.get('ar-1')!.status).toBe(AccountEntryStatus.PARTIAL);
      // Overpayment against remaining 200k rejected
      await expect(
        service.register('t1', {
          receivableEntryId: 'ar-1',
          amount: 200000.01,
          destination,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('DEAL_AUTO: final payment closes CXC without creating duplicate entry', async () => {
    const state = {
      entries: new Map([['ar-1', dealReceivable(100000)]]),
      payments: new Map(),
      dealPayments: new Map(),
      treasury: new Map(),
    };
    const { service } = build(state);
    await service.register('t1', {
      receivableEntryId: 'ar-1',
      amount: 100000,
      destination: 'BANK',
    });
    expect(state.entries.get('ar-1')!.status).toBe(AccountEntryStatus.PAID);
    expect(state.entries.size).toBe(1);
  });

  it('DEAL_AUTO: idempotent replay and conflict', async () => {
    const state = {
      entries: new Map([['ar-1', dealReceivable(100000)]]),
      payments: new Map(),
      dealPayments: new Map(),
      treasury: new Map(),
    };
    const { service, treasuryService } = build(state);
    const first = await service.register('t1', {
      receivableEntryId: 'ar-1',
      amount: 25000,
      destination: 'CESAR',
      registerIdempotencyKey: 'ai-action-run:deal-pay',
    });
    const second = await service.register('t1', {
      receivableEntryId: 'ar-1',
      amount: 25000,
      destination: 'CESAR',
      registerIdempotencyKey: 'ai-action-run:deal-pay',
    });
    expect(second.replayed).toBe(true);
    expect(second.receivablePayment.id).toBe(first.receivablePayment.id);
    expect(treasuryService.createFromAccountPayment).toHaveBeenCalledTimes(1);
    await expect(
      service.register('t1', {
        receivableEntryId: 'ar-1',
        amount: 10,
        destination: 'CESAR',
        registerIdempotencyKey: 'ai-action-run:deal-pay',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects CRYPTO and arbitrary destinations', async () => {
    const state = {
      entries: new Map([['ar-1', openReceivable()]]),
      payments: new Map(),
      dealPayments: new Map(),
      treasury: new Map(),
    };
    const { service } = build(state);
    await expect(
      service.register('t1', {
        receivableEntryId: 'ar-1',
        amount: 10,
        destination: 'CRYPTO' as any,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.register('t1', {
        receivableEntryId: 'ar-1',
        amount: 10,
        destination: 'WALLET' as any,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
