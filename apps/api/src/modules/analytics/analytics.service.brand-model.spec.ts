import { DealStage, Prisma } from '@prisma/client';
import { AnalyticsService } from './analytics.service';

function d(n: number) {
  return new Prisma.Decimal(n);
}

describe('AnalyticsService — sales by brand / top models with historical snapshots', () => {
  const TENANT = 'tenant-wc';
  const OTHER = 'other-tenant';

  type FakeDeal = {
    tenantId: string;
    stage: DealStage;
    deletedAt: Date | null;
    agreedPrice: Prisma.Decimal;
    notes: string | null;
    watchId: string | null;
    watch: { brand: string | null; model: string | null } | null;
  };

  const deals: FakeDeal[] = [
    {
      tenantId: TENANT,
      stage: DealStage.CLOSED_WON,
      deletedAt: null,
      agreedPrice: d(100),
      notes: null,
      watchId: 'w1',
      watch: { brand: 'Omega', model: 'Seamaster' },
    },
    {
      tenantId: TENANT,
      stage: DealStage.CLOSED_WON,
      deletedAt: null,
      agreedPrice: d(200),
      notes: 'brand=Rolex; model=Submariner; ref=16610; serial=; migration=sale_1',
      watchId: null,
      watch: null,
    },
    {
      tenantId: TENANT,
      stage: DealStage.CLOSED_WON,
      deletedAt: null,
      agreedPrice: d(50),
      notes: 'brand= rolex ; model=DATEJUST; ref=; serial=; migration=sale_2',
      watchId: null,
      watch: null,
    },
    {
      tenantId: TENANT,
      stage: DealStage.CLOSED_WON,
      deletedAt: null,
      agreedPrice: d(10),
      notes: 'brand=; model=; ref=; serial=; migration=sale_empty',
      watchId: null,
      watch: null,
    },
    {
      tenantId: OTHER,
      stage: DealStage.CLOSED_WON,
      deletedAt: null,
      agreedPrice: d(999),
      notes: 'brand=Alien; model=X; ref=; serial=; migration=sale_x',
      watchId: null,
      watch: null,
    },
  ];

  function makeService(rows: FakeDeal[]) {
    const prisma = {
      deal: {
        findMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
          rows
            .filter(
              (r) =>
                r.tenantId === where.tenantId &&
                r.deletedAt === null &&
                r.stage === DealStage.CLOSED_WON,
            )
            .map((r) => ({
              agreedPrice: r.agreedPrice,
              notes: r.notes,
              watchId: r.watchId,
              watch: r.watch,
            })),
        ),
      },
      payment: {
        findMany: jest.fn(async () => {
          throw new Error('brand/model analytics must not require Payment rows');
        }),
      },
    };
    return {
      service: new AnalyticsService(prisma as never, {} as never),
      prisma,
    };
  }

  it('groups linked operational sale under linked watch brand/model', async () => {
    const { service } = makeService(deals);
    const brands = await service.getSalesByBrand(TENANT);
    const models = await service.getTopModels(TENANT);
    expect(brands.find((b) => b.brand === 'Omega')?.count).toBe(1);
    expect(models.find((m) => m.model === 'Seamaster')?.count).toBe(1);
  });

  it('groups historical watchId=null under parsed snapshot brand/model', async () => {
    const { service } = makeService(deals);
    const brands = await service.getSalesByBrand(TENANT);
    const models = await service.getTopModels(TENANT);
    // Rolex + rolex group together
    expect(brands.find((b) => b.brand === 'Rolex' || b.brand === 'rolex')?.count).toBe(2);
    expect(models.find((m) => m.model === 'Submariner')?.count).toBe(1);
    expect(models.find((m) => m.model === 'DATEJUST')?.count).toBe(1);
  });

  it('never emits Histórico as brand or — as model', async () => {
    const { service } = makeService(deals);
    const brands = await service.getSalesByBrand(TENANT);
    const models = await service.getTopModels(TENANT);
    expect(brands.every((b) => b.brand !== 'Histórico')).toBe(true);
    expect(models.every((m) => m.model !== '—' && m.model !== '')).toBe(true);
    expect(brands.some((b) => b.brand === 'Sin marca')).toBe(true);
    expect(models.some((m) => m.model === 'Sin modelo')).toBe(true);
  });

  it('brand and model counts each sum to included deal count', async () => {
    const { service } = makeService(deals);
    const brands = await service.getSalesByBrand(TENANT);
    const models = await service.getTopModels(TENANT);
    const brandSum = brands.reduce((s, b) => s + b.count, 0);
    // top models may be sliced — for this tiny fixture all fit in top 10
    const modelSum = models.reduce((s, m) => s + m.count, 0);
    expect(brandSum).toBe(4);
    expect(modelSum).toBe(4);
    expect(models[0]?.totalSales).toBe(4);
  });

  it('does not fuzzy-merge distinct models', async () => {
    const { service } = makeService([
      {
        tenantId: TENANT,
        stage: DealStage.CLOSED_WON,
        deletedAt: null,
        agreedPrice: d(1),
        notes: 'brand=Rolex; model=Submariner; ref=; serial=; migration=a',
        watchId: null,
        watch: null,
      },
      {
        tenantId: TENANT,
        stage: DealStage.CLOSED_WON,
        deletedAt: null,
        agreedPrice: d(1),
        notes: 'brand=Rolex; model=Submariner Date; ref=; serial=; migration=b',
        watchId: null,
        watch: null,
      },
    ]);
    const models = await service.getTopModels(TENANT);
    expect(models).toHaveLength(2);
  });

  it('is tenant-isolated and does not query payments', async () => {
    const { service, prisma } = makeService(deals);
    const brands = await service.getSalesByBrand(OTHER);
    expect(brands).toEqual([
      expect.objectContaining({ brand: 'Alien', count: 1 }),
    ]);
    expect(prisma.payment.findMany).not.toHaveBeenCalled();
  });

  it('does not mutate watchId (read-model only)', async () => {
    const { service, prisma } = makeService(deals);
    await service.getSalesByBrand(TENANT);
    expect(prisma.deal.findMany).toHaveBeenCalled();
    // No update/create methods exist on stub — proves no writes attempted.
    expect((prisma.deal as { update?: unknown }).update).toBeUndefined();
  });
});
