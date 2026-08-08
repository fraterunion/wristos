import {
  AccountEntryStatus,
  AccountEntryType,
  Currency,
  PaymentMethod,
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
    treasury: Map<string, any>;
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
            if (where.registerIdempotencyKey && p.registerIdempotencyKey !== where.registerIdempotencyKey) continue;
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
      },
      treasuryEntry: {
        findFirst: jest.fn(async ({ where }: any) => {
          for (const t of state.treasury.values()) {
            if (where.accountPaymentId && t.accountPaymentId !== where.accountPaymentId) continue;
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

  function openReceivable(amount = 100000) {
    return {
      id: 'ar-1',
      tenantId: 't1',
      type: AccountEntryType.RECEIVABLE,
      status: AccountEntryStatus.OPEN,
      currency: Currency.MXN,
      totalAmount: d(amount),
      source: 'MANUAL',
      dealId: null,
      deletedAt: null,
      counterpartyName: 'José',
      concept: 'Saldo José',
      dueDate: null,
      closedAt: null,
    };
  }

  it('CASH: decreases CXC outstanding and creates Treasury INFLOW once (atomic path)', async () => {
    const state = {
      entries: new Map([['ar-1', openReceivable()]]),
      payments: new Map(),
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
      treasury: new Map(),
    };
    const { service } = build(state);
    await expect(
      service.register('t1', { receivableEntryId: 'ar-1', amount: 0, destination: 'CASH' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.register('t1', { receivableEntryId: 'ar-1', amount: 1000.01, destination: 'CASH' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('OPEN → PARTIAL → PAID via successive payments', async () => {
    const state = {
      entries: new Map([['ar-1', openReceivable(100)]]),
      payments: new Map(),
      treasury: new Map(),
    };
    const { service } = build(state);
    await service.register('t1', { receivableEntryId: 'ar-1', amount: 40, destination: 'CASH' });
    expect(state.entries.get('ar-1')!.status).toBe(AccountEntryStatus.PARTIAL);
    await service.register('t1', { receivableEntryId: 'ar-1', amount: 60, destination: 'BANK' });
    expect(state.entries.get('ar-1')!.status).toBe(AccountEntryStatus.PAID);
  });

  it('same registerIdempotencyKey replays without duplicate Treasury', async () => {
    const state = {
      entries: new Map([['ar-1', openReceivable()]]),
      payments: new Map(),
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

  it('blocks deal-linked receivables', async () => {
    const entry = { ...openReceivable(), source: 'DEAL_AUTO', dealId: 'deal-1' as string | null };
    const state = {
      entries: new Map([['ar-1', entry]]),
      payments: new Map(),
      treasury: new Map(),
    };
    const { service } = build(state);
    await expect(
      service.register('t1', { receivableEntryId: 'ar-1', amount: 10, destination: 'CASH' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
