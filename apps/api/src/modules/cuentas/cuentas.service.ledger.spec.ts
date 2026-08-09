import { AccountEntryType, Prisma } from '@prisma/client';
import { CuentasService } from './cuentas.service';

function d(n: number) {
  return new Prisma.Decimal(n);
}

function baseEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'e1',
    tenantId: 't1',
    type: AccountEntryType.RECEIVABLE,
    status: 'OPEN',
    category: 'OTHER',
    source: 'MANUAL',
    counterpartyName: 'Alice',
    counterpartyType: 'CLIENT',
    concept: 'Saldo venta',
    totalAmount: d(1000),
    currency: 'MXN',
    exchangeRate: null,
    reference: 'REF-1',
    issuedAt: null,
    dueDate: null,
    closedAt: null,
    notes: 'nota importante',
    clientId: 'c1',
    dealId: null,
    watchId: null,
    expenseId: null,
    deletedAt: null,
    createdAt: new Date('2026-01-02T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    payments: [],
    ...overrides,
  };
}

describe('CuentasService — customer ledger + search/pagination', () => {
  it('getCustomerLedger is tenant-scoped and rejects foreign clients', async () => {
    const prisma = {
      client: {
        findFirst: jest.fn(async ({ where }: { where: { tenantId: string } }) => {
          expect(where.tenantId).toBe('t1');
          return null;
        }),
      },
      accountEntry: { findMany: jest.fn() },
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
      { register: jest.fn(), reverse: jest.fn() } as never,
    );

    await expect(service.getCustomerLedger('t1', 'foreign-client')).rejects.toThrow(
      /Customer not found/,
    );
    expect(prisma.accountEntry.findMany).not.toHaveBeenCalled();
  });

  it('getCustomerLedger returns only the tenant customer entries', async () => {
    const entries = [
      baseEntry({ id: 'r1', type: AccountEntryType.RECEIVABLE }),
      baseEntry({
        id: 'p1',
        type: AccountEntryType.PAYABLE,
        concept: 'Compra',
        totalAmount: d(200),
      }),
    ];
    const prisma = {
      client: {
        findFirst: jest.fn(async () => ({
          id: 'c1',
          name: 'Alice',
          email: 'a@x.com',
          phone: null,
        })),
      },
      accountEntry: {
        findMany: jest.fn(async ({ where }: { where: { tenantId: string } }) => {
          expect(where.tenantId).toBe('t1');
          return entries;
        }),
      },
      payment: { groupBy: jest.fn(async () => []) },
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
      { register: jest.fn(), reverse: jest.fn() } as never,
    );

    const ledger = await service.getCustomerLedger('t1', 'c1');
    expect(ledger.customer.id).toBe('c1');
    expect(ledger.receivables).toHaveLength(1);
    expect(ledger.payables).toHaveLength(1);
  });

  it('listEntries supports q search and pagination', async () => {
    const entries = [
      baseEntry({ id: 'e1', counterpartyName: 'Alice', concept: 'Saldo' }),
      baseEntry({
        id: 'e2',
        counterpartyName: 'Bob',
        concept: 'Otro',
        notes: 'sin match',
      }),
      baseEntry({
        id: 'e3',
        counterpartyName: 'Carla',
        concept: 'Alice related',
        notes: null,
      }),
    ];
    const prisma = {
      accountEntry: {
        findMany: jest.fn(async ({ where }: { where: { tenantId: string } }) => {
          expect(where.tenantId).toBe('t1');
          return entries;
        }),
      },
      payment: { groupBy: jest.fn(async () => []) },
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
      { register: jest.fn(), reverse: jest.fn() } as never,
    );

    const searched = (await service.listEntries('t1', {
      q: 'alice',
    })) as Array<{ id: string }>;
    expect(searched.map((r) => r.id).sort()).toEqual(['e1', 'e3']);

    const page = (await service.listEntries('t1', {
      q: 'alice',
      page: 1,
      pageSize: 1,
    })) as { items: Array<{ id: string }>; total: number; page: number };
    expect(page.total).toBe(2);
    expect(page.page).toBe(1);
    expect(page.items).toHaveLength(1);
  });

  it('getSummary includes status counts and expected net flow', async () => {
    const entries = [
      baseEntry({ id: 'e1', status: 'OPEN', totalAmount: d(100) }),
      baseEntry({
        id: 'e2',
        status: 'PARTIAL',
        totalAmount: d(200),
        payments: [
          {
            id: 'pay1',
            tenantId: 't1',
            entryId: 'e2',
            amount: d(50),
            deletedAt: null,
            paidAt: new Date(),
            method: 'TRANSFER',
            currency: 'MXN',
            notes: null,
            cashAccount: null,
            exchangeRateUsed: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      }),
      baseEntry({
        id: 'e3',
        type: AccountEntryType.PAYABLE,
        status: 'OPEN',
        totalAmount: d(40),
      }),
    ];
    const prisma = {
      accountEntry: {
        findMany: jest.fn(async () => entries),
      },
      payment: { groupBy: jest.fn(async () => []) },
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
      { register: jest.fn(), reverse: jest.fn() } as never,
    );

    const summary = await service.getSummary('t1');
    expect(summary.receivableStatusCounts.OPEN).toBe(1);
    expect(summary.receivableStatusCounts.PARTIAL).toBe(1);
    expect(summary.payableStatusCounts.OPEN).toBe(1);
    expect(Number(summary.expectedNetFlow)).toBeCloseTo(210, 0);
  });
});
