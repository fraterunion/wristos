import { Prisma } from '@prisma/client';
import { OperationalIntelligenceService } from './operational-intelligence.service';
import { ATTENTION_POLICY } from './attention-policy';

const d = (n: string | number) => new Prisma.Decimal(n);

describe('OperationalIntelligenceService', () => {
  const now = new Date('2026-08-07T12:00:00.000Z');

  function makeService(prisma: any, cuentas: any = {}) {
    return new OperationalIntelligenceService(prisma, cuentas);
  }

  it('ranks inventory aging DESC and excludes SOLD/deleted', async () => {
    const prisma = {
      watch: {
        findMany: jest.fn(async () => [
          { id: 'w-old', brand: 'Rolex', model: 'Sub', reference: 'R1', cost: d(285000), status: 'AVAILABLE', createdAt: new Date('2026-01-01T00:00:00Z') },
          { id: 'w-new', brand: 'AP', model: 'Royal', reference: 'A1', cost: d(100000), status: 'AVAILABLE', createdAt: new Date('2026-07-01T00:00:00Z') },
          { id: 'w-tie', brand: 'Rolex', model: 'Daytona', reference: 'R2', cost: d(400000), status: 'RESERVED', createdAt: new Date('2026-01-01T00:00:00Z') },
        ]),
      },
    };
    const svc = makeService(prisma);
    const result = await svc.getInventoryAging('t1', { now });
    expect(prisma.watch.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tenantId: 't1', deletedAt: null, status: { not: 'SOLD' } }),
    }));
    expect(result.ageSource).toBe('Watch.createdAt');
    expect(result.items[0].watchId).toBe('w-tie'); // same age, higher cost
    expect(result.items[1].watchId).toBe('w-old');
    expect(result.items.map((i) => i.watchId)).not.toContain('sold');
    expect(result.items[0].ageDays).toBeGreaterThan(result.items[2].ageDays);
  });

  it('filters by minAgeDays threshold', async () => {
    const prisma = {
      watch: {
        findMany: jest.fn(async () => [
          { id: 'w1', brand: 'A', model: '1', reference: null, cost: d(10), status: 'AVAILABLE', createdAt: new Date('2026-08-01T00:00:00Z') },
          { id: 'w2', brand: 'B', model: '2', reference: null, cost: d(10), status: 'AVAILABLE', createdAt: new Date('2025-01-01T00:00:00Z') },
        ]),
      },
    };
    const result = await makeService(prisma).getInventoryAging('t1', { minAgeDays: 120, now });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].watchId).toBe('w2');
  });

  it('ranks inventory capital and computes percent Decimal-safe', async () => {
    const prisma = {
      watch: {
        findMany: jest.fn(async () => [
          { id: 'a', brand: 'A', model: '1', reference: null, cost: d(75), status: 'AVAILABLE', createdAt: now },
          { id: 'b', brand: 'B', model: '2', reference: null, cost: d(25), status: 'AVAILABLE', createdAt: now },
        ]),
      },
    };
    const result = await makeService(prisma).getTopInventoryCapital('t1', { now });
    expect(result.totalInventoryCapital).toBe('100.00');
    expect(result.items[0]).toEqual(expect.objectContaining({ watchId: 'a', percentOfInventoryCapital: '75.00' }));
  });

  it('keeps top debtors currency-separated via CuentasService', async () => {
    const cuentas = {
      getTopDebtors: jest.fn(async () => [
        { clientId: 'c1', counterpartyName: 'José', currency: 'MXN', outstanding: '500000.00', openAccounts: 2 },
        { clientId: 'c2', counterpartyName: 'Ana', currency: 'USD', outstanding: '10000.00', openAccounts: 1 },
        { clientId: 'c3', counterpartyName: 'Pepe', currency: 'MXN', outstanding: '100000.00', openAccounts: 1 },
      ]),
    };
    const result = await makeService({}, cuentas).getTopDebtors('t1', { limit: 10 });
    expect(result.currencies.MXN[0].clientLabel).toBe('José');
    expect(result.currencies.USD[0].outstanding).toBe('10000.00');
    expect(result.totals.MXN).toBe('600000.00');
  });

  it('computes receivable summary from AccountEntry without Receivable model', async () => {
    const prisma = {
      accountEntry: {
        findMany: jest.fn(async () => [
          {
            currency: 'MXN',
            totalAmount: d(1000),
            status: 'OPEN',
            dealId: null,
            deal: null,
            payments: [],
          },
          {
            currency: 'MXN',
            totalAmount: d(500),
            status: 'PARTIAL',
            dealId: 'd1',
            deal: { id: 'd1', payments: [{ amount: d(200) }] },
            payments: [],
          },
        ]),
      },
    };
    const result = await makeService(prisma).getReceivableSummary('t1');
    expect(result.source).toBe('AccountEntry+AccountPayment');
    expect(result.agingIncluded).toBe(false);
    expect(result.currencies.MXN.outstanding).toBe('1300.00');
    expect(result.currencies.MXN.activeAccountCount).toBe(2);
  });

  it('computes gross margin excluding commissions/opex', async () => {
    const prisma = {
      deal: {
        findMany: jest.fn(async () => [
          {
            id: 'd1',
            agreedPrice: d(100),
            historicalCost: null,
            soldAt: new Date('2026-08-02T00:00:00Z'),
            updatedAt: now,
            createdAt: now,
            watch: { brand: 'Rolex', cost: d(60), expenses: [{ amount: d(10) }] },
          },
        ]),
      },
    };
    const result = await makeService(prisma).getSalesMarginSummary('t1', {
      period: 'CUSTOM',
      year: 2026,
      month: 8,
      now,
    });
    expect(result.revenue).toBe('100.00');
    expect(result.cogs).toBe('70.00');
    expect(result.grossProfit).toBe('30.00');
    expect(result.grossMarginPercent).toBe('30.00');
    expect(result.definition).toMatch(/Excludes bank commissions/);
  });

  it('aggregates profit by brand with stable ranking', async () => {
    const prisma = {
      deal: {
        findMany: jest.fn(async () => [
          { agreedPrice: d(100), historicalCost: null, watch: { brand: 'Rolex', cost: d(40), expenses: [] } },
          { agreedPrice: d(80), historicalCost: null, watch: { brand: 'AP', cost: d(50), expenses: [] } },
          { agreedPrice: d(50), historicalCost: null, watch: { brand: 'Rolex', cost: d(20), expenses: [] } },
        ]),
      },
    };
    const result = await makeService(prisma).getProfitByBrand('t1', { period: 'ALL', now });
    expect(result.items[0].brand).toBe('Rolex');
    expect(result.items[0].grossProfit).toBe('90.00');
    expect(result.items[0].unitsSold).toBe(2);
  });

  it('ranks top sales by gross profit by default', async () => {
    const prisma = {
      deal: {
        findMany: jest.fn(async () => [
          {
            id: 'd-low',
            agreedPrice: d(100),
            historicalCost: null,
            soldAt: now,
            updatedAt: now,
            createdAt: now,
            client: { name: 'Secret' },
            watch: { brand: 'A', model: '1', reference: null, cost: d(90), expenses: [] },
          },
          {
            id: 'd-high',
            agreedPrice: d(100),
            historicalCost: null,
            soldAt: now,
            updatedAt: now,
            createdAt: now,
            client: { name: 'Secret' },
            watch: { brand: 'B', model: '2', reference: null, cost: d(10), expenses: [] },
          },
        ]),
      },
    };
    const result = await makeService(prisma).getTopSales('t1', { period: 'ALL', now });
    expect(result.items[0].dealId).toBe('d-high');
    expect(result.items[0].customerLabel).toBeNull();
    expect(result.items[0].grossProfit).toBe('90.00');
  });

  it('emits deterministic attention items with evidence and no mutation hooks', async () => {
    const prisma = {
      watch: {
        findMany: jest.fn(async () => [
          {
            id: 'w-heavy',
            brand: 'Rolex',
            model: 'Batman',
            reference: 'R1',
            cost: d(ATTENTION_POLICY.HIGH_VALUE_INVENTORY_MXN),
            status: 'AVAILABLE',
            createdAt: new Date(now.getTime() - (ATTENTION_POLICY.AGED_INVENTORY_DAYS + 10) * 86400000),
          },
        ]),
      },
      accountEntry: { findMany: jest.fn(async () => []) },
      assetPriceSnapshot: { findMany: jest.fn(async () => []) },
      assetHolding: { count: jest.fn(async () => 0) },
      deal: { findMany: jest.fn(async () => []) },
    };
    const cuentas = {
      getTopDebtors: jest.fn(async () => [
        {
          clientId: 'c1',
          counterpartyName: 'José',
          currency: 'MXN',
          outstanding: String(ATTENTION_POLICY.LARGE_RECEIVABLE_MXN),
          openAccounts: 1,
        },
      ]),
    };
    const result = await makeService(prisma, cuentas).getAttentionItems('t1', { now });
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.every((i) => ['INFO', 'WATCH', 'IMPORTANT'].includes(i.severity))).toBe(true);
    expect(result.items.some((i) => i.type === 'AGED_HIGH_VALUE_INVENTORY' || i.type === 'LARGE_RECEIVABLE' || i.type === 'INVENTORY_CONCENTRATION')).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/Debes vender|vende ya|automatically sell/i);
  });

  it('isolates tenantId in every query path sampled', async () => {
    const prisma = {
      watch: { findMany: jest.fn(async () => []) },
      accountEntry: { findMany: jest.fn(async () => []) },
      deal: { findMany: jest.fn(async () => []) },
      assetPriceSnapshot: { findMany: jest.fn(async () => []) },
      assetHolding: { count: jest.fn(async () => 0) },
    };
    const cuentas = { getTopDebtors: jest.fn(async () => []) };
    const svc = makeService(prisma, cuentas);
    await svc.getInventoryAging('tenant-A', { now });
    await svc.getReceivableSummary('tenant-A');
    await svc.getSalesMarginSummary('tenant-A', { period: 'ALL', now });
    await svc.getTopDebtors('tenant-A');
    expect(prisma.watch.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: 'tenant-A' }) }));
    expect(prisma.accountEntry.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: 'tenant-A' }) }));
    expect(prisma.deal.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: 'tenant-A' }) }));
    expect(cuentas.getTopDebtors).toHaveBeenCalledWith('tenant-A', expect.any(Number));
  });
});
