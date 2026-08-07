import { Prisma, DealStage } from '@prisma/client';
import { OperationalIntelligenceService } from './operational-intelligence.service';
import {
  ATTENTION_CATEGORIES,
  ATTENTION_POLICY,
  ATTENTION_RULE_CATEGORY,
} from './attention-policy';

const d = (n: string | number) => new Prisma.Decimal(n);

describe('OperationalIntelligenceService', () => {
  const now = new Date('2026-08-07T12:00:00.000Z');

  function makeService(
    prisma: any,
    cuentas: any = {},
    analytics: any = {
      getLiquidity: jest.fn(async () => ({
        cashMxn: '1.00',
        bankMxn: '2.00',
        cryptoMxn: '0.00',
        cesarMxn: '0.00',
        totalLiquidityMxn: '3.00',
        warnings: [],
      })),
      getMonthlyProfit: jest.fn(async () => ({
        period: '2026-08',
        salesMxn: '10.00',
        cogsMxn: '2.00',
        bankCommissionsMxn: '1.00',
        operatingExpensesMxn: '1.00',
        netProfitMxn: '6.00',
        saleCount: 1,
      })),
    },
    inventory: any = {
      getSummary: jest.fn(async () => ({
        totalInventoryValue: '100.00',
        activeItemCount: 2,
        averageCost: '50.00',
      })),
    },
  ) {
    return new OperationalIntelligenceService(prisma, cuentas, analytics, inventory);
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
    expect(result.ageMetric).toBe('inventory_record_age');
    expect(result.ageSourceNote).toMatch(/not guaranteed physical acquisition/i);
    expect(result.ageSourceNote).not.toMatch(/comprado|acquisition age guaranteed/i);
    expect(result.items[0].watchId).toBe('w-tie'); // same age, higher cost
    expect(result.items[1].watchId).toBe('w-old');
    expect(result.items.map((i) => i.watchId)).not.toContain('sold');
    expect(result.items[0].ageDays).toBeGreaterThan(result.items[2].ageDays);
  });

  it('ageDays uses createdAt fallback (inventory record age)', async () => {
    const createdAt = new Date('2026-02-07T12:00:00.000Z');
    const prisma = {
      watch: {
        findMany: jest.fn(async () => [
          { id: 'w1', brand: 'A', model: '1', reference: null, cost: d(10), status: 'AVAILABLE', createdAt },
        ]),
      },
    };
    const result = await makeService(prisma).getInventoryAging('t1', { now });
    expect(result.items[0].ageDays).toBe(181);
    expect(result.ageSource).toBe('Watch.createdAt');
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

  it('ranks inventory capital and exposes percentOfActiveInventoryCapital Decimal-safe', async () => {
    const prisma = {
      watch: {
        findMany: jest.fn(async () => [
          { id: 'a', brand: 'A', model: '1', reference: null, cost: d(75), status: 'AVAILABLE', createdAt: now },
          { id: 'b', brand: 'B', model: '2', reference: null, cost: d(25), status: 'AVAILABLE', createdAt: now },
        ]),
      },
    };
    const result = await makeService(prisma).getTopInventoryCapital('t1', { now });
    expect(result.totalActiveInventoryCapital).toBe('100.00');
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        watchId: 'a',
        cost: '75.00',
        percentOfActiveInventoryCapital: '75.00',
      }),
    );
    expect(result.concentrationFormula).toBe('item cost / total active inventory cost');
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

  it('aggregates profit by brand with stable ranking from CLOSED_WON only', async () => {
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
    expect(prisma.deal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 't1',
          deletedAt: null,
          stage: DealStage.CLOSED_WON,
        }),
      }),
    );
    expect(result.items[0].brand).toBe('Rolex');
    expect(result.items[0].grossProfit).toBe('90.00');
    expect(result.items[0].unitsSold).toBe(2);
  });

  it('proves unsold inventory cannot enter brand-profit aggregation', async () => {
    const prisma = {
      watch: {
        findMany: jest.fn(async () => {
          throw new Error('getProfitByBrand must not query Watch inventory');
        }),
      },
      deal: {
        findMany: jest.fn(async (args: { where: { stage?: string } }) => {
          expect(args.where.stage).toBe(DealStage.CLOSED_WON);
          return [
            { agreedPrice: d(100), historicalCost: null, watch: { brand: 'Rolex', cost: d(40), expenses: [] } },
          ];
        }),
      },
    };
    const result = await makeService(prisma).getProfitByBrand('t1', { period: 'ALL', now });
    expect(prisma.watch.findMany).not.toHaveBeenCalled();
    expect(result.items).toHaveLength(1);
    expect(result.items[0].unitsSold).toBe(1);
    expect(result.definition).toMatch(/CLOSED_WON|gross/i);
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

  it('emits attention items with allowed category and observational language', async () => {
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
    expect(result.items.every((i) => (ATTENTION_CATEGORIES as readonly string[]).includes(i.category))).toBe(true);
    for (const item of result.items) {
      expect(item.category).toBe(ATTENTION_RULE_CATEGORY[item.type]);
    }
    expect(result.items.some((i) => i.type === 'AGED_HIGH_VALUE_INVENTORY')).toBe(true);
    const blob = JSON.stringify(result);
    expect(blob).not.toMatch(/Debes vender|Conviene cobrar|Compra menos|Vende esta posición|automatically sell/i);
    expect(blob).toMatch(/días registrado|concentra|pendientes/i);
    expect(ATTENTION_POLICY.AGED_INVENTORY_DAYS).toBe(120);
    expect(ATTENTION_POLICY.HIGH_VALUE_INVENTORY_MXN).toBe(200_000);
    expect(ATTENTION_POLICY.LARGE_RECEIVABLE_MXN).toBe(100_000);
    expect(ATTENTION_POLICY.CONCENTRATION_PERCENT).toBe(15);
    expect(ATTENTION_POLICY.LOW_MARGIN_PERCENT).toBe(8);
    expect(ATTENTION_POLICY.CRYPTO_STALE_HOURS).toBe(72);
  });

  it('composes GET_BUSINESS_SUMMARY from canonical sources without duplicate formulas', async () => {
    const analytics = {
      getLiquidity: jest.fn(async () => ({
        cashMxn: '10.00',
        bankMxn: '20.00',
        cryptoMxn: '5.00',
        cesarMxn: '1.00',
        totalLiquidityMxn: '36.00',
        warnings: [],
      })),
      getMonthlyProfit: jest.fn(async () => ({
        period: '2026-08',
        salesMxn: '100.00',
        cogsMxn: '40.00',
        bankCommissionsMxn: '5.00',
        operatingExpensesMxn: '10.00',
        netProfitMxn: '45.00',
        saleCount: 2,
      })),
    };
    const inventory = {
      getSummary: jest.fn(async () => ({
        totalInventoryValue: '500.00',
        activeItemCount: 4,
        averageCost: '125.00',
      })),
    };
    const prisma = {
      watch: { findMany: jest.fn(async () => []) },
      accountEntry: {
        findMany: jest.fn(async () => [
          {
            currency: 'MXN',
            totalAmount: d(200),
            status: 'OPEN',
            dealId: null,
            deal: null,
            payments: [],
          },
          {
            currency: 'USD',
            totalAmount: d(50),
            status: 'OPEN',
            dealId: null,
            deal: null,
            payments: [],
          },
        ]),
      },
      deal: { findMany: jest.fn(async () => []) },
      assetPriceSnapshot: { findMany: jest.fn(async () => []) },
      assetHolding: { count: jest.fn(async () => 0) },
    };
    const cuentas = { getTopDebtors: jest.fn(async () => []) };
    const result = await makeService(prisma, cuentas, analytics, inventory).getBusinessSummary('t1', { now });
    expect(analytics.getLiquidity).toHaveBeenCalledWith('t1', now);
    expect(analytics.getMonthlyProfit).toHaveBeenCalledWith('t1', 2026, 8);
    expect(inventory.getSummary).toHaveBeenCalledWith('t1');
    expect(result.liquidity.totalLiquidityMxn).toBe('36.00');
    expect(result.inventory).toEqual({ activeItemCount: 4, activeCapital: '500.00' });
    expect(result.receivables).toEqual({ MXN: '200.00', USD: '50.00' });
    expect(result.monthlyPerformance).toEqual(
      expect.objectContaining({ period: '2026-08', netProfit: '45.00' }),
    );
    expect(result.composition).toEqual([
      'AnalyticsService.getLiquidity',
      'InventoryService.getSummary',
      'OperationalIntelligenceService.getReceivableSummary',
      'AnalyticsService.getMonthlyProfit',
      'OperationalIntelligenceService.getAttentionItems',
    ]);
    expect(Array.isArray(result.attentionItems)).toBe(true);
    expect(result.note).toMatch(/Sin recomendaciones/i);
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
    await svc.getBusinessSummary('tenant-A', { now });
    expect(prisma.watch.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: 'tenant-A' }) }));
    expect(prisma.accountEntry.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: 'tenant-A' }) }));
    expect(prisma.deal.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: 'tenant-A' }) }));
    expect(cuentas.getTopDebtors).toHaveBeenCalledWith('tenant-A', expect.any(Number));
  });
});
