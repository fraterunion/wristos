import { CapitalAccount, Prisma } from '@prisma/client';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CapitalDistributionService } from './capital-distribution.service';

function d(n: number | string) {
  return new Prisma.Decimal(n);
}

describe('CapitalDistributionService — canonical partner distribution', () => {
  function build() {
    const investors = new Map<string, any>([
      [
        'inv-1',
        {
          id: 'inv-1',
          tenantId: 't1',
          name: 'Partner A',
          ownershipPercent: d(75),
          isActive: true,
          deletedAt: null,
        },
      ],
    ]);
    const distributions = new Map<string, any>();
    const treasury = new Map<string, any>();
    let seq = 0;

    const prisma: any = {
      investor: {
        findFirst: jest.fn(async ({ where }: any) => {
          const inv = investors.get(where.id);
          if (!inv) return null;
          if (where.tenantId && inv.tenantId !== where.tenantId) return null;
          if (where.deletedAt === null && inv.deletedAt) return null;
          return inv;
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
        create: jest.fn(async ({ data }: any) => {
          if (data.registerIdempotencyKey) {
            for (const row of distributions.values()) {
              if (
                row.tenantId === data.tenantId &&
                row.registerIdempotencyKey === data.registerIdempotencyKey
              ) {
                throw new Prisma.PrismaClientKnownRequestError('unique', {
                  code: 'P2002',
                  clientVersion: 'test',
                });
              }
            }
          }
          seq += 1;
          const id = `d-${seq}`;
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
        findFirst: jest.fn(async ({ where }: any) => {
          for (const t of treasury.values()) {
            if (where.tenantId && t.tenantId !== where.tenantId) continue;
            if (where.distributionId && t.distributionId !== where.distributionId) {
              continue;
            }
            if (where.deletedAt === null && t.deletedAt) continue;
            return t;
          }
          return null;
        }),
      },
    };

    const service = new CapitalDistributionService(prisma);
    return { service, distributions, treasury };
  }

  const base = {
    investorId: 'inv-1',
    amount: 100000,
    account: CapitalAccount.BANK,
    paidAt: '2026-08-09',
    notes: 'QA utilidad',
  };

  it('registers positive distribution without Treasury and allows over-entitlement', async () => {
    const { service, treasury } = build();
    // No pending-profit check — matches current CapitalService + Admin warning-only UX.
    const result = await service.register('t1', { ...base, amount: 9_999_999 });
    expect(result.replayed).toBe(false);
    expect(result.distribution.amount.toFixed(2)).toBe('9999999.00');
    expect(treasury.size).toBe(0);
  });

  it('rejects zero/negative and missing investor', async () => {
    const { service } = build();
    await expect(service.register('t1', { ...base, amount: 0 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.register('t1', { ...base, amount: -1 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.register('t1', { ...base, investorId: 'missing' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('replays and conflicts on idempotency key', async () => {
    const { service, distributions } = build();
    const key = 'ai-action-run:run-d1';
    const first = await service.register('t1', { ...base, registerIdempotencyKey: key });
    const second = await service.register('t1', { ...base, registerIdempotencyKey: key });
    expect(second.replayed).toBe(true);
    expect(second.distribution.id).toBe(first.distribution.id);
    expect(distributions.size).toBe(1);
    await expect(
      service.register('t1', {
        ...base,
        amount: 100001,
        registerIdempotencyKey: key,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('soft-deletes on reverse; CESAR_ACCOUNT remains non-Treasury', async () => {
    const { service } = build();
    const created = await service.register('t1', {
      ...base,
      account: CapitalAccount.CESAR_ACCOUNT,
    });
    expect(created.distribution.account).toBe(CapitalAccount.CESAR_ACCOUNT);
    const rev = await service.reverse('t1', created.distribution.id);
    expect(rev.alreadyReversed).toBe(false);
    expect(rev.distribution.deletedAt).toBeTruthy();
  });

  it('notes-only update + material replay after notes change', async () => {
    const { service } = build();
    const key = 'ai-action-run:run-d-notes';
    const created = await service.register('t1', { ...base, registerIdempotencyKey: key });
    const notes = await service.updateNotes('t1', created.distribution.id, {
      notes: 'nota dist',
    });
    expect(notes.changed).toBe(true);
    expect(notes.distribution.amount.toFixed(2)).toBe('100000.00');
    const replay = await service.register('t1', {
      ...base,
      notes: 'different notes ok',
      registerIdempotencyKey: key,
    });
    expect(replay.replayed).toBe(true);
    expect(
      service.classifyRecovery(created.distribution, {
        investorId: 'inv-1',
        amount: d(1),
        account: CapitalAccount.BANK,
        paidAt: new Date('2026-08-09T00:00:00.000Z'),
      }),
    ).toBe('CANONICAL_CAPITAL_DISTRIBUTION_INVARIANT');
  });
});
