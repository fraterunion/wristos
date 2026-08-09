import {
  AccountEntrySource,
  AccountEntryStatus,
  AccountEntryType,
  Currency,
  PaymentMethod,
  Prisma,
  TreasuryAccount,
  TreasuryDirection,
} from '@prisma/client';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { AccountPaymentDestination } from './dto/create-account-payment.dto';
import {
  PayablePaymentService,
  toPayableSourceAccount,
} from './payable-payment.service';

function d(n: number | string) {
  return new Prisma.Decimal(n);
}

describe('PayablePaymentService — canonical CXP cash payment', () => {
  function build(state: {
    entries: Map<string, any>;
    payments: Map<string, any>;
    treasury: Map<string, any>;
    settlements?: Map<string, any>;
  }) {
    let paySeq = 0;
    let treasSeq = 0;
    let txChain: Promise<unknown> = Promise.resolve();

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
            if (where.entryId && p.entryId !== where.entryId) continue;
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
        findMany: jest.fn(async ({ where }: any) => {
          return [...state.payments.values()].filter((p) => {
            if (where.entryId && p.entryId !== where.entryId) return false;
            if (where.tenantId && p.tenantId !== where.tenantId) return false;
            if (where.deletedAt === null && p.deletedAt) return false;
            return true;
          });
        }),
        create: jest.fn(async ({ data }: any) => {
          if (data.registerIdempotencyKey) {
            for (const existing of state.payments.values()) {
              if (
                existing.tenantId === data.tenantId &&
                existing.registerIdempotencyKey === data.registerIdempotencyKey
              ) {
                throw new Prisma.PrismaClientKnownRequestError('Unique constraint', {
                  code: 'P2002',
                  clientVersion: 'test',
                });
              }
            }
          }
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
        update: jest.fn(async ({ where, data }: any) => {
          const row = state.payments.get(where.id);
          Object.assign(row, data);
          return row;
        }),
      },
      accountSettlement: {
        findFirst: jest.fn(async ({ where }: any) => {
          const settlements = state.settlements ?? new Map();
          for (const s of settlements.values()) {
            if (where.tenantId && s.tenantId !== where.tenantId) continue;
            if (where.deletedAt === null && s.deletedAt) continue;
            if (where.OR) {
              const hit = where.OR.some(
                (clause: any) =>
                  (clause.receivablePaymentId &&
                    clause.receivablePaymentId === s.receivablePaymentId) ||
                  (clause.payablePaymentId &&
                    clause.payablePaymentId === s.payablePaymentId),
              );
              if (!hit) continue;
            }
            return s;
          }
          return null;
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
      // Serialize transactions to approximate Serializable outstanding checks under Promise.all.
      $transaction: jest.fn(async (fn: any) => {
        const run = txChain.then(() => fn(prisma));
        txChain = run.then(
          () => undefined,
          () => undefined,
        );
        return run;
      }),
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
          provenanceKey: `account-payment:${args.accountPaymentId}`,
        };
        state.treasury.set(id, row);
        return row;
      }),
      deleteByAccountPaymentId: jest.fn(async (paymentId: string) => {
        for (const t of state.treasury.values()) {
          if (t.accountPaymentId === paymentId && !t.deletedAt) {
            t.deletedAt = new Date();
          }
        }
      }),
    };

    return {
      service: new PayablePaymentService(prisma, treasuryService as never),
      prisma,
      treasuryService,
    };
  }

  function openPayable(amount = 100000, overrides: Record<string, unknown> = {}) {
    return {
      id: 'ap-1',
      tenantId: 't1',
      type: AccountEntryType.PAYABLE,
      status: AccountEntryStatus.OPEN,
      currency: Currency.MXN,
      totalAmount: d(amount),
      source: AccountEntrySource.MANUAL,
      dealId: null,
      deletedAt: null,
      counterpartyName: 'José',
      concept: 'Cuenta Pepe',
      dueDate: null,
      closedAt: null,
      ...overrides,
    };
  }

  function purchaseAutoPayable(amount = 300000) {
    return openPayable(amount, {
      id: 'ap-purchase',
      source: AccountEntrySource.PURCHASE_AUTO,
      concept: 'Compra Rolex Daytona',
      counterpartyName: 'Pepe',
    });
  }

  function paidTotal(state: { payments: Map<string, any> }, entryId: string) {
    return [...state.payments.values()]
      .filter((p) => p.entryId === entryId && !p.deletedAt)
      .reduce((sum, p) => sum.plus(p.amount), d(0));
  }

  it('MANUAL PAYABLE: CASH decreases CXP and creates Treasury OUTFLOW once', async () => {
    const state = {
      entries: new Map([['ap-1', openPayable()]]),
      payments: new Map(),
      treasury: new Map(),
    };
    const { service, treasuryService } = build(state);
    const result = await service.register('t1', {
      payableEntryId: 'ap-1',
      amount: 80000,
      sourceAccount: 'CASH',
      paymentDate: new Date('2026-08-08T12:00:00Z'),
    });
    expect(result.replayed).toBe(false);
    expect(result.payablePayment.amount.toFixed(2)).toBe('80000.00');
    expect(result.payablePayment.cashAccount).toBe(TreasuryAccount.CASH);
    expect(result.payablePayment.method).toBe(PaymentMethod.CASH);
    expect(result.treasuryEntry.direction).toBe(TreasuryDirection.OUTFLOW);
    expect(result.remainingOutstanding.toFixed(2)).toBe('20000.00');
    expect(treasuryService.createFromAccountPayment).toHaveBeenCalledTimes(1);
    expect(state.entries.get('ap-1')!.status).toBe(AccountEntryStatus.PARTIAL);
  });

  it('PURCHASE_AUTO: cash payment does not invent OpEx or alter purchase identity', async () => {
    const state = {
      entries: new Map([['ap-purchase', purchaseAutoPayable()]]),
      payments: new Map(),
      treasury: new Map(),
    };
    const { service, treasuryService } = build(state);
    const result = await service.register('t1', {
      payableEntryId: 'ap-purchase',
      amount: 100000,
      sourceAccount: 'BANK',
    });
    expect(result.payableEntry.source).toBe(AccountEntrySource.PURCHASE_AUTO);
    expect(result.payableEntry.id).toBe('ap-purchase');
    expect(result.treasuryEntry.direction).toBe(TreasuryDirection.OUTFLOW);
    expect(treasuryService.createFromAccountPayment.mock.calls[0][0].account).toBe(
      TreasuryAccount.BANK,
    );
    expect(state.entries.size).toBe(1);
  });

  it.each(['CASH', 'BANK', 'CESAR'] as const)(
    '%s funding source maps to Treasury OUTFLOW without bank fee',
    async (sourceAccount) => {
      const state = {
        entries: new Map([['ap-1', openPayable()]]),
        payments: new Map(),
        treasury: new Map(),
      };
      const { service, treasuryService } = build(state);
      await service.register('t1', {
        payableEntryId: 'ap-1',
        amount: 1000,
        sourceAccount,
      });
      const args = treasuryService.createFromAccountPayment.mock.calls[0][0];
      expect(args.direction).toBe(TreasuryDirection.OUTFLOW);
      expect(args.commission).toBeUndefined();
      expect(args.account).toBe(
        sourceAccount === 'CASH'
          ? TreasuryAccount.CASH
          : sourceAccount === 'BANK'
            ? TreasuryAccount.BANK
            : TreasuryAccount.CESAR,
      );
    },
  );

  it('OPEN → PARTIAL → PAID via successive payments', async () => {
    const state = {
      entries: new Map([['ap-1', openPayable(100)]]),
      payments: new Map(),
      treasury: new Map(),
    };
    const { service } = build(state);
    await service.register('t1', {
      payableEntryId: 'ap-1',
      amount: 40,
      sourceAccount: 'CASH',
    });
    expect(state.entries.get('ap-1')!.status).toBe(AccountEntryStatus.PARTIAL);
    await service.register('t1', {
      payableEntryId: 'ap-1',
      amount: 60,
      sourceAccount: 'BANK',
    });
    expect(state.entries.get('ap-1')!.status).toBe(AccountEntryStatus.PAID);
  });

  it('rejects zero, negative, overpay, fully-paid, deleted, receivable, unsupported source', async () => {
    const state = {
      entries: new Map([
        ['ap-1', openPayable(1000)],
        [
          'ap-paid',
          openPayable(1000, { id: 'ap-paid', status: AccountEntryStatus.PAID }),
        ],
        [
          'ap-del',
          openPayable(1000, { id: 'ap-del', deletedAt: new Date() }),
        ],
        [
          'ar-1',
          openPayable(1000, {
            id: 'ar-1',
            type: AccountEntryType.RECEIVABLE,
          }),
        ],
      ]),
      payments: new Map([
        [
          'existing',
          {
            id: 'existing',
            tenantId: 't1',
            entryId: 'ap-paid',
            amount: d(1000),
            deletedAt: null,
            cashAccount: TreasuryAccount.CASH,
          },
        ],
      ]),
      treasury: new Map(),
    };
    const { service } = build(state);
    await expect(
      service.register('t1', { payableEntryId: 'ap-1', amount: 0, sourceAccount: 'CASH' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.register('t1', { payableEntryId: 'ap-1', amount: -1, sourceAccount: 'CASH' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.register('t1', {
        payableEntryId: 'ap-1',
        amount: 1000.01,
        sourceAccount: 'CASH',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.register('t1', {
        payableEntryId: 'ap-paid',
        amount: 1,
        sourceAccount: 'CASH',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.register('t1', {
        payableEntryId: 'ap-del',
        amount: 1,
        sourceAccount: 'CASH',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.register('t1', {
        payableEntryId: 'ar-1',
        amount: 1,
        sourceAccount: 'CASH',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.register('t1', {
        payableEntryId: 'ap-1',
        amount: 1,
        sourceAccount: 'CRYPTO' as any,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('same registerIdempotencyKey replays without duplicate Treasury', async () => {
    const state = {
      entries: new Map([['ap-1', openPayable()]]),
      payments: new Map(),
      treasury: new Map(),
    };
    const { service, treasuryService } = build(state);
    const first = await service.register('t1', {
      payableEntryId: 'ap-1',
      amount: 35000,
      sourceAccount: 'BANK',
      registerIdempotencyKey: 'ai-action-run:run-1',
    });
    const second = await service.register('t1', {
      payableEntryId: 'ap-1',
      amount: 35000,
      sourceAccount: 'BANK',
      registerIdempotencyKey: 'ai-action-run:run-1',
    });
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.payablePayment.id).toBe(first.payablePayment.id);
    expect(treasuryService.createFromAccountPayment).toHaveBeenCalledTimes(1);
    expect(state.payments.size).toBe(1);
  });

  it('same key with conflicting payload throws 409', async () => {
    const state = {
      entries: new Map([['ap-1', openPayable()]]),
      payments: new Map(),
      treasury: new Map(),
    };
    const { service } = build(state);
    await service.register('t1', {
      payableEntryId: 'ap-1',
      amount: 35000,
      sourceAccount: 'CASH',
      registerIdempotencyKey: 'key-1',
    });
    await expect(
      service.register('t1', {
        payableEntryId: 'ap-1',
        amount: 1000,
        sourceAccount: 'CASH',
        registerIdempotencyKey: 'key-1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('2/3 concurrent same key → one AccountPayment + one Treasury OUTFLOW', async () => {
    for (const n of [2, 3]) {
      const state = {
        entries: new Map([['ap-1', openPayable()]]),
        payments: new Map(),
        treasury: new Map(),
      };
      const { service, treasuryService } = build(state);
      const results = await Promise.all(
        Array.from({ length: n }, () =>
          service.register('t1', {
            payableEntryId: 'ap-1',
            amount: 10000,
            sourceAccount: 'BANK',
            registerIdempotencyKey: `ai-action-run:concurrent-${n}`,
          }),
        ),
      );
      expect(new Set(results.map((r) => r.payablePayment.id)).size).toBe(1);
      expect(treasuryService.createFromAccountPayment).toHaveBeenCalledTimes(1);
      expect(state.payments.size).toBe(1);
      expect(state.treasury.size).toBe(1);
    }
  });

  it('concurrent overpay 70+70 against 100: one succeeds, one rejects, total <= 100', async () => {
    const state = {
      entries: new Map([['ap-1', openPayable(100)]]),
      payments: new Map(),
      treasury: new Map(),
    };
    const { service } = build(state);
    const settled = await Promise.allSettled([
      service.register('t1', {
        payableEntryId: 'ap-1',
        amount: 70,
        sourceAccount: 'CASH',
        registerIdempotencyKey: 'a',
      }),
      service.register('t1', {
        payableEntryId: 'ap-1',
        amount: 70,
        sourceAccount: 'BANK',
        registerIdempotencyKey: 'b',
      }),
    ]);
    const ok = settled.filter((s) => s.status === 'fulfilled');
    const bad = settled.filter((s) => s.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(bad).toHaveLength(1);
    expect(paidTotal(state, 'ap-1').toNumber()).toBeLessThanOrEqual(100);
    expect(paidTotal(state, 'ap-1').toNumber()).toBe(70);
  });

  it('concurrent 40+60 against 100 both succeed', async () => {
    const state = {
      entries: new Map([['ap-1', openPayable(100)]]),
      payments: new Map(),
      treasury: new Map(),
    };
    const { service } = build(state);
    const settled = await Promise.allSettled([
      service.register('t1', {
        payableEntryId: 'ap-1',
        amount: 40,
        sourceAccount: 'CASH',
        registerIdempotencyKey: 'c40',
      }),
      service.register('t1', {
        payableEntryId: 'ap-1',
        amount: 60,
        sourceAccount: 'BANK',
        registerIdempotencyKey: 'c60',
      }),
    ]);
    expect(settled.every((s) => s.status === 'fulfilled')).toBe(true);
    expect(paidTotal(state, 'ap-1').toNumber()).toBe(100);
    expect(state.entries.get('ap-1')!.status).toBe(AccountEntryStatus.PAID);
  });

  it('concurrent 40+40+40 against 100 never exceeds outstanding', async () => {
    const state = {
      entries: new Map([['ap-1', openPayable(100)]]),
      payments: new Map(),
      treasury: new Map(),
    };
    const { service } = build(state);
    const settled = await Promise.allSettled([
      service.register('t1', {
        payableEntryId: 'ap-1',
        amount: 40,
        sourceAccount: 'CASH',
        registerIdempotencyKey: 't1',
      }),
      service.register('t1', {
        payableEntryId: 'ap-1',
        amount: 40,
        sourceAccount: 'BANK',
        registerIdempotencyKey: 't2',
      }),
      service.register('t1', {
        payableEntryId: 'ap-1',
        amount: 40,
        sourceAccount: 'CESAR',
        registerIdempotencyKey: 't3',
      }),
    ]);
    const ok = settled.filter((s) => s.status === 'fulfilled');
    const bad = settled.filter((s) => s.status === 'rejected');
    expect(ok.length).toBe(2);
    expect(bad.length).toBe(1);
    expect(paidTotal(state, 'ap-1').toNumber()).toBe(80);
    expect(paidTotal(state, 'ap-1').toNumber()).toBeLessThanOrEqual(100);
  });

  it('reverse soft-deletes payment + Treasury and restores CXP; second reverse is safe', async () => {
    const state = {
      entries: new Map([['ap-1', openPayable(100)]]),
      payments: new Map(),
      treasury: new Map(),
    };
    const { service, treasuryService } = build(state);
    const created = await service.register('t1', {
      payableEntryId: 'ap-1',
      amount: 40,
      sourceAccount: 'BANK',
    });
    expect(state.entries.get('ap-1')!.status).toBe(AccountEntryStatus.PARTIAL);
    const first = await service.reverse('t1', 'ap-1', created.payablePayment.id);
    expect(first.reversed).toBe(true);
    expect(state.entries.get('ap-1')!.status).toBe(AccountEntryStatus.OPEN);
    expect(treasuryService.deleteByAccountPaymentId).toHaveBeenCalledWith(
      created.payablePayment.id,
      expect.anything(),
    );
    const second = await service.reverse('t1', 'ap-1', created.payablePayment.id);
    expect(second.alreadyReversed).toBe(true);
    expect(paidTotal(state, 'ap-1').toNumber()).toBe(0);
  });

  it('rejects APPLY_TO_PAYABLE mapping and deal-linked entries', async () => {
    expect(() =>
      toPayableSourceAccount(AccountPaymentDestination.APPLY_TO_PAYABLE),
    ).toThrow(BadRequestException);

    const state = {
      entries: new Map([
        [
          'ap-deal',
          openPayable(1000, {
            id: 'ap-deal',
            source: AccountEntrySource.DEAL_AUTO,
            dealId: 'deal-1',
          }),
        ],
      ]),
      payments: new Map(),
      treasury: new Map(),
    };
    const { service } = build(state);
    await expect(
      service.register('t1', {
        payableEntryId: 'ap-deal',
        amount: 10,
        sourceAccount: 'CASH',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
