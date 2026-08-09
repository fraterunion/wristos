import { CapitalAccount } from '@prisma/client';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CapitalService } from './capital.service';
import {
  CAPITAL_CONTRIBUTION_IMMUTABLE_MESSAGE,
  CapitalContributionService,
} from './capital-contribution.service';
import {
  CAPITAL_DISTRIBUTION_IMMUTABLE_MESSAGE,
  CapitalDistributionService,
} from './capital-distribution.service';

function d(n: number | string) {
  return new Prisma.Decimal(n);
}

describe('CapitalService — economic immutability (23B)', () => {
  function build() {
    const contributions = new Map<string, any>();
    const distributions = new Map<string, any>();
    const investors = new Map<string, any>([
      ['inv-1', { id: 'inv-1', tenantId: 't1', name: 'A', isActive: true, deletedAt: null }],
    ]);

    const prisma: any = {
      investor: {
        findFirst: jest.fn(async ({ where }: any) => {
          const inv = investors.get(where.id);
          if (!inv || inv.tenantId !== where.tenantId || inv.deletedAt) return null;
          return inv;
        }),
      },
      investorContribution: {
        findFirst: jest.fn(async ({ where }: any) => {
          for (const row of contributions.values()) {
            if (where.id && row.id !== where.id) continue;
            if (where.tenantId && row.tenantId !== where.tenantId) continue;
            if (
              where.registerIdempotencyKey &&
              row.registerIdempotencyKey !== where.registerIdempotencyKey
            ) {
              continue;
            }
            return row;
          }
          return null;
        }),
        findFirstOrThrow: jest.fn(async ({ where }: any) => {
          const row = contributions.get(where.id);
          if (!row) throw new Error('missing');
          return { ...row, investor: { name: 'A' } };
        }),
        create: jest.fn(async ({ data }: any) => {
          const id = `c-${contributions.size + 1}`;
          const row = {
            id,
            ...data,
            amount: d(data.amount),
            deletedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          contributions.set(id, row);
          return row;
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const row = contributions.get(where.id);
          Object.assign(row, data, { updatedAt: new Date(Date.now() + 5_000) });
          return row;
        }),
      },
      investorDistribution: {
        findFirst: jest.fn(async ({ where }: any) => {
          for (const row of distributions.values()) {
            if (where.id && row.id !== where.id) continue;
            if (where.tenantId && row.tenantId !== where.tenantId) continue;
            if (
              where.registerIdempotencyKey &&
              row.registerIdempotencyKey !== where.registerIdempotencyKey
            ) {
              continue;
            }
            return row;
          }
          return null;
        }),
        findFirstOrThrow: jest.fn(async ({ where }: any) => {
          const row = distributions.get(where.id);
          if (!row) throw new Error('missing');
          return { ...row, investor: { name: 'A' } };
        }),
        create: jest.fn(async ({ data }: any) => {
          const id = `d-${distributions.size + 1}`;
          const row = {
            id,
            ...data,
            amount: d(data.amount),
            deletedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          distributions.set(id, row);
          return row;
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const row = distributions.get(where.id);
          Object.assign(row, data, { updatedAt: new Date(Date.now() + 5_000) });
          return row;
        }),
      },
      treasuryEntry: {
        findFirst: jest.fn(async () => null),
      },
    };

    const contrib = new CapitalContributionService(prisma);
    const dist = new CapitalDistributionService(prisma);
    const service = new CapitalService(prisma, contrib, dist);
    return { service, prisma, contributions, distributions };
  }

  it('rejects economic contribution PATCH and allows notes', async () => {
    const { service, contributions } = build();
    const created = await service.createContribution('t1', {
      investorId: 'inv-1',
      amount: 100000,
      account: CapitalAccount.BANK,
      contributedAt: '2026-08-09',
      notes: 'orig',
    });
    await expect(
      service.updateContribution(created.id, 't1', { amount: 200000 }),
    ).rejects.toBeInstanceOf(ConflictException);
    try {
      await service.updateContribution(created.id, 't1', { amount: 200000 });
    } catch (e: any) {
      expect(e.getResponse()).toMatchObject({
        code: 'CAPITAL_CONTRIBUTION_IMMUTABLE',
        message: CAPITAL_CONTRIBUTION_IMMUTABLE_MESSAGE,
      });
    }
    await expect(
      service.updateContribution(created.id, 't1', { account: CapitalAccount.CASH }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.updateContribution(created.id, 't1', { contributedAt: '2026-01-01' }),
    ).rejects.toBeInstanceOf(ConflictException);

    const notes = await service.updateContribution(created.id, 't1', { notes: 'solo notas' });
    expect(notes.notes).toBe('solo notas');
    expect(notes.amount).toBe('100000.00');
    expect(contributions.get(created.id).account).toBe(CapitalAccount.BANK);
  });

  it('rejects economic distribution PATCH and allows notes', async () => {
    const { service } = build();
    const created = await service.createDistribution('t1', {
      investorId: 'inv-1',
      amount: 50000,
      account: CapitalAccount.BANK,
      paidAt: '2026-08-09',
      notes: 'orig',
    });
    await expect(
      service.updateDistribution(created.id, 't1', { amount: 1 }),
    ).rejects.toBeInstanceOf(ConflictException);
    try {
      await service.updateDistribution(created.id, 't1', { amount: 1 });
    } catch (e: any) {
      expect(e.getResponse()).toMatchObject({
        code: 'CAPITAL_DISTRIBUTION_IMMUTABLE',
        message: CAPITAL_DISTRIBUTION_IMMUTABLE_MESSAGE,
      });
    }
    await expect(
      service.updateDistribution(created.id, 't1', { paidAt: '2020-01-01' }),
    ).rejects.toBeInstanceOf(ConflictException);

    const notes = await service.updateDistribution(created.id, 't1', { notes: 'n2' });
    expect(notes.notes).toBe('n2');
    expect(notes.amount).toBe('50000.00');
  });
});
