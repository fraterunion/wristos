import { CapitalAccount, Prisma } from '@prisma/client';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CapitalContributionService } from './capital-contribution.service';

function d(n: number | string) {
  return new Prisma.Decimal(n);
}

describe('CapitalContributionService — canonical partner equity contribution', () => {
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
      [
        'inv-inactive',
        {
          id: 'inv-inactive',
          tenantId: 't1',
          name: 'Inactive',
          ownershipPercent: d(25),
          isActive: false,
          deletedAt: null,
        },
      ],
    ]);
    const contributions = new Map<string, any>();
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
        create: jest.fn(async ({ data }: any) => {
          if (data.registerIdempotencyKey) {
            for (const row of contributions.values()) {
              if (
                row.tenantId === data.tenantId &&
                row.registerIdempotencyKey === data.registerIdempotencyKey
              ) {
                const err = new Prisma.PrismaClientKnownRequestError('unique', {
                  code: 'P2002',
                  clientVersion: 'test',
                });
                throw err;
              }
            }
          }
          seq += 1;
          const id = `c-${seq}`;
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
      treasuryEntry: {
        findFirst: jest.fn(async ({ where }: any) => {
          for (const t of treasury.values()) {
            if (where.tenantId && t.tenantId !== where.tenantId) continue;
            if (where.contributionId && t.contributionId !== where.contributionId) continue;
            if (where.deletedAt === null && t.deletedAt) continue;
            return t;
          }
          return null;
        }),
      },
    };

    const service = new CapitalContributionService(prisma);
    return { service, prisma, contributions, treasury };
  }

  const base = {
    investorId: 'inv-1',
    amount: 300000,
    account: CapitalAccount.BANK,
    contributedAt: '2026-08-09',
    notes: 'QA aporte',
  };

  it('registers positive contribution without Treasury', async () => {
    const { service, prisma, treasury } = build();
    const result = await service.register('t1', base);
    expect(result.replayed).toBe(false);
    expect(result.contribution.amount.toFixed(2)).toBe('300000.00');
    expect(result.contribution.account).toBe(CapitalAccount.BANK);
    expect(result.contribution.registerIdempotencyKey).toBeNull();
    expect(prisma.treasuryEntry.findFirst).not.toHaveBeenCalled();
    expect(treasury.size).toBe(0);
  });

  it('rejects zero and negative amounts', async () => {
    const { service } = build();
    await expect(service.register('t1', { ...base, amount: 0 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.register('t1', { ...base, amount: -100 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects missing investor', async () => {
    const { service } = build();
    await expect(
      service.register('t1', { ...base, investorId: 'missing' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects inactive investor', async () => {
    const { service } = build();
    await expect(
      service.register('t1', { ...base, investorId: 'inv-inactive' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('replays same registerIdempotencyKey without duplicate row', async () => {
    const { service, contributions } = build();
    const key = 'ai-action-run:run-c1';
    const first = await service.register('t1', { ...base, registerIdempotencyKey: key });
    const second = await service.register('t1', { ...base, registerIdempotencyKey: key });
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.contribution.id).toBe(first.contribution.id);
    expect(contributions.size).toBe(1);
  });

  it('conflicts on same key with different payload', async () => {
    const { service } = build();
    const key = 'ai-action-run:run-c2';
    await service.register('t1', { ...base, registerIdempotencyKey: key });
    await expect(
      service.register('t1', {
        ...base,
        amount: 301000,
        registerIdempotencyKey: key,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('soft-deletes on reverse and rejects second economic create with same key', async () => {
    const { service } = build();
    const key = 'ai-action-run:run-c3';
    const created = await service.register('t1', { ...base, registerIdempotencyKey: key });
    const rev = await service.reverse('t1', created.contribution.id);
    expect(rev.alreadyReversed).toBe(false);
    expect(rev.contribution.deletedAt).toBeTruthy();
    const again = await service.reverse('t1', created.contribution.id);
    expect(again.alreadyReversed).toBe(true);
    await expect(
      service.register('t1', { ...base, registerIdempotencyKey: key }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('blocks reverse when a live Treasury link exists (future cash-linked gate)', async () => {
    const { service, treasury } = build();
    const created = await service.register('t1', base);
    treasury.set('te-1', {
      id: 'te-1',
      tenantId: 't1',
      contributionId: created.contribution.id,
      deletedAt: null,
    });
    await expect(service.reverse('t1', created.contribution.id)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('updates notes only and rejects deleted rows', async () => {
    const { service, contributions } = build();
    const created = await service.register('t1', base);
    const originalUpdatedAt = created.contribution.updatedAt.toISOString();
    const first = await service.updateNotes('t1', created.contribution.id, {
      notes: 'nota nueva',
      expectedUpdatedAt: originalUpdatedAt,
    });
    expect(first.changed).toBe(true);
    expect(first.contribution.notes).toBe('nota nueva');
    expect(first.contribution.amount.toFixed(2)).toBe('300000.00');

    const noop = await service.updateNotes('t1', created.contribution.id, {
      notes: 'nota nueva',
    });
    expect(noop.changed).toBe(false);

    await expect(
      service.updateNotes('t1', created.contribution.id, {
        notes: 'otra',
        expectedUpdatedAt: originalUpdatedAt,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    await service.reverse('t1', created.contribution.id);
    await expect(
      service.updateNotes('t1', created.contribution.id, { notes: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(contributions.get(created.contribution.id).amount.toFixed(2)).toBe('300000.00');
  });

  it('notes change does not break material idempotency replay', async () => {
    const { service } = build();
    const key = 'ai-action-run:run-notes';
    const first = await service.register('t1', { ...base, registerIdempotencyKey: key });
    await service.updateNotes('t1', first.contribution.id, { notes: 'edited later' });
    const replay = await service.register('t1', {
      ...base,
      notes: 'original notes ignored for match',
      registerIdempotencyKey: key,
    });
    expect(replay.replayed).toBe(true);
    expect(replay.contribution.id).toBe(first.contribution.id);
  });

  it('classifyRecovery covers match / reversed / invariant', async () => {
    const { service } = build();
    const created = await service.register('t1', base);
    const material = {
      investorId: 'inv-1',
      amount: d(300000),
      account: CapitalAccount.BANK,
      contributedAt: new Date('2026-08-09T00:00:00.000Z'),
    };
    expect(service.classifyRecovery(created.contribution, material)).toBe('MATCH');
    expect(
      service.classifyRecovery(created.contribution, { ...material, amount: d(1) }),
    ).toBe('CANONICAL_CAPITAL_CONTRIBUTION_INVARIANT');
    await service.reverse('t1', created.contribution.id);
    const reversed = await service.reverse('t1', created.contribution.id);
    expect(service.classifyRecovery(reversed.contribution, material)).toBe(
      'STALE_CAPITAL_CONTRIBUTION_REVERSED',
    );
    expect(service.classifyRecovery(null, material)).toBe('MISSING');
  });
});
