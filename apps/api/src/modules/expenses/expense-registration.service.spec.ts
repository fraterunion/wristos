import {
  Currency,
  OperatingExpenseCategory,
  Prisma,
  TreasuryAccount,
  TreasuryDirection,
} from '@prisma/client';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { ExpenseRegistrationService } from './expense-registration.service';
import {
  operatingExpenseOutflowProvenanceKey,
  TreasuryService,
} from '../treasury/treasury.service';

function d(n: number | string) {
  return new Prisma.Decimal(n);
}

describe('ExpenseRegistrationService — canonical paid expense', () => {
  function build() {
    const expenses = new Map<string, any>();
    const treasury = new Map<string, any>();
    let expSeq = 0;
    let treasSeq = 0;

    const prisma: any = {
      operatingExpense: {
        findFirst: jest.fn(async ({ where }: any) => {
          for (const e of expenses.values()) {
            if (where.id && e.id !== where.id) continue;
            if (where.tenantId && e.tenantId !== where.tenantId) continue;
            if (
              where.registerIdempotencyKey &&
              e.registerIdempotencyKey !== where.registerIdempotencyKey
            ) {
              continue;
            }
            if (where.deletedAt === null && e.deletedAt) continue;
            return e;
          }
          return null;
        }),
        findFirstOrThrow: jest.fn(async ({ where }: any) => {
          const e = expenses.get(where.id);
          if (!e || (where.tenantId && e.tenantId !== where.tenantId)) {
            throw new Error('missing');
          }
          return e;
        }),
        create: jest.fn(async ({ data }: any) => {
          expSeq += 1;
          const id = `exp-${expSeq}`;
          const row = {
            id,
            ...data,
            amount: d(data.amount),
            deletedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          expenses.set(id, row);
          return row;
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const row = expenses.get(where.id);
          Object.assign(row, data);
          return row;
        }),
        updateMany: jest.fn(async ({ where, data }: any) => {
          let count = 0;
          for (const e of expenses.values()) {
            if (where.id && e.id !== where.id) continue;
            if (where.tenantId && e.tenantId !== where.tenantId) continue;
            if (where.deletedAt === null && e.deletedAt) continue;
            Object.assign(e, data);
            count += 1;
          }
          return { count };
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
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    };

    const treasuryService = {
      createFromOperatingExpense: jest.fn(async (args: any) => {
        const key = operatingExpenseOutflowProvenanceKey(args.operatingExpenseId);
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
          currency: args.currency,
          amountMxn: d(args.amount),
          exchangeRate: null,
          commission: null,
          transactionDate: args.transactionDate,
          description: args.description ?? null,
          provenanceKey: key,
          deletedAt: null,
        };
        treasury.set(id, row);
        return row;
      }),
      softDeleteOperatingExpenseOutflow: jest.fn(async (args: any) => {
        const key = operatingExpenseOutflowProvenanceKey(args.operatingExpenseId);
        for (const t of treasury.values()) {
          if (t.provenanceKey === key && !t.deletedAt) {
            t.deletedAt = new Date();
            if (args.reversalIdempotencyKey) {
              t.reversalIdempotencyKey = args.reversalIdempotencyKey;
            }
            return t;
          }
        }
        return null;
      }),
    } as unknown as TreasuryService;

    const service = new ExpenseRegistrationService(prisma, treasuryService);
    return { service, prisma, treasuryService, expenses, treasury };
  }

  const baseInput = {
    amount: 18000,
    category: OperatingExpenseCategory.OTHER,
    source: 'BANK' as const,
    expenseDate: '2026-08-08',
    notes: 'Renta oficina',
  };

  it('registers CASH expense + Treasury OUTFLOW', async () => {
    const { service, treasuryService } = build();
    const result = await service.register('t1', { ...baseInput, source: 'CASH', amount: 2500 });
    expect(result.replayed).toBe(false);
    expect(result.expense.sourceAccount).toBe(TreasuryAccount.CASH);
    expect(result.treasuryEntry.account).toBe(TreasuryAccount.CASH);
    expect(result.treasuryEntry.direction).toBe(TreasuryDirection.OUTFLOW);
    expect(result.treasuryEntry.commission).toBeNull();
    expect(treasuryService.createFromOperatingExpense).toHaveBeenCalledTimes(1);
  });

  it('registers BANK expense without inventing bank commission', async () => {
    const { service } = build();
    const result = await service.register('t1', baseInput);
    expect(result.treasuryEntry.account).toBe(TreasuryAccount.BANK);
    expect(result.treasuryEntry.commission).toBeNull();
    expect(result.treasuryEntry.amountMxn.toString()).toBe('18000');
  });

  it('registers CESAR expense + Treasury OUTFLOW', async () => {
    const { service } = build();
    const result = await service.register('t1', { ...baseInput, source: 'CESAR', amount: 3200 });
    expect(result.treasuryEntry.account).toBe(TreasuryAccount.CESAR);
  });

  it('rejects BANK_FEES category', async () => {
    const { service } = build();
    await expect(
      service.register('t1', {
        ...baseInput,
        category: OperatingExpenseCategory.BANK_FEES,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects zero / negative amount', async () => {
    const { service } = build();
    await expect(
      service.register('t1', { ...baseInput, amount: 0 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.register('t1', { ...baseInput, amount: -10 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects USD (V1 MXN only)', async () => {
    const { service } = build();
    await expect(
      service.register('t1', { ...baseInput, currency: Currency.USD }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects CRYPTO-like source', async () => {
    const { service } = build();
    await expect(
      service.register('t1', { ...baseInput, source: 'CRYPTO' as any }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('replays same registerIdempotencyKey without duplicate Treasury', async () => {
    const { service, treasuryService } = build();
    const key = 'ai-action-run:run-1';
    const first = await service.register('t1', {
      ...baseInput,
      registerIdempotencyKey: key,
    });
    const second = await service.register('t1', {
      ...baseInput,
      registerIdempotencyKey: key,
    });
    expect(second.replayed).toBe(true);
    expect(second.expense.id).toBe(first.expense.id);
    expect(second.treasuryEntry.id).toBe(first.treasuryEntry.id);
    expect(treasuryService.createFromOperatingExpense).toHaveBeenCalledTimes(1);
  });

  it('rejects conflicting payload on same key', async () => {
    const { service } = build();
    const key = 'manual-key-1';
    await service.register('t1', { ...baseInput, registerIdempotencyKey: key });
    await expect(
      service.register('t1', {
        ...baseInput,
        amount: 19000,
        registerIdempotencyKey: key,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('concurrent same key yields one expense (P2002 race path)', async () => {
    const { service, prisma, expenses, treasury } = build();
    const key = 'race-key';
    let createCalls = 0;
    prisma.operatingExpense.create.mockImplementation(async ({ data }: any) => {
      createCalls += 1;
      if (createCalls === 1) {
        const id = 'exp-race';
        const row = {
          id,
          ...data,
          amount: d(data.amount),
          deletedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        expenses.set(id, row);
        const tId = 'treas-race';
        treasury.set(tId, {
          id: tId,
          tenantId: data.tenantId,
          account: data.sourceAccount,
          direction: TreasuryDirection.OUTFLOW,
          amount: d(data.amount),
          currency: data.currency,
          amountMxn: d(data.amount),
          commission: null,
          provenanceKey: operatingExpenseOutflowProvenanceKey(id),
          deletedAt: null,
        });
        return row;
      }
      const err = new Prisma.PrismaClientKnownRequestError('Unique', {
        code: 'P2002',
        clientVersion: 'test',
      });
      throw err;
    });

    const a = await service.register('t1', {
      ...baseInput,
      registerIdempotencyKey: key,
    });
    const b = await service.register('t1', {
      ...baseInput,
      registerIdempotencyKey: key,
    });
    expect(a.expense.id).toBe(b.expense.id);
    expect(b.replayed).toBe(true);
  });

  it('reverse soft-deletes expense and Treasury OUTFLOW', async () => {
    const { service, treasuryService } = build();
    const created = await service.register('t1', baseInput);
    const reversed = await service.reverse('t1', created.expense.id);
    expect(reversed.alreadyReversed).toBe(false);
    expect(reversed.causality).toBe('APPLIED');
    expect(reversed.expense.deletedAt).toBeTruthy();
    expect(treasuryService.softDeleteOperatingExpenseOutflow).toHaveBeenCalledWith(
      expect.objectContaining({ operatingExpenseId: created.expense.id }),
    );
    const again = await service.reverse('t1', created.expense.id);
    expect(again.alreadyReversed).toBe(true);
    expect(again.causality).toBe('EXTERNAL');
  });

  it('reverse causality: SAME_COMMAND vs EXTERNAL', async () => {
    const { service } = build();
    const created = await service.register('t1', baseInput);
    const key = 'ai-action-run:ar-rev-1';
    const first = await service.reverse('t1', created.expense.id, {
      reversalIdempotencyKey: key,
    });
    expect(first.causality).toBe('APPLIED');
    expect(first.expense.reversalIdempotencyKey).toBe(key);

    const same = await service.reverse('t1', created.expense.id, {
      reversalIdempotencyKey: key,
    });
    expect(same.alreadyReversed).toBe(true);
    expect(same.causality).toBe('SAME_COMMAND');

    const other = await service.reverse('t1', created.expense.id, {
      reversalIdempotencyKey: 'ai-action-run:other',
    });
    expect(other.alreadyReversed).toBe(true);
    expect(other.causality).toBe('EXTERNAL');
  });

  it('legacy expense without Treasury soft-deletes without inventing reversal', async () => {
    const { service, expenses, treasuryService } = build();
    expenses.set('legacy', {
      id: 'legacy',
      tenantId: 't1',
      category: OperatingExpenseCategory.GASOLINE,
      amount: d(2500),
      currency: Currency.MXN,
      sourceAccount: null,
      expenseDate: new Date('2025-06-01T00:00:00.000Z'),
      notes: 'legacy import',
      registerIdempotencyKey: null,
      deletedAt: null,
    });
    const reversed = await service.reverse('t1', 'legacy');
    expect(reversed.expense.deletedAt).toBeTruthy();
    expect(reversed.treasuryEntry).toBeNull();
    expect(treasuryService.softDeleteOperatingExpenseOutflow).toHaveBeenCalled();
    // softDelete helper returns null when no provenance row exists
    expect(
      await treasuryService.softDeleteOperatingExpenseOutflow({
        tenantId: 't1',
        operatingExpenseId: 'legacy',
      }),
    ).toBeNull();
  });

  it('refuses replay when expense exists without Treasury', async () => {
    const { service, expenses } = build();
    expenses.set('orphan', {
      id: 'orphan',
      tenantId: 't1',
      category: OperatingExpenseCategory.OTHER,
      amount: d(100),
      currency: Currency.MXN,
      sourceAccount: TreasuryAccount.CASH,
      expenseDate: new Date('2026-08-08T00:00:00.000Z'),
      notes: null,
      registerIdempotencyKey: 'orphan-key',
      deletedAt: null,
    });
    await expect(
      service.register('t1', {
        ...baseInput,
        amount: 100,
        source: 'CASH',
        registerIdempotencyKey: 'orphan-key',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
