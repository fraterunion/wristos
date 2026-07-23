import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  Currency,
  DealStage,
  Prisma,
  ReceivablePaymentMethod,
  ReceivableStatus,
} from '@prisma/client';
import { ReceivablesService } from './receivables.service';

function d(n: number | string): Prisma.Decimal {
  return new Prisma.Decimal(n);
}

type Store = {
  receivables: Array<Record<string, unknown>>;
  payments: Array<Record<string, unknown>>;
  audits: Array<Record<string, unknown>>;
  deals: Array<Record<string, unknown>>;
};

function makePrisma(store: Store) {
  return {
    deal: {
      findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        return (
          store.deals.find(
            (x) =>
              x.id === where.id &&
              x.tenantId === where.tenantId &&
              x.deletedAt == null,
          ) ?? null
        );
      }),
    },
    receivable: {
      findFirst: jest.fn(
        async ({
          where,
          include,
        }: {
          where: Record<string, unknown>;
          include?: Record<string, unknown>;
        }) => {
          const row = store.receivables.find((x) => {
            if (where.id && x.id !== where.id) return false;
            if (where.tenantId && x.tenantId !== where.tenantId) return false;
            if (where.dealId && x.dealId !== where.dealId) return false;
            if (where.deletedAt === null && x.deletedAt != null) return false;
            return true;
          });
          if (!row) return null;
          if (include?.payments) {
            const payments = store.payments.filter(
              (p) =>
                p.receivableId === row.id &&
                p.tenantId === row.tenantId &&
                p.deletedAt == null,
            );
            return { ...row, payments };
          }
          return { ...row };
        },
      ),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `recv-${store.receivables.length + 1}`,
          deletedAt: null,
          writtenOffAt: null,
          writtenOffReason: null,
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
          updatedAt: new Date('2026-07-01T00:00:00.000Z'),
          ...data,
        };
        store.receivables.push(row);
        return row;
      }),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const row = store.receivables.find((x) => x.id === where.id);
          if (!row) throw new Error('missing');
          Object.assign(row, data, { updatedAt: new Date() });
          return { ...row };
        },
      ),
      findMany: jest.fn(async () => []),
    },
    receivablePayment: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `pay-${store.payments.length + 1}`,
          deletedAt: null,
          reversesPaymentId: null,
          createdAt: new Date('2026-07-10T00:00:00.000Z'),
          ...data,
        };
        store.payments.push(row);
        return row;
      }),
      findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        return (
          store.payments.find((p) => {
            if (where.id && p.id !== where.id) return false;
            if (where.tenantId && p.tenantId !== where.tenantId) return false;
            if (where.receivableId && p.receivableId !== where.receivableId) return false;
            if (where.reversesPaymentId && p.reversesPaymentId !== where.reversesPaymentId)
              return false;
            if (where.deletedAt === null && p.deletedAt != null) return false;
            return true;
          }) ?? null
        );
      }),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const row = store.payments.find((x) => x.id === where.id);
          if (!row) throw new Error('missing');
          Object.assign(row, data);
          return { ...row };
        },
      ),
      findMany: jest.fn(async () => []),
    },
    financialAuditEvent: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        store.audits.push(data);
        return { id: `audit-${store.audits.length}`, ...data };
      }),
    },
    payment: {
      create: jest.fn(async () => ({ id: 'deal-pay-1' })),
    },
    client: {
      findFirst: jest.fn(async () => null),
    },
  };
}

function makeService(store: Store) {
  const prisma = makePrisma(store);
  const fxService = {
    getUsdMxn: jest.fn(async () => ({
      pair: 'USD/MXN',
      rate: 20,
      source: 'test',
      fetchedAt: new Date().toISOString(),
    })),
  };
  const service = new ReceivablesService(prisma as never, fxService as never);
  return { service, prisma, fxService };
}

describe('ReceivablesService', () => {
  const TENANT_A = 'tenant-a';
  const TENANT_B = 'tenant-b';

  function seedDeal(store: Store, overrides: Record<string, unknown> = {}) {
    const deal = {
      id: 'deal-1',
      tenantId: TENANT_A,
      clientId: 'client-1',
      stage: DealStage.CLOSED_WON,
      agreedPrice: d(300000),
      originalAmount: d(300000),
      originalCurrency: 'MXN',
      exchangeRate: null,
      soldAt: new Date('2026-06-01T00:00:00.000Z'),
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
      updatedAt: new Date('2026-06-01T00:00:00.000Z'),
      sourceTag: null,
      deletedAt: null,
      ...overrides,
    };
    store.deals.push(deal);
    return deal;
  }

  it('ensureForDeal creates receivable idempotently', async () => {
    const store: Store = { receivables: [], payments: [], audits: [], deals: [] };
    seedDeal(store);
    const { service, prisma } = makeService(store);

    const first = await service.ensureForDeal(TENANT_A, 'deal-1');
    const second = await service.ensureForDeal(TENANT_A, 'deal-1');

    expect(first).toBeTruthy();
    expect(second?.id).toBe(first?.id);
    expect(prisma.receivable.create).toHaveBeenCalledTimes(1);
    expect(first?.normalizedAmount.toString()).toBe('300000');
    expect(first?.currency).toBe(Currency.MXN);
    expect(store.audits[0]?.eventType).toBe('RECEIVABLE_CREATED');
  });

  it('ensureForDeal skips non-won stages', async () => {
    const store: Store = { receivables: [], payments: [], audits: [], deals: [] };
    seedDeal(store, { stage: DealStage.LEAD });
    const { service, prisma } = makeService(store);

    const result = await service.ensureForDeal(TENANT_A, 'deal-1');
    expect(result).toBeNull();
    expect(prisma.receivable.create).not.toHaveBeenCalled();
  });

  it('addPayment creates payment and refreshes status', async () => {
    const store: Store = { receivables: [], payments: [], audits: [], deals: [] };
    const recent = new Date();
    recent.setUTCDate(recent.getUTCDate() - 5);
    seedDeal(store, { soldAt: recent, createdAt: recent, updatedAt: recent });
    const { service } = makeService(store);
    const receivable = await service.ensureForDeal(TENANT_A, 'deal-1');

    const payment = await service.addPayment(
      TENANT_A,
      receivable!.id,
      {
        amount: 100000,
        method: ReceivablePaymentMethod.CASH,
        paymentDate: recent.toISOString(),
        syncDealPayment: false,
      },
      'user-1',
    );

    expect(payment.normalizedAmount).toBe('100000');
    const updated = store.receivables.find((r) => r.id === receivable!.id);
    expect(updated?.status).toBe(ReceivableStatus.PARTIALLY_PAID);
    expect(store.audits.some((a) => a.eventType === 'PAYMENT_CREATED')).toBe(true);
  });

  it('blocks overpayment by default', async () => {
    const store: Store = { receivables: [], payments: [], audits: [], deals: [] };
    seedDeal(store);
    const { service } = makeService(store);
    const receivable = await service.ensureForDeal(TENANT_A, 'deal-1');

    await expect(
      service.addPayment(TENANT_A, receivable!.id, {
        amount: 400000,
        method: ReceivablePaymentMethod.CASH,
        paymentDate: '2026-07-01',
        syncDealPayment: false,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('writeOff sets WRITTEN_OFF and audits', async () => {
    const store: Store = { receivables: [], payments: [], audits: [], deals: [] };
    seedDeal(store);
    const { service } = makeService(store);
    const receivable = await service.ensureForDeal(TENANT_A, 'deal-1');

    const result = await service.writeOff(
      TENANT_A,
      receivable!.id,
      'Uncollectible',
      'user-1',
    );

    expect(result.status).toBe(ReceivableStatus.WRITTEN_OFF);
    expect(store.audits.some((a) => a.eventType === 'RECEIVABLE_WRITTEN_OFF')).toBe(
      true,
    );
  });

  it('enforces tenant isolation on getById', async () => {
    const store: Store = { receivables: [], payments: [], audits: [], deals: [] };
    seedDeal(store);
    const { service } = makeService(store);
    const receivable = await service.ensureForDeal(TENANT_A, 'deal-1');

    await expect(service.getById(TENANT_B, receivable!.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('enforces tenant isolation on addPayment', async () => {
    const store: Store = { receivables: [], payments: [], audits: [], deals: [] };
    seedDeal(store);
    const { service } = makeService(store);
    const receivable = await service.ensureForDeal(TENANT_A, 'deal-1');

    await expect(
      service.addPayment(TENANT_B, receivable!.id, {
        amount: 10,
        method: ReceivablePaymentMethod.CASH,
        paymentDate: '2026-07-01',
        syncDealPayment: false,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
