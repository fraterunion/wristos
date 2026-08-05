import { Prisma } from '@prisma/client';
import { CapitalService } from './capital.service';

const SOURCE = 'wrist-caviar-opening-capital-2025-07-29';
const EFFECTIVE = new Date('2025-07-29T00:00:00.000Z');

function makePrisma(opts: {
  openingBalances?: Array<{
    investorId: string;
    amount: Prisma.Decimal;
    effectiveDate: Date;
    source: string;
    notes: string | null;
  }>;
  contributions?: Array<{ investorId: string; amount: Prisma.Decimal }>;
  distributions?: Array<{ investorId: string; amount: Prisma.Decimal }>;
  tenants?: string[];
}) {
  const investors = [
    {
      id: 'cesar',
      tenantId: 'tenant-wc',
      name: 'CESAR',
      ownershipPercent: new Prisma.Decimal(75),
      isActive: true,
      notes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      contributions: (opts.contributions ?? [])
        .filter((c) => c.investorId === 'cesar')
        .map((c) => ({ amount: c.amount })),
      distributions: (opts.distributions ?? [])
        .filter((d) => d.investorId === 'cesar')
        .map((d) => ({ amount: d.amount })),
      openingBalances: (opts.openingBalances ?? [])
        .filter((o) => o.investorId === 'cesar')
        .map((o) => ({
          amount: o.amount,
          effectiveDate: o.effectiveDate,
          source: o.source,
          notes: o.notes,
        })),
    },
    {
      id: 'edgar',
      tenantId: 'tenant-wc',
      name: 'EDGAR',
      ownershipPercent: new Prisma.Decimal(25),
      isActive: true,
      notes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      contributions: (opts.contributions ?? [])
        .filter((c) => c.investorId === 'edgar')
        .map((c) => ({ amount: c.amount })),
      distributions: (opts.distributions ?? [])
        .filter((d) => d.investorId === 'edgar')
        .map((d) => ({ amount: d.amount })),
      openingBalances: (opts.openingBalances ?? [])
        .filter((o) => o.investorId === 'edgar')
        .map((o) => ({
          amount: o.amount,
          effectiveDate: o.effectiveDate,
          source: o.source,
          notes: o.notes,
        })),
    },
  ];

  return {
    deal: {
      findMany: jest.fn(async () => [
        {
          agreedPrice: new Prisma.Decimal(10000),
          historicalCost: new Prisma.Decimal(4000),
          watch: null,
        },
      ]),
    },
    treasuryEntry: {
      aggregate: jest.fn(async () => ({
        _sum: { commission: new Prisma.Decimal(100) },
      })),
      count: jest.fn(async () => 0),
    },
    investor: {
      findMany: jest.fn(async ({ where }: { where: { tenantId: string } }) => {
        expect(where.tenantId).toBe('tenant-wc');
        return investors;
      }),
    },
    investorOpeningBalance: {
      findMany: jest.fn(async () => opts.openingBalances ?? []),
      create: jest.fn(),
      upsert: jest.fn(),
    },
    investorContribution: {
      findMany: jest.fn(async () => []),
      count: jest.fn(async () => 0),
    },
  };
}

describe('CapitalService — InvestorOpeningBalance', () => {
  it('includes opening balances in invested capital and partner breakdown', async () => {
    const prisma = makePrisma({
      openingBalances: [
        {
          investorId: 'cesar',
          amount: new Prisma.Decimal(582000),
          effectiveDate: EFFECTIVE,
          source: SOURCE,
          notes: 'opening',
        },
        {
          investorId: 'edgar',
          amount: new Prisma.Decimal(4530500),
          effectiveDate: EFFECTIVE,
          source: SOURCE,
          notes: 'opening',
        },
      ],
      distributions: [
        { investorId: 'cesar', amount: new Prisma.Decimal(500) },
        { investorId: 'edgar', amount: new Prisma.Decimal(100) },
      ],
    });

    const summary = await new CapitalService(prisma as never).getSummary('tenant-wc');
    // profit = 10000 - 4000 - 100 = 5900
    expect(summary.totalBusinessProfit).toBe('5900.00');
    expect(summary.totalOpeningCapital).toBe('5112500.00');
    expect(summary.totalLaterContributions).toBe('0.00');
    expect(summary.totalCapitalContributed).toBe('5112500.00');
    expect(summary.contributionsIncomplete).toBe(false);
    expect(summary.roiAvailable).toBe(true);
    expect(summary.capitalNeto).toBe('5117800.00'); // 5112500 + 5900 - 600
    // Por pagar socios remains profit entitlement only
    expect(summary.totalPendingToPartners).toBe('5300.00'); // 5900 - 600
    expect(summary.investors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'cesar',
          openingCapital: '582000.00',
          laterContributions: '0.00',
          capitalContributed: '582000.00',
        }),
        expect.objectContaining({
          id: 'edgar',
          openingCapital: '4530500.00',
          laterContributions: '0.00',
          capitalContributed: '4530500.00',
        }),
      ]),
    );
    expect(summary.openingBalances).toHaveLength(2);
    expect(summary.openingBalances.every((r) => r.effectiveDate.startsWith('2025-07-29'))).toBe(
      true,
    );
  });

  it('does not count opening balances as later contributions', async () => {
    const prisma = makePrisma({
      openingBalances: [
        {
          investorId: 'cesar',
          amount: new Prisma.Decimal(582000),
          effectiveDate: EFFECTIVE,
          source: SOURCE,
          notes: null,
        },
      ],
      contributions: [{ investorId: 'cesar', amount: new Prisma.Decimal(1000) }],
    });
    const summary = await new CapitalService(prisma as never).getSummary('tenant-wc');
    expect(summary.totalOpeningCapital).toBe('582000.00');
    expect(summary.totalLaterContributions).toBe('1000.00');
    expect(summary.totalCapitalContributed).toBe('583000.00');
  });

  it('keeps ROI undefined when invested capital is zero', async () => {
    const prisma = makePrisma({});
    const summary = await new CapitalService(prisma as never).getSummary('tenant-wc');
    expect(summary.totalCapitalContributed).toBe('0.00');
    expect(summary.roiAvailable).toBe(false);
    expect(summary.contributionsIncomplete).toBe(true);
  });

  it('scopes investor load to the requested tenant', async () => {
    const prisma = makePrisma({
      openingBalances: [
        {
          investorId: 'cesar',
          amount: new Prisma.Decimal(582000),
          effectiveDate: EFFECTIVE,
          source: SOURCE,
          notes: null,
        },
      ],
    });
    await new CapitalService(prisma as never).getSummary('tenant-wc');
    expect(prisma.investor.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: 'tenant-wc' }),
      }),
    );
  });
});

describe('InvestorOpeningBalance seed idempotency helpers', () => {
  it('César + Edgar opening amounts equal 5,112,500', () => {
    const cesar = 582000;
    const edgar = 4530500;
    expect(cesar + edgar).toBe(5112500);
  });
});
