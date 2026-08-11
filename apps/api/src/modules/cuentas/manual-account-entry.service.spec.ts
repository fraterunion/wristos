import {
  AccountEntrySource,
  AccountEntryStatus,
  AccountEntryType,
  Currency,
  Prisma,
} from '@prisma/client';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { ManualAccountEntryService } from './manual-account-entry.service';
import { PayablePaymentService } from './payable-payment.service';
import { ReceivablePaymentService } from './receivable-payment.service';

function d(n: number | string) {
  return new Prisma.Decimal(n);
}

type EntryRow = Record<string, any>;

function buildPrisma(state: {
  entries: EntryRow[];
  clients: Array<{ id: string; tenantId: string; deletedAt: Date | null }>;
  payments: any[];
  settlements: any[];
  treasury: any[];
}): any {
  const prisma: any = {
    client: {
      findFirst: jest.fn(async ({ where }: any) => {
        return (
          state.clients.find(
            (c) =>
              c.id === where.id &&
              c.tenantId === where.tenantId &&
              (where.deletedAt === null ? c.deletedAt === null : true),
          ) ?? null
        );
      }),
    },
    accountEntry: {
      findFirst: jest.fn(async ({ where, include }: any) => {
        let row = state.entries.find((e) => {
          if (where.id && e.id !== where.id) return false;
          if (where.tenantId && e.tenantId !== where.tenantId) return false;
          if (
            where.registerIdempotencyKey &&
            e.registerIdempotencyKey !== where.registerIdempotencyKey
          ) {
            return false;
          }
          if (where.deletedAt === null && e.deletedAt) return false;
          return true;
        });
        if (!row) return null;
        if (include?.payments) {
          row = {
            ...row,
            payments: state.payments.filter(
              (p) => p.entryId === row!.id && !p.deletedAt,
            ),
            settlementsAsReceivable: state.settlements.filter(
              (s) => s.receivableEntryId === row!.id && !s.deletedAt,
            ),
            settlementsAsPayable: state.settlements.filter(
              (s) => s.payableEntryId === row!.id && !s.deletedAt,
            ),
          };
        }
        return row;
      }),
      findFirstOrThrow: jest.fn(async ({ where }: any) => {
        const row = state.entries.find((e) => {
          if (where.id && e.id !== where.id) return false;
          if (where.tenantId && e.tenantId !== where.tenantId) return false;
          return true;
        });
        if (!row) throw new Error('entry not found');
        return {
          ...row,
          payments: state.payments.filter((p) => p.entryId === row.id && !p.deletedAt),
        };
      }),
      create: jest.fn(async ({ data }: any) => {
        if (data.registerIdempotencyKey) {
          const dup = state.entries.find(
            (e) =>
              e.tenantId === data.tenantId &&
              e.registerIdempotencyKey === data.registerIdempotencyKey,
          );
          if (dup) {
            const err = new Prisma.PrismaClientKnownRequestError('Unique', {
              code: 'P2002',
              clientVersion: 'test',
            });
            throw err;
          }
        }
        const row = {
          id: `ae-${state.entries.length + 1}`,
          deletedAt: null,
          closedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
          totalAmount: d(data.totalAmount),
          exchangeRate:
            data.exchangeRate != null ? d(data.exchangeRate) : null,
        };
        state.entries.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = state.entries.find((e) => e.id === where.id);
        if (!row) throw new Error('missing');
        Object.assign(row, data);
        return row;
      }),
    },
    accountPayment: {
      findFirst: jest.fn(async ({ where }: any) => {
        return (
          state.payments.find((p) => {
            if (where.id && p.id !== where.id) return false;
            if (where.tenantId && p.tenantId !== where.tenantId) return false;
            if (
              where.registerIdempotencyKey &&
              p.registerIdempotencyKey !== where.registerIdempotencyKey
            ) {
              return false;
            }
            if (where.deletedAt === null && p.deletedAt) return false;
            return true;
          }) ?? null
        );
      }),
      findFirstOrThrow: jest.fn(async ({ where }: any) => {
        const row = state.payments.find((p) => {
          if (where.id && p.id !== where.id) return false;
          if (where.tenantId && p.tenantId !== where.tenantId) return false;
          return true;
        });
        if (!row) throw new Error('payment not found');
        return row;
      }),
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(async ({ where }: any) =>
        state.payments.filter((p) => {
          if (where.entryId && p.entryId !== where.entryId) return false;
          if (where.tenantId && p.tenantId !== where.tenantId) return false;
          if (where.deletedAt === null && p.deletedAt) return false;
          return true;
        }),
      ),
    },
    accountSettlement: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    treasuryEntry: {
      findFirst: jest.fn(async ({ where }: any) => {
        return (
          state.treasury.find((t) => {
            if (
              where.accountPaymentId &&
              t.accountPaymentId !== where.accountPaymentId
            ) {
              return false;
            }
            if (where.deletedAt === null && t.deletedAt) return false;
            return true;
          }) ?? null
        );
      }),
    },
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
  };
  return prisma;
}

describe('ManualAccountEntryService (25B)', () => {
  const baseRecv = {
    counterpartyName: 'José',
    concept: 'Préstamo',
    amount: 180000,
    currency: Currency.MXN,
  };

  const basePay = {
    counterpartyName: 'Pepe',
    concept: 'Trabajo relojero',
    amount: 90000,
    currency: Currency.MXN,
  };

  it('creates MANUAL receivable with full outstanding and OPEN status', async () => {
    const state = { entries: [] as EntryRow[], clients: [], payments: [], settlements: [], treasury: [] };
    const service = new ManualAccountEntryService(buildPrisma(state) as never);
    const result = await service.createReceivable('t1', baseRecv);
    expect(result.replayed).toBe(false);
    expect(result.entry.type).toBe(AccountEntryType.RECEIVABLE);
    expect(result.entry.source).toBe(AccountEntrySource.MANUAL);
    expect(result.entry.status).toBe(AccountEntryStatus.OPEN);
    expect(result.entry.totalAmount.eq(180000)).toBe(true);
    expect(result.entry.dealId).toBeNull();
    expect(result.entry.watchId).toBeNull();
    expect(result.entry.expenseId).toBeNull();
    expect(state.treasury).toHaveLength(0);
    expect(state.payments).toHaveLength(0);
  });

  it('creates MANUAL payable with full outstanding', async () => {
    const state = { entries: [] as EntryRow[], clients: [], payments: [], settlements: [], treasury: [] };
    const service = new ManualAccountEntryService(buildPrisma(state) as never);
    const result = await service.createPayable('t1', basePay);
    expect(result.entry.type).toBe(AccountEntryType.PAYABLE);
    expect(result.entry.source).toBe(AccountEntrySource.MANUAL);
    expect(result.entry.totalAmount.eq(90000)).toBe(true);
  });

  it('rejects zero and negative amounts', async () => {
    const state = { entries: [] as EntryRow[], clients: [], payments: [], settlements: [], treasury: [] };
    const service = new ManualAccountEntryService(buildPrisma(state) as never);
    await expect(service.createReceivable('t1', { ...baseRecv, amount: 0 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.createPayable('t1', { ...basePay, amount: -10 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('allows free-text counterparty without clientId', async () => {
    const state = { entries: [] as EntryRow[], clients: [], payments: [], settlements: [], treasury: [] };
    const service = new ManualAccountEntryService(buildPrisma(state) as never);
    const result = await service.createReceivable('t1', {
      ...baseRecv,
      clientId: null,
      counterpartyName: 'Pedro libre',
    });
    expect(result.entry.clientId).toBeNull();
    expect(result.entry.counterpartyName).toBe('Pedro libre');
  });

  it('rejects foreign/deleted client', async () => {
    const state = {
      entries: [] as EntryRow[],
      clients: [{ id: 'c1', tenantId: 't1', deletedAt: new Date() }],
      payments: [],
      settlements: [],
      treasury: [],
    };
    const service = new ManualAccountEntryService(buildPrisma(state) as never);
    await expect(
      service.createReceivable('t1', { ...baseRecv, clientId: 'c1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.createReceivable('t1', { ...baseRecv, clientId: 'missing' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('sets OVERDUE when dueDate is in the past', async () => {
    const state = { entries: [] as EntryRow[], clients: [], payments: [], settlements: [], treasury: [] };
    const service = new ManualAccountEntryService(buildPrisma(state) as never);
    const result = await service.createReceivable('t1', {
      ...baseRecv,
      dueDate: '2020-01-01',
    });
    expect(result.entry.status).toBe(AccountEntryStatus.OVERDUE);
  });

  it('allows null dueDate (OPEN)', async () => {
    const state = { entries: [] as EntryRow[], clients: [], payments: [], settlements: [], treasury: [] };
    const service = new ManualAccountEntryService(buildPrisma(state) as never);
    const result = await service.createReceivable('t1', { ...baseRecv, dueDate: null });
    expect(result.entry.dueDate).toBeNull();
    expect(result.entry.status).toBe(AccountEntryStatus.OPEN);
  });

  it('supports USD currency without inventing FX', async () => {
    const state = { entries: [] as EntryRow[], clients: [], payments: [], settlements: [], treasury: [] };
    const service = new ManualAccountEntryService(buildPrisma(state) as never);
    const result = await service.createPayable('t1', {
      ...basePay,
      currency: Currency.USD,
      amount: 1000,
    });
    expect(result.entry.currency).toBe(Currency.USD);
    expect(result.entry.exchangeRate).toBeNull();
  });

  it('replays same registerIdempotencyKey without duplicate', async () => {
    const state = { entries: [] as EntryRow[], clients: [], payments: [], settlements: [], treasury: [] };
    const service = new ManualAccountEntryService(buildPrisma(state) as never);
    const key = 'ai-action-run:recv-1';
    const first = await service.createReceivable('t1', {
      ...baseRecv,
      registerIdempotencyKey: key,
    });
    const second = await service.createReceivable('t1', {
      ...baseRecv,
      registerIdempotencyKey: key,
      notes: 'ignored on replay',
    });
    expect(second.replayed).toBe(true);
    expect(second.entry.id).toBe(first.entry.id);
    expect(state.entries).toHaveLength(1);
  });

  it('conflicts on same key with different material payload', async () => {
    const state = { entries: [] as EntryRow[], clients: [], payments: [], settlements: [], treasury: [] };
    const service = new ManualAccountEntryService(buildPrisma(state) as never);
    const key = 'ai-action-run:recv-2';
    await service.createReceivable('t1', { ...baseRecv, registerIdempotencyKey: key });
    await expect(
      service.createReceivable('t1', {
        ...baseRecv,
        amount: 999,
        registerIdempotencyKey: key,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('allows duplicate-looking obligations without idempotency key', async () => {
    const state = { entries: [] as EntryRow[], clients: [], payments: [], settlements: [], treasury: [] };
    const service = new ManualAccountEntryService(buildPrisma(state) as never);
    await service.createReceivable('t1', baseRecv);
    await service.createReceivable('t1', baseRecv);
    expect(state.entries).toHaveLength(2);
  });

  it('cancels unpaid MANUAL and fails closed when payments exist', async () => {
    const state = { entries: [] as EntryRow[], clients: [], payments: [] as any[], settlements: [], treasury: [] };
    const service = new ManualAccountEntryService(buildPrisma(state) as never);
    const created = await service.createReceivable('t1', baseRecv);
    const cancelled = await service.cancelUnpaidManual('t1', created.entry.id);
    expect(cancelled.entry.status).toBe(AccountEntryStatus.CANCELLED);
    expect(cancelled.entry.deletedAt).toBeTruthy();

    const paid = await service.createReceivable('t1', {
      ...baseRecv,
      counterpartyName: 'Other',
    });
    state.payments.push({
      id: 'pay1',
      entryId: paid.entry.id,
      deletedAt: null,
      amount: d(10),
    });
    await expect(service.cancelUnpaidManual('t1', paid.entry.id)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('manual receivable is compatible with ReceivablePaymentService (partial)', async () => {
    const state = {
      entries: [] as EntryRow[],
      clients: [],
      payments: [] as any[],
      settlements: [] as any[],
      treasury: [] as any[],
    };
    const prisma = buildPrisma(state);
    // Expand prisma for payment service needs
    let paySeq = 0;
    prisma.accountPayment.create = jest.fn(async ({ data }: any) => {
      const row = {
        id: `ap-${++paySeq}`,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
        amount: d(data.amount),
      };
      state.payments.push(row);
      return row;
    });
    prisma.accountEntry.update = jest.fn(async ({ where, data }: any) => {
      const row = state.entries.find((e) => e.id === where.id)!;
      Object.assign(row, data);
      return row;
    });
    (prisma as any).accountEntry.findFirst = jest.fn(async ({ where }: any) => {
      const row = state.entries.find((e) => {
        if (where.id && e.id !== where.id) return false;
        if (where.tenantId && e.tenantId !== where.tenantId) return false;
        if (where.deletedAt === null && e.deletedAt) return false;
        if (
          where.registerIdempotencyKey &&
          e.registerIdempotencyKey !== where.registerIdempotencyKey
        ) {
          return false;
        }
        return true;
      });
      if (!row) return null;
      return {
        ...row,
        payments: state.payments.filter((p) => p.entryId === row.id && !p.deletedAt),
      };
    });
    (prisma as any).$transaction = jest.fn(async (fn: any) => fn(prisma));

    const treasury = {
      createFromAccountPayment: jest.fn(async (args: any) => {
        const t = { id: `te-${state.treasury.length + 1}`, ...args };
        state.treasury.push(t);
        return t;
      }),
      updateFromAccountPayment: jest.fn(),
      deleteByAccountPaymentId: jest.fn(),
    };

    const manual = new ManualAccountEntryService(prisma as never);
    const created = await manual.createReceivable('t1', baseRecv);
    const payments = new ReceivablePaymentService(prisma as never, treasury as never);
    const paid = await payments.register('t1', {
      receivableEntryId: created.entry.id,
      amount: 35000,
      destination: 'CASH',
      registerIdempotencyKey: 'pay-partial-1',
    });
    expect(paid.replayed).toBe(false);
    expect(state.treasury).toHaveLength(1);
    const remaining = created.entry.totalAmount.minus(35000);
    expect(remaining.eq(145000)).toBe(true);
  });

  it('manual payable is compatible with PayablePaymentService (partial)', async () => {
    const state = {
      entries: [] as EntryRow[],
      clients: [],
      payments: [] as any[],
      settlements: [] as any[],
      treasury: [] as any[],
    };
    const prisma = buildPrisma(state);
    let paySeq = 0;
    prisma.accountPayment.create = jest.fn(async ({ data }: any) => {
      const row = {
        id: `ap-${++paySeq}`,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
        amount: d(data.amount),
      };
      state.payments.push(row);
      return row;
    });
    prisma.accountEntry.update = jest.fn(async ({ where, data }: any) => {
      const row = state.entries.find((e) => e.id === where.id)!;
      Object.assign(row, data);
      return row;
    });
    (prisma as any).accountEntry.findFirst = jest.fn(async ({ where }: any) => {
      const row = state.entries.find((e) => {
        if (where.id && e.id !== where.id) return false;
        if (where.tenantId && e.tenantId !== where.tenantId) return false;
        if (where.deletedAt === null && e.deletedAt) return false;
        return true;
      });
      if (!row) return null;
      return {
        ...row,
        payments: state.payments.filter((p) => p.entryId === row.id && !p.deletedAt),
      };
    });
    (prisma as any).$transaction = jest.fn(async (fn: any) => fn(prisma));
    const treasury = {
      createFromAccountPayment: jest.fn(async (args: any) => {
        const t = { id: `te-${state.treasury.length + 1}`, ...args };
        state.treasury.push(t);
        return t;
      }),
      updateFromAccountPayment: jest.fn(),
      deleteByAccountPaymentId: jest.fn(),
    };

    const manual = new ManualAccountEntryService(prisma as never);
    const created = await manual.createPayable('t1', basePay);
    const payments = new PayablePaymentService(prisma as never, treasury as never);
    await payments.register('t1', {
      payableEntryId: created.entry.id,
      amount: 40000,
      sourceAccount: 'BANK',
      registerIdempotencyKey: 'pay-ap-1',
    });
    expect(state.treasury).toHaveLength(1);
    expect(created.entry.totalAmount.minus(40000).eq(50000)).toBe(true);
  });
});

describe('AI bindings are wired for CREATE_RECEIVABLE / CREATE_PAYABLE', () => {
  it('write registry source lists fourteen bindings including manual-account bindings', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const registry = readFileSync(
      join(__dirname, '../ai/bindings/write-capability-binding-registry.ts'),
      'utf8',
    );
    expect(registry).toContain('this.bindings.size !== 14');
    expect(registry).toMatch(/CreateReceivableWriteBinding/);
    expect(registry).toMatch(/CreatePayableWriteBinding/);
    expect(registry).toContain('CREATE_RECEIVABLE');
    expect(registry).toContain('CREATE_PAYABLE');
  });
});
