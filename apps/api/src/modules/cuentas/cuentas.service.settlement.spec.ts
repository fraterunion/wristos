import {
  AccountEntryStatus,
  AccountEntryType,
  Currency,
  PaymentMethod,
  Prisma,
  TreasuryAccount,
} from '@prisma/client';
import { NotFoundException } from '@nestjs/common';
import { CuentasService } from './cuentas.service';
import { AccountPaymentDestination } from './dto/create-account-payment.dto';
import { PayablePaymentService } from './payable-payment.service';
import { ReceivablePaymentService } from './receivable-payment.service';

function d(n: number | string) {
  return new Prisma.Decimal(n);
}

type EntryRow = {
  id: string;
  tenantId: string;
  type: AccountEntryType;
  status: AccountEntryStatus;
  currency: Currency;
  totalAmount: Prisma.Decimal;
  source: string;
  dealId: string | null;
  deletedAt: Date | null;
  counterpartyName: string;
  concept: string;
  payments: Array<{ id: string; amount: Prisma.Decimal; deletedAt: Date | null }>;
};

function makeEntry(overrides: Partial<EntryRow> & { id: string; type: AccountEntryType }): EntryRow {
  return {
    tenantId: 't1',
    status: AccountEntryStatus.OPEN,
    currency: Currency.MXN,
    totalAmount: d(500000),
    source: 'MANUAL',
    dealId: null,
    deletedAt: null,
    counterpartyName: overrides.type === AccountEntryType.RECEIVABLE ? 'José' : 'Pepe',
    concept: overrides.type === AccountEntryType.RECEIVABLE ? 'Saldo José' : 'Compra Pepe',
    payments: [],
    ...overrides,
  };
}

describe('CuentasService — account-to-account settlement', () => {
  function buildService(state: {
    entries: Map<string, EntryRow>;
    payments: Map<string, any>;
    settlements: Map<string, any>;
    treasuryCreates: unknown[];
  }) {
    let paymentSeq = 0;
    let settlementSeq = 0;

    const prisma = {
      accountEntry: {
        findFirst: jest.fn(async ({ where }: any) => {
          const entry = state.entries.get(where.id);
          if (!entry) return null;
          if (where.tenantId && entry.tenantId !== where.tenantId) return null;
          if (where.deletedAt === null && entry.deletedAt) return null;
          return {
            ...entry,
            payments: entry.payments.filter((p) => !p.deletedAt),
            closedAt: null,
            category: 'OTHER',
            counterpartyType: 'CLIENT',
            exchangeRate: null,
            reference: null,
            issuedAt: null,
            dueDate: null,
            notes: null,
            clientId: null,
            watchId: null,
            expenseId: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const entry = state.entries.get(where.id)!;
          Object.assign(entry, data);
          return entry;
        }),
        findFirstOrThrow: jest.fn(async ({ where }: any) => {
          const entry = state.entries.get(where.id);
          if (!entry) throw new Error('entry not found');
          return entry;
        }),
        findMany: jest.fn(async () => []),
      },
      treasuryEntry: {
        findFirst: jest.fn(async () => null),
      },
      accountPayment: {
        create: jest.fn(async ({ data }: any) => {
          paymentSeq += 1;
          const id = `pay-${paymentSeq}`;
          const entryId = data.entryId ?? data.entry?.connect?.id;
          const tenantId = data.tenantId ?? data.tenant?.connect?.id ?? 't1';
          const row = {
            id,
            tenantId,
            entryId,
            amount: d(data.amount),
            currency: data.currency,
            method: data.method,
            paidAt: data.paidAt,
            notes: data.notes,
            cashAccount: data.cashAccount,
            exchangeRateUsed: data.exchangeRateUsed,
            registerIdempotencyKey: data.registerIdempotencyKey ?? null,
            deletedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            settlementAsReceivablePayment: null,
            settlementAsPayablePayment: null,
          };
          state.payments.set(id, row);
          const entry = state.entries.get(entryId)!;
          entry.payments.push({ id, amount: row.amount, deletedAt: null });
          return row;
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const row = state.payments.get(where.id)!;
          Object.assign(row, data);
          if (data.deletedAt) {
            const entry = state.entries.get(row.entryId)!;
            const p = entry.payments.find((x) => x.id === row.id);
            if (p) p.deletedAt = data.deletedAt;
          }
          return row;
        }),
        updateMany: jest.fn(async ({ where, data }: any) => {
          const ids: string[] = where.id?.in ?? [];
          for (const id of ids) {
            const row = state.payments.get(id);
            if (!row) continue;
            Object.assign(row, data);
            const entry = state.entries.get(row.entryId)!;
            const p = entry.payments.find((x) => x.id === id);
            if (p && data.deletedAt) p.deletedAt = data.deletedAt;
          }
          return { count: ids.length };
        }),
        findFirst: jest.fn(async ({ where }: any) => {
          if (where.registerIdempotencyKey) {
            for (const row of state.payments.values()) {
              if (row.tenantId !== (where.tenantId ?? row.tenantId)) continue;
              if (row.registerIdempotencyKey !== where.registerIdempotencyKey) continue;
              if (where.deletedAt === null && row.deletedAt) continue;
              return row;
            }
            return null;
          }
          const row = state.payments.get(where.id);
          if (!row || (where.deletedAt === null && row.deletedAt)) return null;
          if (where.entryId && row.entryId !== where.entryId) return null;
          if (where.tenantId && row.tenantId !== where.tenantId) return null;
          return row;
        }),
        findFirstOrThrow: jest.fn(async ({ where }: any) => {
          const row = state.payments.get(where.id);
          if (!row) throw new Error('payment not found');
          return row;
        }),
        aggregate: jest.fn(),
      },
      accountSettlement: {
        findFirst: jest.fn(async ({ where }: any) => {
          for (const s of state.settlements.values()) {
            if (where.id && s.id !== where.id) continue;
            if (where.tenantId && s.tenantId !== where.tenantId) continue;
            if (where.idempotencyKey && s.idempotencyKey !== where.idempotencyKey) continue;
            if (where.deletedAt === null && s.deletedAt) continue;
            if (where.OR) {
              const match = where.OR.some(
                (clause: any) =>
                  clause.receivablePaymentId === s.receivablePaymentId ||
                  clause.payablePaymentId === s.payablePaymentId,
              );
              if (!match) continue;
            }
            const recvEntry = state.entries.get(s.receivableEntryId);
            const payEntry = state.entries.get(s.payableEntryId);
            return {
              ...s,
              receivableEntry: recvEntry,
              payableEntry: payEntry,
              receivablePayment: {
                ...state.payments.get(s.receivablePaymentId),
                settlementAsReceivablePayment: {
                  ...s,
                  payableEntry: {
                    id: s.payableEntryId,
                    counterpartyName: 'Pepe',
                    concept: 'Compra Pepe',
                    type: AccountEntryType.PAYABLE,
                  },
                },
                settlementAsPayablePayment: null,
              },
              payablePayment: {
                ...state.payments.get(s.payablePaymentId),
                settlementAsReceivablePayment: null,
                settlementAsPayablePayment: {
                  ...s,
                  receivableEntry: {
                    id: s.receivableEntryId,
                    counterpartyName: 'José',
                    concept: 'Saldo José',
                    type: AccountEntryType.RECEIVABLE,
                  },
                },
              },
            };
          }
          return null;
        }),
        create: jest.fn(async ({ data }: any) => {
          settlementSeq += 1;
          const id = `stl-${settlementSeq}`;
          const row = { id, deletedAt: null, ...data, amount: d(data.amount) };
          state.settlements.set(id, row);
          return row;
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const row = state.settlements.get(where.id)!;
          Object.assign(row, data);
          return row;
        }),
      },
      payment: {
        groupBy: jest.fn(async () => []),
        aggregate: jest.fn(async () => ({ _sum: { amount: d(0) } })),
      },
      $transaction: jest.fn(async (fn: any) => fn(prisma as any)),
    } as any;

    const treasury = {
      createFromAccountPayment: jest.fn(async (args: unknown) => {
        state.treasuryCreates.push(args);
      }),
      updateFromAccountPayment: jest.fn(),
      deleteByAccountPaymentId: jest.fn(),
    };

    const receivablePayments = new ReceivablePaymentService(prisma as never, treasury as never);
    const payablePayments = new PayablePaymentService(prisma as never, treasury as never);
    const service = new CuentasService(
      prisma as never,
      { getUsdMxn: jest.fn() } as never,
      treasury as never,
      receivablePayments,
      payablePayments,
      { createReceivable: jest.fn(), createPayable: jest.fn(), cancelUnpaidManual: jest.fn() } as never,
    );

    // Patch findEntry to use in-memory compute without full persist complexity
    jest.spyOn(service as any, 'findEntry').mockImplementation(async (...args: unknown[]) => {
      const id = args[0] as string;
      const tenantId = args[1] as string;
      const entry = state.entries.get(id);
      if (!entry || entry.tenantId !== tenantId) throw new NotFoundException('Account entry not found');
      const paid = entry.payments
        .filter((p) => !p.deletedAt)
        .reduce((sum, p) => sum.plus(p.amount), d(0));
      const balance = entry.totalAmount.minus(paid);
      let status: AccountEntryStatus = AccountEntryStatus.OPEN;
      if (paid.greaterThanOrEqualTo(entry.totalAmount)) status = AccountEntryStatus.PAID;
      else if (paid.greaterThan(0)) status = AccountEntryStatus.PARTIAL;
      entry.status = status;
      return {
        id: entry.id,
        type: entry.type,
        status,
        currency: entry.currency,
        totalAmount: entry.totalAmount.toFixed(2),
        paidTotal: paid.toFixed(2),
        balance: balance.toFixed(2),
        counterpartyName: entry.counterpartyName,
        payments: entry.payments
          .filter((p) => !p.deletedAt)
          .map((p) => ({
            id: p.id,
            amount: p.amount.toFixed(2),
            method: PaymentMethod.SETTLEMENT,
          })),
      };
    });

    return { service, prisma, treasury, state };
  }

  type SettlementResult = {
    settlementId: string;
    receivable: { balance: string; status: AccountEntryStatus };
    payable: { balance: string; status: AccountEntryStatus };
    receivablePayment: { method: PaymentMethod };
    payablePayment: { method: PaymentMethod };
  };

  it('settles 100k between 500k receivable and 300k payable without treasury', async () => {
    const receivable = makeEntry({
      id: 'recv-1',
      type: AccountEntryType.RECEIVABLE,
      totalAmount: d(500000),
    });
    const payable = makeEntry({
      id: 'pay-1',
      type: AccountEntryType.PAYABLE,
      totalAmount: d(300000),
    });
    const { service, treasury, state } = buildService({
      entries: new Map([
        [receivable.id, receivable],
        [payable.id, payable],
      ]),
      payments: new Map(),
      settlements: new Map(),
      treasuryCreates: [],
    });

    const result = (await service.createPayment(
      receivable.id,
      't1',
      {
        amount: 100000,
        paidAt: '2026-08-05T00:00:00.000Z',
        destination: AccountPaymentDestination.APPLY_TO_PAYABLE,
        payableEntryId: payable.id,
        notes: 'Pago directo de José a Pepe',
        idempotencyKey: 'key-1',
      },
      'user-1',
    )) as SettlementResult;

    expect(treasury.createFromAccountPayment).not.toHaveBeenCalled();
    expect(state.treasuryCreates).toHaveLength(0);
    expect(result.settlementId).toBeTruthy();
    expect(result.receivable.balance).toBe('400000.00');
    expect(result.payable.balance).toBe('200000.00');
    expect(result.receivable.status).toBe(AccountEntryStatus.PARTIAL);
    expect(result.payable.status).toBe(AccountEntryStatus.PARTIAL);
    expect(result.receivablePayment.method).toBe(PaymentMethod.SETTLEMENT);
    expect(result.payablePayment.method).toBe(PaymentMethod.SETTLEMENT);
  });

  it('rejects different currencies with clear Spanish copy', async () => {
    const receivable = makeEntry({
      id: 'recv-1',
      type: AccountEntryType.RECEIVABLE,
      totalAmount: d(500000),
      currency: Currency.MXN,
    });
    const payable = makeEntry({
      id: 'pay-1',
      type: AccountEntryType.PAYABLE,
      totalAmount: d(300000),
      currency: Currency.USD,
    });
    const { service } = buildService({
      entries: new Map([
        [receivable.id, receivable],
        [payable.id, payable],
      ]),
      payments: new Map(),
      settlements: new Map(),
      treasuryCreates: [],
    });

    await expect(
      service.createPayment(receivable.id, 't1', {
        amount: 100000,
        paidAt: '2026-08-05T00:00:00.000Z',
        destination: AccountPaymentDestination.APPLY_TO_PAYABLE,
        payableEntryId: payable.id,
      }),
    ).rejects.toThrow(/misma moneda/);
  });

  it('blocks cross-tenant payable targets', async () => {
    const receivable = makeEntry({
      id: 'recv-1',
      type: AccountEntryType.RECEIVABLE,
      totalAmount: d(500000),
    });
    const payable = makeEntry({
      id: 'pay-1',
      type: AccountEntryType.PAYABLE,
      totalAmount: d(300000),
      tenantId: 'other-tenant',
    });
    const { service } = buildService({
      entries: new Map([
        [receivable.id, receivable],
        [payable.id, payable],
      ]),
      payments: new Map(),
      settlements: new Map(),
      treasuryCreates: [],
    });

    await expect(
      service.createPayment(receivable.id, 't1', {
        amount: 100000,
        paidAt: '2026-08-05T00:00:00.000Z',
        destination: AccountPaymentDestination.APPLY_TO_PAYABLE,
        payableEntryId: payable.id,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('requires PAYABLE target type', async () => {
    const receivable = makeEntry({
      id: 'recv-1',
      type: AccountEntryType.RECEIVABLE,
      totalAmount: d(500000),
    });
    const otherRecv = makeEntry({
      id: 'recv-2',
      type: AccountEntryType.RECEIVABLE,
      totalAmount: d(300000),
      counterpartyName: 'Other',
    });
    const { service } = buildService({
      entries: new Map([
        [receivable.id, receivable],
        [otherRecv.id, otherRecv],
      ]),
      payments: new Map(),
      settlements: new Map(),
      treasuryCreates: [],
    });

    await expect(
      service.createPayment(receivable.id, 't1', {
        amount: 100000,
        paidAt: '2026-08-05T00:00:00.000Z',
        destination: AccountPaymentDestination.APPLY_TO_PAYABLE,
        payableEntryId: otherRecv.id,
      }),
    ).rejects.toThrow(/PAYABLE/);
  });

  it('blocks amount above receivable or payable outstanding', async () => {
    const receivable = makeEntry({
      id: 'recv-1',
      type: AccountEntryType.RECEIVABLE,
      totalAmount: d(500000),
    });
    const payable = makeEntry({
      id: 'pay-1',
      type: AccountEntryType.PAYABLE,
      totalAmount: d(300000),
    });
    const { service } = buildService({
      entries: new Map([
        [receivable.id, receivable],
        [payable.id, payable],
      ]),
      payments: new Map(),
      settlements: new Map(),
      treasuryCreates: [],
    });

    await expect(
      service.createPayment(receivable.id, 't1', {
        amount: 400000,
        paidAt: '2026-08-05T00:00:00.000Z',
        destination: AccountPaymentDestination.APPLY_TO_PAYABLE,
        payableEntryId: payable.id,
      }),
    ).rejects.toThrow(/cuenta por pagar/);

    await expect(
      service.createPayment(receivable.id, 't1', {
        amount: 550000,
        paidAt: '2026-08-05T00:00:00.000Z',
        destination: AccountPaymentDestination.APPLY_TO_PAYABLE,
        payableEntryId: payable.id,
      }),
    ).rejects.toThrow(/cobro/);
  });

  it('closes one side while leaving the other partial', async () => {
    const receivable = makeEntry({
      id: 'recv-1',
      type: AccountEntryType.RECEIVABLE,
      totalAmount: d(500000),
    });
    const payable = makeEntry({
      id: 'pay-1',
      type: AccountEntryType.PAYABLE,
      totalAmount: d(300000),
    });
    const { service } = buildService({
      entries: new Map([
        [receivable.id, receivable],
        [payable.id, payable],
      ]),
      payments: new Map(),
      settlements: new Map(),
      treasuryCreates: [],
    });

    const result = (await service.createPayment(receivable.id, 't1', {
      amount: 300000,
      paidAt: '2026-08-05T00:00:00.000Z',
      destination: AccountPaymentDestination.APPLY_TO_PAYABLE,
      payableEntryId: payable.id,
    })) as SettlementResult;

    expect(result.payable.status).toBe(AccountEntryStatus.PAID);
    expect(result.payable.balance).toBe('0.00');
    expect(result.receivable.status).toBe(AccountEntryStatus.PARTIAL);
    expect(result.receivable.balance).toBe('200000.00');
  });

  it('idempotent double-submit returns the same settlement', async () => {
    const receivable = makeEntry({
      id: 'recv-1',
      type: AccountEntryType.RECEIVABLE,
      totalAmount: d(500000),
    });
    const payable = makeEntry({
      id: 'pay-1',
      type: AccountEntryType.PAYABLE,
      totalAmount: d(300000),
    });
    const { service, state } = buildService({
      entries: new Map([
        [receivable.id, receivable],
        [payable.id, payable],
      ]),
      payments: new Map(),
      settlements: new Map(),
      treasuryCreates: [],
    });

    const first = (await service.createPayment(receivable.id, 't1', {
      amount: 100000,
      paidAt: '2026-08-05T00:00:00.000Z',
      destination: AccountPaymentDestination.APPLY_TO_PAYABLE,
      payableEntryId: payable.id,
      idempotencyKey: 'dup-key',
    })) as SettlementResult;
    const second = (await service.createPayment(receivable.id, 't1', {
      amount: 100000,
      paidAt: '2026-08-05T00:00:00.000Z',
      destination: AccountPaymentDestination.APPLY_TO_PAYABLE,
      payableEntryId: payable.id,
      idempotencyKey: 'dup-key',
    })) as SettlementResult;

    expect(second.settlementId).toBe(first.settlementId);
    expect(state.payments.size).toBe(2);
    expect(resultBalances(receivable)).toEqual({ paid: '100000', balance: '400000' });
  });

  it('reverses both sides atomically and does not touch treasury delete', async () => {
    const receivable = makeEntry({
      id: 'recv-1',
      type: AccountEntryType.RECEIVABLE,
      totalAmount: d(500000),
    });
    const payable = makeEntry({
      id: 'pay-1',
      type: AccountEntryType.PAYABLE,
      totalAmount: d(300000),
    });
    const { service, treasury } = buildService({
      entries: new Map([
        [receivable.id, receivable],
        [payable.id, payable],
      ]),
      payments: new Map(),
      settlements: new Map(),
      treasuryCreates: [],
    });

    const created = (await service.createPayment(receivable.id, 't1', {
      amount: 100000,
      paidAt: '2026-08-05T00:00:00.000Z',
      destination: AccountPaymentDestination.APPLY_TO_PAYABLE,
      payableEntryId: payable.id,
      idempotencyKey: 'rev-1',
    })) as SettlementResult;

    const reversed = await service.reverseSettlement(created.settlementId, 't1');
    expect(reversed.reversed).toBe(true);
    expect(reversed.receivable.balance).toBe('500000.00');
    expect(reversed.payable.balance).toBe('300000.00');
    expect(reversed.receivable.status).toBe(AccountEntryStatus.OPEN);
    expect(reversed.payable.status).toBe(AccountEntryStatus.OPEN);
    expect(treasury.deleteByAccountPaymentId).not.toHaveBeenCalled();
  });

  it('preserves normal CASH payment treasury behavior', async () => {
    const receivable = makeEntry({
      id: 'recv-1',
      type: AccountEntryType.RECEIVABLE,
      totalAmount: d(500000),
    });
    const { service, treasury } = buildService({
      entries: new Map([[receivable.id, receivable]]),
      payments: new Map(),
      settlements: new Map(),
      treasuryCreates: [],
    });

    await service.createPayment(receivable.id, 't1', {
      amount: 50000,
      paidAt: '2026-08-05T00:00:00.000Z',
      method: PaymentMethod.CASH,
      cashAccount: TreasuryAccount.CASH,
      destination: AccountPaymentDestination.CASH,
    });

    expect(treasury.createFromAccountPayment).toHaveBeenCalledTimes(1);
    expect(treasury.createFromAccountPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        account: TreasuryAccount.CASH,
      }),
    );
  });

  it('blocks settlement against deleted payable', async () => {
    const receivable = makeEntry({
      id: 'recv-1',
      type: AccountEntryType.RECEIVABLE,
      totalAmount: d(500000),
    });
    const payable = makeEntry({
      id: 'pay-1',
      type: AccountEntryType.PAYABLE,
      totalAmount: d(300000),
      deletedAt: new Date(),
    });
    const { service } = buildService({
      entries: new Map([
        [receivable.id, receivable],
        [payable.id, payable],
      ]),
      payments: new Map(),
      settlements: new Map(),
      treasuryCreates: [],
    });

    await expect(
      service.createPayment(receivable.id, 't1', {
        amount: 100000,
        paidAt: '2026-08-05T00:00:00.000Z',
        destination: AccountPaymentDestination.APPLY_TO_PAYABLE,
        payableEntryId: payable.id,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

function resultBalances(entry: EntryRow) {
  const paid = entry.payments
    .filter((p) => !p.deletedAt)
    .reduce((sum, p) => sum.plus(p.amount), d(0));
  return {
    paid: paid.toFixed(0),
    balance: entry.totalAmount.minus(paid).toFixed(0),
  };
}
